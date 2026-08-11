import { useEffect, useRef } from "react"
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
  /** Sender's room-context at send time: room id (A/B/C) or null for the open floor. */
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
 */
export function useRealtime(
  roomId: string,
  userId: string,
  name: string,
  onChat?: (m: ChatMessage) => void,
): Realtime {
  const targetsRef = useRef<Map<string, PeerState>>(new Map())
  const sockRef = useRef<WebSocket | null>(null)
  // Kept in a ref so a changing handler doesn't tear down and reopen the socket.
  // Updated in an effect (not during render) to keep render pure.
  const onChatRef = useRef(onChat)
  useEffect(() => {
    onChatRef.current = onChat
  })

  useEffect(() => {
    let disposed = false
    let retry: ReturnType<typeof setTimeout> | undefined

    const connect = () => {
      const sock = new WebSocket(wsUrl())
      sockRef.current = sock

      sock.onopen = () => {
        sock.send(JSON.stringify({ t: "join", room: roomId, id: userId, name }))
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
          onChatRef.current?.({ id: m.id, name: m.name, text: m.text, room: m.room ?? null })
        }
      }

      // On any drop (notably a server redeploy: SIGTERM closes every socket), forget all
      // peers so nobody lingers as a frozen ghost, then reconnect. The movement hook's
      // idle heartbeat re-broadcasts our position, and the rejoin snapshot repopulates
      // peers — so once the new server is up everyone re-syncs without a page refresh.
      sock.onclose = () => {
        if (disposed) return
        targetsRef.current.clear()
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
  }, [roomId, userId, name])

  const send: Send = (x, y) => {
    const sock = sockRef.current
    if (!sock || sock.readyState !== WebSocket.OPEN) return
    sock.send(JSON.stringify({ t: "move", x, y }))
  }

  const sendChat: Realtime["sendChat"] = (text) => {
    const sock = sockRef.current
    if (!sock || sock.readyState !== WebSocket.OPEN) return
    // No room field: the server derives the sender's room-context from their position
    // and enforces isolation, so sending it here would be redundant (and untrusted).
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
