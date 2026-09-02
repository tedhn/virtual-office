import { useCallback, useEffect, useRef, useState } from "react"
import { hitsTable, zoneAt, type Layout } from "./layout"
import {
  AVATAR_SIZE,
  MOVE_SPEED,
  type Position,
  type Size,
} from "./types"

const HALF = AVATAR_SIZE / 2
const SEND_INTERVAL = 33 // ms between position sends while moving (~30 Hz)
const IDLE_INTERVAL = 1000 // heartbeat while idle so peers/late joiners know our spot

function clamp(pos: Position, floor: Size): Position {
  return {
    x: Math.max(HALF, Math.min(floor.width - HALF, pos.x)),
    y: Math.max(HALF, Math.min(floor.height - HALF, pos.y)),
  }
}

// Per-axis collision so movement slides along edges instead of sticking. Tables are
// solid (skip when already inside one so you can walk back out); room walls block
// crossing a room boundary (rooms change only via Join/Leave teleport).
function resolveMove(cur: Position, nx: number, ny: number, layout: Layout): Position {
  if (!hitsTable(layout, cur, HALF)) {
    if (hitsTable(layout, { x: nx, y: cur.y }, HALF)) nx = cur.x
    if (hitsTable(layout, { x: nx, y: ny }, HALF)) ny = cur.y
  }
  // Room-like enclosures (rooms AND toilets) block wall-crossing, so entering/leaving
  // stays teleport-only via click — even though toilets aren't private.
  const zone0 = zoneAt(layout, cur)
  if (zoneAt(layout, { x: nx, y: cur.y }) !== zone0) nx = cur.x
  if (zoneAt(layout, { x: nx, y: ny }) !== zone0) ny = cur.y
  return clamp({ x: nx, y: ny }, layout.floor)
}

const HELD_KEYS: Record<string, [number, number]> = {
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  w: [0, -1],
  s: [0, 1],
  a: [-1, 0],
  d: [1, 0],
}

export interface Movement {
  pos: Position
  /** Jump the local avatar to a spot instantly (used to join/leave rooms); clamps + broadcasts. */
  teleport: (to: Position) => void
  /** Glide the local avatar to a spot over time (used to walk to a table seat). Any key press cancels it. */
  walkTo: (to: Position) => void
  /**
   * Set a continuous movement vector from the on-screen joystick. Components are a
   * normalized -1..1 screen-space direction (up = negative y, matching the arrow keys).
   * (0, 0) stops. Fed into the same rAF loop as the keyboard.
   */
  move: (dx: number, dy: number) => void
}

/**
 * Drives the local avatar with WASD / arrow keys (or an autopilot target set via
 * walkTo) and streams its position to peers via `send`. Sends while moving (throttled),
 * once when movement stops, and on an idle heartbeat so late joiners learn our spot.
 */
export function useMovement(
  send: (x: number, y: number) => void,
  initial: Position,
  layout: Layout,
): Movement {
  const [pos, setPos] = useState<Position>(() => clamp(initial, layout.floor))
  const posRef = useRef<Position>(pos)
  const keys = useRef<Set<string>>(new Set())
  const pointer = useRef<Position>({ x: 0, y: 0 }) // joystick vector, added to key input
  const target = useRef<Position | null>(null) // autopilot destination (walkTo)
  const lastSend = useRef(0)
  const lastFrame = useRef<number | null>(null)
  const wasMoving = useRef(false)
  const sendRef = useRef(send)
  sendRef.current = send
  const layoutRef = useRef(layout)
  layoutRef.current = layout

  // On viewport shrink, pull the avatar back inside the new bounds and tell peers.
  useEffect(() => {
    const clamped = clamp(posRef.current, layout.floor)
    if (clamped.x !== posRef.current.x || clamped.y !== posRef.current.y) {
      posRef.current = clamped
      setPos(clamped)
      sendRef.current(clamped.x, clamped.y)
    }
  }, [layout])

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      // Ignore movement keys while typing (e.g. the chat bar) so WASD types instead of moves.
      const el = e.target as HTMLElement | null
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return
      if (e.key in HELD_KEYS) {
        keys.current.add(e.key)
        target.current = null // manual input cancels autopilot
        if (e.key.startsWith("Arrow")) e.preventDefault()
      }
    }
    const up = (e: KeyboardEvent) => keys.current.delete(e.key)
    const blur = () => keys.current.clear()

    window.addEventListener("keydown", down)
    window.addEventListener("keyup", up)
    window.addEventListener("blur", blur)

    let raf = 0
    const tick = (t: number) => {
      raf = requestAnimationFrame(tick)
      const prev = lastFrame.current ?? t
      lastFrame.current = t
      const dt = Math.min((t - prev) / 1000, 0.05)
      const l = layoutRef.current
      const cur = posRef.current

      let dx = 0
      let dy = 0
      for (const k of keys.current) {
        const v = HELD_KEYS[k]
        if (v) {
          dx += v[0]
          dy += v[1]
        }
      }
      // Joystick contributes on top of any keys (direction-only; normalized below).
      dx += pointer.current.x
      dy += pointer.current.y
      const manual = dx !== 0 || dy !== 0
      let moved = false

      if (manual) {
        const len = Math.hypot(dx, dy) || 1
        const next = resolveMove(cur, cur.x + (dx / len) * MOVE_SPEED * dt, cur.y + (dy / len) * MOVE_SPEED * dt, l)
        posRef.current = next
        setPos(next)
        moved = true
        if (t - lastSend.current >= SEND_INTERVAL) {
          lastSend.current = t
          sendRef.current(next.x, next.y)
        }
      } else if (target.current) {
        const tgt = target.current
        const ddx = tgt.x - cur.x
        const ddy = tgt.y - cur.y
        const d = Math.hypot(ddx, ddy)
        if (d < 2) {
          // Arrived: snap and broadcast the exact seat.
          posRef.current = tgt
          setPos(tgt)
          target.current = null
          lastSend.current = t
          sendRef.current(tgt.x, tgt.y)
        } else {
          const step = Math.min(d, MOVE_SPEED * dt)
          const next = resolveMove(cur, cur.x + (ddx / d) * step, cur.y + (ddy / d) * step, l)
          if (Math.hypot(next.x - cur.x, next.y - cur.y) < 0.5) {
            // Blocked by an obstacle we can't slide past (e.g. the seat's own table, or a
            // wall corner). Snap straight to the destination so the trip always completes.
            posRef.current = tgt
            setPos(tgt)
            target.current = null
            lastSend.current = t
            sendRef.current(tgt.x, tgt.y)
          } else {
            posRef.current = next
            setPos(next)
            moved = true
            if (t - lastSend.current >= SEND_INTERVAL) {
              lastSend.current = t
              sendRef.current(next.x, next.y)
            }
          }
        }
      } else if (wasMoving.current || t - lastSend.current >= IDLE_INTERVAL) {
        // Just stopped (send exact resting position) or idle heartbeat.
        lastSend.current = t
        sendRef.current(cur.x, cur.y)
      }

      wasMoving.current = moved
    }
    raf = requestAnimationFrame(tick)

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener("keydown", down)
      window.removeEventListener("keyup", up)
      window.removeEventListener("blur", blur)
      lastFrame.current = null
    }
  }, [])

  const teleport = useCallback((to: Position) => {
    target.current = null
    const next = clamp(to, layoutRef.current.floor)
    posRef.current = next
    setPos(next)
    lastSend.current = 0 // force the next tick to broadcast the new spot
    sendRef.current(next.x, next.y)
  }, [])

  const walkTo = useCallback((to: Position) => {
    target.current = clamp(to, layoutRef.current.floor)
  }, [])

  // On-screen joystick feeds a vector into the same rAF loop the keyboard uses, so collision,
  // throttling, and peer-sends all work unchanged. A push cancels autopilot, like a keydown.
  const move = useCallback((dx: number, dy: number) => {
    pointer.current = { x: dx, y: dy }
    if (dx !== 0 || dy !== 0) target.current = null
  }, [])

  return { pos, teleport, walkTo, move }
}
