import { useEffect, useRef, useState } from "react"
import { Send, X } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import type { LoggedMessage } from "./useChat"

interface ChatBarProps {
  onSend: (text: string) => void
  onClose: () => void
  /** Room-scope of what's typed here: room id (A/B/C) or null for the open floor. */
  currentRoom: string | null
  /** Recent messages visible in the current room-context. */
  log: LoggedMessage[]
  localUserId: string
  /** Mobile: float over the office pane, always open, no auto-focus, no close button. */
  floating?: boolean
}

export function ChatBar({ onSend, onClose, currentRoom, log, localUserId, floating }: ChatBarProps) {
  const [text, setText] = useState("")
  const inputRef = useRef<HTMLInputElement>(null)
  const logRef = useRef<HTMLDivElement>(null)

  // Grab focus when the bar opens so typing lands here (and movement keys don't move you).
  // On mobile it's opened explicitly via the chat button, so focusing (and popping the
  // keyboard) is the desired behavior there too.
  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // Only show chat that belongs to where you are right now, matching the room privacy model.
  const visible = log.filter((m) => (m.room ?? null) === (currentRoom ?? null))

  // Keep the log pinned to the newest message.
  useEffect(() => {
    const el = logRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [visible.length])

  const submit = () => {
    onSend(text)
    setText("")
  }

  // Mobile close plays a slide/fade-out first, then unmounts on the animation's end event
  // (the parent gates on chat.open). Desktop has no enter animation, so it closes instantly.
  const [closing, setClosing] = useState(false)
  const requestClose = () => {
    if (!floating) return onClose()
    setClosing(true)
  }

  const scope = currentRoom ? `Room ${currentRoom}` : "Open floor"

  return (
    <>
      {/* Mobile: tapping anywhere outside the bar closes the chat. The panel sits after this
          backdrop at the same z, so it stays on top and taps on it don't fall through. */}
      {floating && (
        <div
          className={`absolute inset-0 z-40 duration-200 ${
            closing ? "animate-out fade-out" : "animate-in fade-in"
          }`}
          onPointerDown={requestClose}
          aria-hidden
        />
      )}
      <div
        onAnimationEnd={closing ? onClose : undefined}
        // `dark` for the same reason as the toolbar: the log and the field it sits above
        // are drawn on the Floor, which has no theme, and the dark chrome palette is the
        // one meant for a dark ground (ADR-0012).
        className={
          floating
            ? `dark absolute inset-x-2 bottom-2 z-40 duration-200 ease-out ${
                closing
                  ? "animate-out fade-out slide-out-to-bottom-4 fill-mode-forwards"
                  : "animate-in fade-in slide-in-from-bottom-4"
              }`
            : "dark absolute bottom-4 left-4 z-40 w-[min(88vw,36rem)]"
        }
      >
        {visible.length > 0 && (
          <div
            ref={logRef}
            className={`mb-2 ${floating ? "max-h-32" : "max-h-48"} overflow-y-auto rounded-md bg-floor-panel px-3 py-2 text-sm text-floor-panel-foreground`}
          >
            {visible.map((m) => (
              <div key={m.k} className="leading-snug">
                <span
                  className={
                    m.id === localUserId
                      ? "font-medium text-floor-chat-you"
                      : "font-medium text-floor-chat-peer"
                  }
                >
                  {m.id === localUserId ? "You" : m.name}
                </span>
                <span className="text-floor-label">: </span>
                <span className="wrap-break-words">{m.text}</span>
              </div>
            ))}
          </div>
        )}

        <div className="flex items-center gap-2 rounded-lg bg-background/95 p-1.5 shadow-lg ring-1 ring-border backdrop-blur">
          <Badge variant="secondary" className="shrink-0 uppercase">
            {scope}
          </Badge>
          <Input
            ref={inputRef}
            value={text}
            maxLength={500}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault()
                // Empty input: Enter closes (like Esc); otherwise send.
                if (text.trim()) submit()
                else requestClose()
              } else if (e.key === "Escape") {
                e.preventDefault()
                requestClose()
              }
            }}
            placeholder="Say something…  (Enter to send · Esc to close)"
            className="border-0 shadow-none focus-visible:ring-0"
          />
          <Button variant="ghost" size="icon-sm" onClick={submit} aria-label="Send">
            <Send />
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={requestClose} aria-label="Close chat">
            <X />
          </Button>
        </div>
      </div>
    </>
  )
}
