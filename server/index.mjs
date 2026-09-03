import dotenv from "dotenv"
import { createServer } from "node:http"
import { existsSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import express from "express"
import cors from "cors"
import { WebSocketServer } from "ws"
import { StreamClient } from "@stream-io/node-sdk"
import { attachRelay } from "./relay.mjs"
import { officeDirectory, supabaseConfig } from "./offices.mjs"
import { officeLayouts } from "./officeLayouts.mjs"
import { deletedRoute, republishedRoute, visitorCountRoute } from "./publishing.mjs"
import { tokenRoute } from "./token.mjs"

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

// Both halves of this server ask the database about Offices: the token endpoint mints
// only for one that exists and is published, and the relay enforces a private Room's chat
// against that Office's own published Layout. Refusing to start is deliberate: starting
// without it would mean minting for anything and enforcing privacy against nothing.
const supabase = supabaseConfig(process.env)
if (!supabase) {
  console.error(
    "Missing SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY (the VITE_ pair is read too). The token " +
      "endpoint needs them to tell a real Office from an invented one, and the relay needs " +
      "them to know which Rooms are private — see .env.example.",
  )
  process.exit(1)
}

const directory = officeDirectory(supabase)

const client = new StreamClient(STREAM_API_KEY, STREAM_API_SECRET)

const app = express()
app.use(cors())
app.use(express.json())

// ---------------------------------------------------------------------------
// Real-time position + chat relay (WebSocket).
// Stream's custom-event REST endpoint is rate-limited (~3/s) and unsuitable for
// continuous avatar movement, so positions ride this lightweight fan-out instead.
// Media + proximity audio stay on Stream. The relay itself — including the chat
// isolation it enforces — lives in ./relay.mjs, and the Layouts it enforces that
// isolation against come from ./officeLayouts.mjs, one per Office.
// ---------------------------------------------------------------------------
const httpServer = createServer(app)
const wss = new WebSocketServer({ server: httpServer, path: "/ws" })
const layouts = officeLayouts({ fetchLayout: directory.publishedLayout })
const relay = attachRelay(wss, { layoutFor: layouts.layoutFor })

// Mint a user token for someone walking into a published Office. Secret stays on the
// server; the browser only ever sees the JWT. The gate itself lives in ./token.mjs.
app.post(
  "/api/token",
  tokenRoute({
    apiKey: STREAM_API_KEY,
    mintToken: (userId) =>
      client.generateUserToken({
        user_id: userId,
        validity_in_seconds: 60 * 60 * 24, // 24h
      }),
    isOfficePublished: directory.isOfficePublished,
  }),
)

// How many Visitors are standing in an Office, and the nudges that say its published
// Layout has just changed or that the Office is gone. All three are questions about the
// relay's live sockets, which is the one thing an Owner's browser cannot see for itself —
// see ./publishing.mjs.
app.get("/api/offices/:slug/visitors", visitorCountRoute({ visitorCount: relay.visitorCount }))

app.post(
  "/api/offices/:slug/published",
  republishedRoute({
    visitorCount: relay.visitorCount,
    forget: layouts.forget,
    layoutFor: layouts.layoutFor,
    announceLayout: relay.announceLayout,
  }),
)

app.post(
  "/api/offices/:slug/deleted",
  deletedRoute({
    forget: layouts.forget,
    layoutFor: layouts.layoutFor,
    closeOffice: relay.closeOffice,
  }),
)

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
  relay.closeAll()
  wss.close()
  httpServer.close(() => process.exit(0))
  // Failsafe in case a connection refuses to drain.
  setTimeout(() => process.exit(0), 3000).unref()
}
process.on("SIGTERM", shutdown)
process.on("SIGINT", shutdown)
