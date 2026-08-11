import { useCallback, useEffect, useRef, useState } from "react"
import type { ChatMessage } from "./useRealtime"

/** A chat message stored in the local log, with a stable key for React. */
export interface LoggedMessage extends ChatMessage {
  k: number
}

export interface Chat {
  /** Whether the chat input is open (Enter opens, Esc closes). */
  open: boolean
  openChat: () => void
  closeChat: () => void
  /** Send the local user's message (trimmed, tagged with the current room-context). */
  send: (text: string) => void
  /** Running history of messages the local user is allowed to see. */
  log: LoggedMessage[]
  /** Latest ephemeral message per user id, for the speech bubble above their avatar. */
  bubbles: Record<string, string>
  /** Feed an incoming relay message in; filtered here by room-context. */
  ingest: (m: ChatMessage) => void
}

interface UseChatParams {
  sendChat: (text: string) => void
  localUserId: string
  localName: string
  /** Room the local user is currently inside (A/B/C) or null for the open floor. */
  currentRoom: string | null
}

const BUBBLE_MS = 6000 // how long a speech bubble lingers above an avatar
const MAX_LOG = 80 // cap the history so it never grows unbounded
const MAX_LEN = 500 // matches the server-side clamp

export function useChat({ sendChat, localUserId, localName, currentRoom }: UseChatParams): Chat {
  const [open, setOpen] = useState(false)
  const [log, setLog] = useState<LoggedMessage[]>([])
  const [bubbles, setBubbles] = useState<Record<string, string>>({})

  // Ref so the stable callbacks below always read the latest room without re-creating.
  // Written in an effect (not during render) to keep render pure.
  const roomRef = useRef(currentRoom)
  useEffect(() => {
    roomRef.current = currentRoom
  }, [currentRoom])
  const seq = useRef(0)
  // Per-user token: only the newest bubble's timer clears it, so rapid messages don't
  // cut each other short.
  const bubbleToken = useRef<Record<string, number>>({})

  const showBubble = useCallback((userId: string, text: string) => {
    const token = ++seq.current
    bubbleToken.current[userId] = token
    setBubbles((b) => ({ ...b, [userId]: text }))
    setTimeout(() => {
      if (bubbleToken.current[userId] !== token) return
      setBubbles((b) => {
        const { [userId]: _drop, ...rest } = b
        return rest
      })
    }, BUBBLE_MS)
  }, [])

  const append = useCallback(
    (m: ChatMessage) => {
      const entry: LoggedMessage = { ...m, k: ++seq.current }
      setLog((l) => (l.length >= MAX_LOG ? [...l.slice(l.length - MAX_LOG + 1), entry] : [...l, entry]))
      showBubble(m.id, m.text)
    },
    [showBubble],
  )

  // Room isolation, same rule as proximity audio/video: only surface chat sent from your
  // own room-context. Everything else the relay delivers is dropped here.
  const ingest = useCallback(
    (m: ChatMessage) => {
      if ((m.room ?? null) !== (roomRef.current ?? null)) return
      append(m)
    },
    [append],
  )

  const send = useCallback(
    (raw: string) => {
      const text = raw.trim().slice(0, MAX_LEN)
      if (!text) return
      const room = roomRef.current ?? null // for the local echo only; server scopes the real send
      sendChat(text)
      append({ id: localUserId, name: localName, text, room }) // local echo (server won't echo back)
    },
    [sendChat, append, localUserId, localName],
  )

  const openChat = useCallback(() => setOpen(true), [])
  const closeChat = useCallback(() => setOpen(false), [])

  return { open, openChat, closeChat, send, log, bubbles, ingest }
}
