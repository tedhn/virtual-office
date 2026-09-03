// The shared geometry module and the relay's close codes, imported straight from
// TypeScript source — Node strips the types at load. Hence the explicit `.ts` extensions:
// Node ESM does no extension resolution. See ADR-0004.
import { roomContextAt } from "../src/office/layout.ts"
import { CLOSE_NO_OFFICE, CLOSE_RESTARTING, CLOSE_TRY_LATER } from "../src/office/relayClose.ts"

/** Longest chat message the relay will forward, in code points. */
const MAX_CHAT_LEN = 500

/**
 * Most messages a socket may queue behind its own join. A client sends its position
 * immediately after joining, and the join takes a database round trip the first time an
 * Office is entered — so a handful of messages legitimately arrive before the Office is
 * ready. Anything past that is not a client waiting its turn.
 */
const MAX_QUEUED = 64

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
 * shared geometry module from that Office's own published Layout. The only thing a client
 * ever reports is a position — it never tells the server which Room it is in (ADR-0002).
 *
 * `layoutFor` is where those Layouts come from: a slug in, that Office's Layout or null
 * out (see `officeLayouts.mjs`). Null means no published Office answers to the address,
 * and the socket is refused — a Visitor cannot open a channel of their own by inventing a
 * slug. A rejection means the directory could not be asked, which is not the same answer,
 * so the socket is closed for retry instead.
 *
 * Every message is judged against a Layout asked for at the moment of judging, and this
 * module keeps no copy of its own. That is deliberate: a second cache here would mean the
 * Layout privacy is enforced against goes stale on a clock nobody is watching, and a lone
 * Visitor could stand for hours inside the floorplan their Office had when they arrived.
 * How long a Layout is believed is one decision, and it is `officeLayouts.mjs`'s.
 *
 * Returns a handle with `closeAll()` for graceful shutdown.
 */
export function attachRelay(wss, { layoutFor }) {
  // Office slug -> Set<socket>. Each socket carries its own
  // { slug, id, name, x, y, deafened, watching } on `sock.meta`.
  const offices = new Map()

  function broadcast(slug, senderSock, data) {
    const sockets = offices.get(slug)
    if (!sockets) return
    const msg = JSON.stringify(data)
    for (const sock of sockets) {
      if (sock !== senderSock && sock.readyState === sock.OPEN) sock.send(msg)
    }
  }

  wss.on("connection", (sock) => {
    sock.meta = null
    // A join takes a database round trip, and the client's next message does not wait for
    // it. Hold those messages rather than dropping them: they are already in order, and a
    // position lost here is an avatar that stands at the origin until its next heartbeat.
    let joining = false
    const queued = []

    /** Turn a Visitor away without letting their queued messages outlive the attempt. */
    function refuse(code, reason) {
      joining = false
      queued.length = 0
      sock.close(code, reason)
    }

    async function join(m) {
      if (sock.meta || joining) return
      const slug = String(m.office ?? "")
      if (!slug || !m.id) return
      joining = true

      let layout
      try {
        layout = await layoutFor(slug)
      } catch (err) {
        console.error(`office lookup failed for "${slug}":`, err)
        return refuse(CLOSE_TRY_LATER, "could not reach the office directory")
      }

      joining = false
      if (sock.readyState !== sock.OPEN) {
        queued.length = 0
        return
      }
      // The Layout itself is not kept — this only answers whether there is an Office to
      // walk into at all. Every message is judged against a Layout asked for afresh.
      if (!layout) return refuse(CLOSE_NO_OFFICE, "no office is published at that address")

      sock.meta = {
        slug,
        id: String(m.id),
        name: String(m.name || m.id),
        x: 0,
        y: 0,
        deafened: false,
        watching: null,
      }

      let sockets = offices.get(slug)
      if (!sockets) {
        sockets = new Set()
        offices.set(slug, sockets)
      }
      sockets.add(sock)

      // Send the newcomer a snapshot of everyone already here.
      const peers = []
      for (const other of sockets) {
        if (other !== sock && other.meta) peers.push(stateOf(other.meta))
      }
      sock.send(JSON.stringify({ t: "snapshot", peers }))

      // Whatever arrived while the Office was being looked up, in the order it was sent.
      for (const held of queued.splice(0)) handleVisitorMessage(held)
    }

    function handleVisitorMessage(m) {
      if (!sock.meta) return

      if (m.t === "move") {
        sock.meta.x = m.x
        sock.meta.y = m.y
        broadcast(sock.meta.slug, sock, { t: "state", ...stateOf(sock.meta) })
        return
      }

      // Deafen toggle: purely a presence flag (audio itself is silenced client-side). Store
      // it and re-broadcast the peer's current state so everyone updates the badge.
      if (m.t === "deafen") {
        sock.meta.deafened = !!m.on
        broadcast(sock.meta.slug, sock, { t: "state", ...stateOf(sock.meta) })
        return
      }

      // Watch flag: the user id of the screen this peer is watching (or null). Presence only —
      // re-broadcast so the sharer's avatar/modal watcher count updates. Room-context isn't
      // enforced here: it's just an id count, and you can only watch a screen you can already
      // see (the client gates that), so nothing private leaks.
      if (m.t === "watch") {
        sock.meta.watching = m.target ? String(m.target) : null
        broadcast(sock.meta.slug, sock, { t: "state", ...stateOf(sock.meta) })
        return
      }

      // Chat rides the same relay, but Room-context isolation is enforced separately,
      // below — and who was standing where is settled HERE, before anything can yield.
      // Asking for the Layout is asynchronous, and a `move` processed in that gap would
      // otherwise have the message judged from where its sender went next rather than
      // from where they were standing when they sent it.
      if (m.t === "chat") {
        // Slice by code points (spread → array) so the length cap never splits a surrogate
        // pair (emoji, etc.) into a broken half-character.
        const text = [...String(m.text ?? "")].slice(0, MAX_CHAT_LEN).join("")
        if (!text) return
        const sockets = offices.get(sock.meta.slug)
        if (!sockets) return
        const audience = []
        for (const other of sockets) {
          // The sender local-echoes their own message, so it is never sent back to them.
          if (other !== sock && other.meta) audience.push({ sock: other, at: { ...other.meta } })
        }
        void fanOutChat({ ...sock.meta }, text, audience)
      }
    }

    /**
     * Room-context isolation, enforced HERE and nowhere else on the server: the message
     * reaches only the people whose position shares the sender's Room-context, so a
     * private Room's chat never leaves the server to anyone outside it. Any `room` the
     * client put on the message is ignored (ADR-0002).
     *
     * Everyone's position arrives already settled — see the caller. All that is left to
     * ask for is the Layout to measure those positions against, which is this Office's own
     * published one, asked for afresh rather than remembered here.
     */
    async function fanOutChat(sender, text, audience) {
      // Fail closed, both ways: an Office that has since been unpublished has no Layout to
      // judge Room-context by, and a directory we cannot reach is not permission to guess.
      let layout
      try {
        layout = await layoutFor(sender.slug)
      } catch (err) {
        console.error(`dropping chat in "${sender.slug}": office lookup failed:`, err)
        return
      }
      if (!layout) return

      const senderContext = roomContextAt(layout, sender)
      const msg = JSON.stringify({
        t: "chat",
        id: sender.id,
        name: sender.name,
        text,
        // The sender's Room-context, so the client can tag the message in its log.
        room: senderContext,
      })
      for (const { sock: other, at } of audience) {
        if (other.readyState !== other.OPEN) continue
        // Two people share a Room-context when they stand in the same private Room, or
        // both stand on the open Floor. Nothing else may see the message.
        if (roomContextAt(layout, at) === senderContext) other.send(msg)
      }
    }

    sock.on("message", (raw) => {
      let m
      try {
        m = JSON.parse(raw.toString())
      } catch {
        return
      }

      if (m.t === "join") {
        void join(m)
        return
      }
      if (joining) {
        if (queued.length < MAX_QUEUED) queued.push(m)
        return
      }
      handleVisitorMessage(m)
    })

    sock.on("close", () => {
      if (!sock.meta) return
      const { slug, id } = sock.meta
      const sockets = offices.get(slug)
      if (!sockets) return
      sockets.delete(sock)
      // An Office nobody is standing in holds nothing open.
      if (sockets.size === 0) offices.delete(slug)
      broadcast(slug, sock, { t: "leave", id })
    })
  })

  /** Close every live socket so clients reconnect at once. */
  function closeAll() {
    for (const sockets of offices.values()) {
      for (const sock of sockets) {
        try {
          sock.close(CLOSE_RESTARTING, "server restarting")
        } catch {
          /* already gone */
        }
      }
    }
  }

  return { closeAll }
}
