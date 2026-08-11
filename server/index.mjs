import dotenv from "dotenv"
import { createServer } from "node:http"
import { existsSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import express from "express"
import cors from "cors"
import { WebSocketServer } from "ws"
import { StreamClient } from "@stream-io/node-sdk"

// Separate Stream apps per environment: dev keys in .dev, prod keys in .prod, anything shared
// in .env. NODE_ENV picks the file — `npm run dev` sets development, `npm start` production.
//
// First file to define a key wins, and dotenv never overwrites a variable already present in
// the environment. So a platform-injected var (Railway) beats every file, and these files are
// purely a local convenience.
//
// Note these are NOT Vite env files — Vite only auto-loads `.env[.mode]`, so VITE_* vars set
// here never reach the browser bundle. That's fine and deliberate: the browser gets its Stream
// key from /api/token at runtime (see src/lib/stream.ts), which means it always gets the key
// belonging to whichever environment actually served it. Nothing to keep in sync.
const mode = process.env.NODE_ENV === "production" ? "production" : "development"
dotenv.config({
  path: mode === "production" ? [".prod.local", ".prod", ".env"] : [".dev.local", ".dev", ".env"],
  quiet: true,
})

const { STREAM_API_KEY, STREAM_API_SECRET, PORT = 3001 } = process.env

console.log(`env: ${mode}`)

if (!STREAM_API_KEY || !STREAM_API_SECRET) {
  console.error(
    "Missing STREAM_API_KEY / STREAM_API_SECRET. Copy .env.example to .env and fill them in.",
  )
  process.exit(1)
}

const client = new StreamClient(STREAM_API_KEY, STREAM_API_SECRET)

const app = express()
app.use(cors())
app.use(express.json())

// Mint a user token. Secret stays on the server; browser only ever sees the JWT.
app.post("/api/token", (req, res) => {
  const { userId } = req.body ?? {}
  if (!userId || typeof userId !== "string") {
    return res.status(400).json({ error: "userId is required" })
  }
  try {
    const token = client.generateUserToken({
      user_id: userId,
      validity_in_seconds: 60 * 60 * 24, // 24h
    })
    res.json({ apiKey: STREAM_API_KEY, token })
  } catch (err) {
    console.error("token error:", err)
    res.status(500).json({ error: "failed to generate token" })
  }
})

app.get("/api/health", (_req, res) => res.json({ ok: true }))

// Production: serve the built SPA from the same service (one port to expose).
// In dev the app is served by Vite instead, so this is skipped.
const distDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "dist")
if (existsSync(distDir)) {
  app.use(express.static(distDir))
  app.use((req, res, next) => {
    if (req.method !== "GET" || req.path.startsWith("/api")) return next()
    res.sendFile(path.join(distDir, "index.html"))
  })
  console.log("serving built SPA from ./dist")
}

// ---------------------------------------------------------------------------
// Real-time position relay (WebSocket).
// Stream's custom-event REST endpoint is rate-limited (~3/s) and unsuitable for
// continuous avatar movement, so positions ride this lightweight fan-out instead.
// Media + proximity audio stay on Stream.
// ---------------------------------------------------------------------------
const httpServer = createServer(app)
const wss = new WebSocketServer({ server: httpServer, path: "/ws" })

// room -> Set<socket>. Each socket carries { room, id, name, x, y }.
const rooms = new Map()

// Room-context isolation for chat, enforced here so a room's messages never leave the
// server to anyone outside it (positions already stream to everyone; chat text must not
// leak the same way). Mirrors the room rects + floor size from src/office/{layout,types}.ts
// — keep in sync if those change. Only rooms (A/B/C) are private; the open floor is null.
const FLOOR_W = 900
const FLOOR_H = 2000
const ROOM_RECTS = [
  { id: "C", x: 0.5, y: 0.28, w: 0.5, h: 0.24 },
  { id: "A", x: 0.0, y: 0.88, w: 0.5, h: 0.12 },
  { id: "B", x: 0.5, y: 0.88, w: 0.5, h: 0.12 },
]

function zoneOf(x, y) {
  const nx = x / FLOOR_W
  const ny = y / FLOOR_H
  for (const r of ROOM_RECTS) {
    if (nx >= r.x && nx <= r.x + r.w && ny >= r.y && ny <= r.y + r.h) return r.id
  }
  return null
}

// The peer-state payload other clients render from (position + presence flags).
function stateOf(meta) {
  return {
    id: meta.id,
    name: meta.name,
    x: meta.x,
    y: meta.y,
    deafened: meta.deafened,
    watching: meta.watching,
  }
}

function broadcast(room, senderSock, data) {
  const peers = rooms.get(room)
  if (!peers) return
  const msg = JSON.stringify(data)
  for (const sock of peers) {
    if (sock !== senderSock && sock.readyState === sock.OPEN) sock.send(msg)
  }
}

wss.on("connection", (sock) => {
  sock.meta = null

  sock.on("message", (raw) => {
    let m
    try {
      m = JSON.parse(raw.toString())
    } catch {
      return
    }

    if (m.t === "join") {
      const room = String(m.room || "office-main")
      sock.meta = {
        room,
        id: String(m.id),
        name: String(m.name || m.id),
        x: 0,
        y: 0,
        deafened: false,
        watching: null,
      }
      if (!rooms.has(room)) rooms.set(room, new Set())
      rooms.get(room).add(sock)

      // Send the newcomer a snapshot of everyone already here.
      const peers = []
      for (const other of rooms.get(room)) {
        if (other !== sock && other.meta) peers.push(stateOf(other.meta))
      }
      sock.send(JSON.stringify({ t: "snapshot", peers }))
      return
    }

    if (m.t === "move" && sock.meta) {
      sock.meta.x = m.x
      sock.meta.y = m.y
      broadcast(sock.meta.room, sock, { t: "state", ...stateOf(sock.meta) })
      return
    }

    // Deafen toggle: purely a presence flag (audio itself is silenced client-side). Store
    // it and re-broadcast the peer's current state so everyone updates the badge.
    if (m.t === "deafen" && sock.meta) {
      sock.meta.deafened = !!m.on
      broadcast(sock.meta.room, sock, { t: "state", ...stateOf(sock.meta) })
      return
    }

    // Watch flag: the user id of the screen this peer is watching (or null). Presence only —
    // re-broadcast so the sharer's avatar/modal watcher count updates. Room isolation isn't
    // enforced here: it's just an id count, and you can only watch a screen you can already
    // see (the client gates that), so nothing private leaks.
    if (m.t === "watch" && sock.meta) {
      sock.meta.watching = m.target ? String(m.target) : null
      broadcast(sock.meta.room, sock, { t: "state", ...stateOf(sock.meta) })
      return
    }

    // Chat rides the same relay, but room isolation is enforced HERE: the message only
    // reaches sockets whose current position shares the sender's room-context, so a
    // private room's chat never leaves the server to anyone outside it. Sender local-
    // echoes their own message (we never send it back to them).
    if (m.t === "chat" && sock.meta) {
      // Slice by code points (spread → array) so the 500-char cap never splits a
      // surrogate pair (emoji, etc.) into a broken half-character.
      const text = [...String(m.text ?? "")].slice(0, 500).join("")
      if (!text) return
      const zone = zoneOf(sock.meta.x, sock.meta.y)
      const peers = rooms.get(sock.meta.room)
      if (!peers) return
      const msg = JSON.stringify({
        t: "chat",
        id: sock.meta.id,
        name: sock.meta.name,
        text,
        room: zone,
      })
      for (const other of peers) {
        if (other === sock || other.readyState !== other.OPEN || !other.meta) continue
        if (zoneOf(other.meta.x, other.meta.y) === zone) other.send(msg)
      }
    }
  })

  sock.on("close", () => {
    if (!sock.meta) return
    const { room, id } = sock.meta
    rooms.get(room)?.delete(sock)
    if (rooms.get(room)?.size === 0) rooms.delete(room)
    broadcast(room, sock, { t: "leave", id })
  })
})

httpServer.listen(PORT, () => {
  console.log(`server on http://localhost:${PORT} (ws: /ws)`)
})

// Graceful shutdown. On redeploy Railway sends SIGTERM; close every socket cleanly with
// 1012 (Service Restart) so clients disconnect immediately and their reconnect loop takes
// over, rather than hanging on the dropped TCP connection until it times out.
let shuttingDown = false
function shutdown() {
  if (shuttingDown) return
  shuttingDown = true
  console.log("shutting down: closing sockets…")
  for (const peers of rooms.values()) {
    for (const sock of peers) {
      try {
        sock.close(1012, "server restarting")
      } catch {
        /* already gone */
      }
    }
  }
  wss.close()
  httpServer.close(() => process.exit(0))
  // Failsafe in case a connection refuses to drain.
  setTimeout(() => process.exit(0), 3000).unref()
}
process.on("SIGTERM", shutdown)
process.on("SIGINT", shutdown)
