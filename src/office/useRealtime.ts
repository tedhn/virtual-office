import { useEffect, useRef } from "react"
import type { Layout } from "./layout"
import { validateLayout } from "./layoutSchema"
import { CLOSE_NO_OFFICE } from "./relayClose"
import type { Position } from "./types"

export interface PeerState extends Position {
  name: string
  /** Peer has deafened themselves (silenced everyone + muted their mic). */
  deafened: boolean
  /** User id of the screen this peer is currently watching, or null. Drives the
   *  watcher count on a screen-sharer's avatar/modal, and the audio exemption that lets a
   *  presenter hear their watchers from any distance (see useProximityAudio). */
  watching: string | null
}

/** A chat message as it travels over the relay. */
export interface ChatMessage {
  id: string
  name: string
  text: string
  /** Sender's Room-context at send time: a private Room's id, or null for the open Floor. */
  room: string | null
}

type Send = (x: number, y: number) => void

interface Realtime {
  /** Send the local position to peers (cheap; safe to call at frame rate). */
  send: Send
  /** Send a chat message; the server scopes it to the sender's room-context. */
  sendChat: (text: string) => void
  /** Broadcast the local deafen state so peers can show the badge. */
  sendDeafen: (on: boolean) => void
  /** Broadcast which peer's screen we're watching (or null), for their watcher count. */
  sendWatch: (target: string | null) => void
  /** Latest known target position of every peer, keyed by user id. Mutated in place. */
  targetsRef: React.RefObject<Map<string, PeerState>>
}

function wsUrl(): string {
  const proto = location.protocol === "https:" ? "wss" : "ws"
  return `${proto}://${location.host}/ws`
}

/**
 * Opens a WebSocket to the position relay and keeps peer target positions in a ref.
 * Positions are streamed here (not via Stream) because Stream's event endpoint is
 * rate-limited; this channel has no such limit.
 *
 * `officeSlug` is the Office's channel on the relay, and the relay refuses any slug no
 * published Office answers to — so the socket is per Office, and peers never cross from
 * one to another.
 *
 * `handlers.onLayout` is how an Owner publishing reaches the people already inside: the
 * server pushes the Layout it has just read, rather than telling everyone to go and read it
 * for themselves. It also fires on arrival and on every reconnect, which is what makes the
 * reconnect loop below a backstop for an announcement that never landed. The Layout is
 * checked here before it is handed on, for the same reason the one loaded from the database
 * is — a document off a socket is not a Layout until something says so, and the renderer
 * indexes into rects.
 */
export interface RealtimeHandlers {
  /** A chat message the server has decided we are entitled to see. */
  onChat?: (m: ChatMessage) => void
  /** The Layout this Office is on now, on arrival and whenever it is republished. */
  onLayout?: (layout: Layout) => void
  /**
   * The relay has turned this Visitor out: no Office answers to this address any more, its
   * Owner having deleted or unpublished it while they were standing in it (CONTEXT.md,
   * Office). There is nothing to reconnect to, so somebody has to be told — see
   * `OfficeView`.
   */
  onTurnedOut?: () => void
}

export function useRealtime(
  officeSlug: string,
  userId: string,
  name: string,
  handlers: RealtimeHandlers = {},
): Realtime {
  const targetsRef = useRef<Map<string, PeerState>>(new Map())
  const sockRef = useRef<WebSocket | null>(null)
  // Kept in a ref so changing handlers don't tear down and reopen the socket. Updated in an
  // effect (not during render) to keep render pure.
  const handlersRef = useRef(handlers)
  useEffect(() => {
    handlersRef.current = handlers
  })

  useEffect(() => {
    let disposed = false
    let retry: ReturnType<typeof setTimeout> | undefined

    const connect = () => {
      const sock = new WebSocket(wsUrl())
      sockRef.current = sock

      sock.onopen = () => {
        sock.send(JSON.stringify({ t: "join", office: officeSlug, id: userId, name }))
      }

      sock.onmessage = (ev) => {
        const m = JSON.parse(ev.data as string)
        if (m.t === "snapshot") {
          for (const p of m.peers)
            targetsRef.current.set(p.id, {
              x: p.x,
              y: p.y,
              name: p.name,
              deafened: !!p.deafened,
              watching: p.watching ?? null,
            })
        } else if (m.t === "state") {
          targetsRef.current.set(m.id, {
            x: m.x,
            y: m.y,
            name: m.name,
            deafened: !!m.deafened,
            watching: m.watching ?? null,
          })
        } else if (m.t === "leave") {
          targetsRef.current.delete(m.id)
        } else if (m.t === "chat") {
          handlersRef.current.onChat?.({ id: m.id, name: m.name, text: m.text, room: m.room ?? null })
        } else if (m.t === "layout") {
          // Arrival, a reconnect, or the Owner having just published. A document we
          // cannot read is not a floor to put anybody on, so the one already being stood on
          // stays until a readable one arrives — which the next reconnect will bring.
          const layout = validateLayout(m.layout)
          if (layout.ok) handlersRef.current.onLayout?.(layout.layout)
          else console.error("the relay sent a layout that is not a Layout:", layout.errors)
        }
      }

      // On any drop (notably a server redeploy: SIGTERM closes every socket), forget all
      // peers so nobody lingers as a frozen ghost, then reconnect. The movement hook's
      // idle heartbeat re-broadcasts our position, and the rejoin snapshot repopulates
      // peers — so once the new server is up everyone re-syncs without a page refresh.
      //
      // The one close worth believing is the relay saying there is no Office at this
      // address: that answer does not change on a second knock, and a client that retries
      // it anyway spends the rest of the page's life reconnecting once a second. It gets
      // here when an Office stops being reachable while somebody is standing in it — which
      // is somebody's evening interrupted, so it is handed on rather than logged.
      sock.onclose = (ev) => {
        if (disposed) return
        targetsRef.current.clear()
        if (ev.code === CLOSE_NO_OFFICE) {
          handlersRef.current.onTurnedOut?.()
          return
        }
        retry = setTimeout(connect, 1000)
      }
      // An error is always followed by a close; let onclose drive the reconnect.
      sock.onerror = () => sock.close()
    }

    connect()

    return () => {
      disposed = true
      clearTimeout(retry)
      const sock = sockRef.current
      if (sock) {
        sock.onopen = sock.onmessage = sock.onerror = sock.onclose = null
        sock.close()
      }
      sockRef.current = null
      targetsRef.current.clear()
    }
  }, [officeSlug, userId, name])

  const send: Send = (x, y) => {
    const sock = sockRef.current
    if (!sock || sock.readyState !== WebSocket.OPEN) return
    sock.send(JSON.stringify({ t: "move", x, y }))
  }

  const sendChat: Realtime["sendChat"] = (text) => {
    const sock = sockRef.current
    if (!sock || sock.readyState !== WebSocket.OPEN) return
    // No Room-context is sent: the server derives it from our reported position and
    // enforces isolation itself, so sending it here would be redundant (and untrusted).
    sock.send(JSON.stringify({ t: "chat", text }))
  }

  const sendDeafen: Realtime["sendDeafen"] = (on) => {
    const sock = sockRef.current
    if (!sock || sock.readyState !== WebSocket.OPEN) return
    sock.send(JSON.stringify({ t: "deafen", on }))
  }

  const sendWatch: Realtime["sendWatch"] = (target) => {
    const sock = sockRef.current
    if (!sock || sock.readyState !== WebSocket.OPEN) return
    sock.send(JSON.stringify({ t: "watch", target }))
  }

  return { send, sendChat, sendDeafen, sendWatch, targetsRef }
}
