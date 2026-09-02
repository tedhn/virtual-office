// The shared geometry module, imported straight from TypeScript source — Node strips the
// types at load. Hence the explicit `.ts` extensions: Node ESM does no extension
// resolution. See ADR-0004.
import { DEFAULT_LAYOUT } from "../src/office/defaultLayout.ts"
import { roomContextAt } from "../src/office/layout.ts"

/** Longest chat message the relay will forward, in code points. */
const MAX_CHAT_LEN = 500

/** The peer-state payload other clients render from (position + presence flags). */
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

/**
 * Position + chat fan-out for every connected Office, over one WebSocketServer.
 *
 * Chat isolation lives here and nowhere else on the server: a message reaches only the
 * sockets whose last reported position shares the sender's Room-context, computed by the
 * shared geometry module from the Office's Layout. The only thing a client ever reports
 * is a position — it never tells the server which Room it is in (ADR-0002).
 *
 * `layout` is one Layout for every Office for now, because there is one authored office.
 * Once Offices carry their own Layouts this becomes a per-Office lookup; the isolation
 * code below doesn't change, since it already takes the Layout as an argument.
 *
 * Returns a handle with `closeAll()` for graceful shutdown.
 */
export function attachRelay(wss, layout = DEFAULT_LAYOUT) {
  // Office id -> Set<socket>. Each socket carries its own
  // { office, id, name, x, y, deafened, watching } on `sock.meta`.
  const offices = new Map()

  function broadcast(office, senderSock, data) {
    const peers = offices.get(office)
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
        // `room` is the field this message used before Offices got their own word; a page
        // cached across a redeploy reconnects with the old bundle, and must still land in
        // the Office it was already in rather than a bucket of its own.
        const office = String(m.office ?? m.room ?? "")
        if (!office || !m.id) return
        sock.meta = {
          office,
          id: String(m.id),
          name: String(m.name || m.id),
          x: 0,
          y: 0,
          deafened: false,
          watching: null,
        }
        if (!offices.has(office)) offices.set(office, new Set())
        offices.get(office).add(sock)

        // Send the newcomer a snapshot of everyone already here.
        const peers = []
        for (const other of offices.get(office)) {
          if (other !== sock && other.meta) peers.push(stateOf(other.meta))
        }
        sock.send(JSON.stringify({ t: "snapshot", peers }))
        return
      }

      if (m.t === "move" && sock.meta) {
        sock.meta.x = m.x
        sock.meta.y = m.y
        broadcast(sock.meta.office, sock, { t: "state", ...stateOf(sock.meta) })
        return
      }

      // Deafen toggle: purely a presence flag (audio itself is silenced client-side). Store
      // it and re-broadcast the peer's current state so everyone updates the badge.
      if (m.t === "deafen" && sock.meta) {
        sock.meta.deafened = !!m.on
        broadcast(sock.meta.office, sock, { t: "state", ...stateOf(sock.meta) })
        return
      }

      // Watch flag: the user id of the screen this peer is watching (or null). Presence only —
      // re-broadcast so the sharer's avatar/modal watcher count updates. Room-context isn't
      // enforced here: it's just an id count, and you can only watch a screen you can already
      // see (the client gates that), so nothing private leaks.
      if (m.t === "watch" && sock.meta) {
        sock.meta.watching = m.target ? String(m.target) : null
        broadcast(sock.meta.office, sock, { t: "state", ...stateOf(sock.meta) })
        return
      }

      // Chat rides the same relay, but Room-context isolation is enforced HERE: the message
      // only reaches sockets whose current position shares the sender's Room-context, so a
      // private Room's chat never leaves the server to anyone outside it. Any `room` the
      // client put on the message is ignored. Sender local-echoes their own message (we
      // never send it back to them).
      if (m.t === "chat" && sock.meta) {
        // Slice by code points (spread → array) so the length cap never splits a surrogate
        // pair (emoji, etc.) into a broken half-character.
        const text = [...String(m.text ?? "")].slice(0, MAX_CHAT_LEN).join("")
        if (!text) return
        const peers = offices.get(sock.meta.office)
        if (!peers) return
        const senderContext = roomContextAt(layout, sock.meta)
        const msg = JSON.stringify({
          t: "chat",
          id: sock.meta.id,
          name: sock.meta.name,
          text,
          // The sender's Room-context, so the client can tag the message in its log.
          room: senderContext,
        })
        for (const other of peers) {
          if (other === sock || other.readyState !== other.OPEN || !other.meta) continue
          // Two people share a Room-context when they stand in the same private Room, or
          // both stand on the open Floor. Nothing else may see the message.
          if (roomContextAt(layout, other.meta) === senderContext) other.send(msg)
        }
      }
    })

    sock.on("close", () => {
      if (!sock.meta) return
      const { office, id } = sock.meta
      offices.get(office)?.delete(sock)
      if (offices.get(office)?.size === 0) offices.delete(office)
      broadcast(office, sock, { t: "leave", id })
    })
  })

  /** Close every live socket with 1012 (Service Restart) so clients reconnect at once. */
  function closeAll() {
    for (const peers of offices.values()) {
      for (const sock of peers) {
        try {
          sock.close(1012, "server restarting")
        } catch {
          /* already gone */
        }
      }
    }
  }

  return { closeAll }
}
