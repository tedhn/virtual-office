import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react"

interface FloatingJoystickProps {
  /** Normalized -1..1 screen-space direction (up = negative y). (0,0) means stop. */
  onMove: (dx: number, dy: number) => void
}

const RADIUS = 60 // px of knob travel from the touch origin
const DEADZONE = 0.2
const DRAG_THRESHOLD = 8 // px of movement before a touch counts as a joystick drag (vs a tap)

/**
 * Touch movement for the bottom half of the screen. A drag anywhere in the zone spawns a
 * transient joystick at the finger and steers the avatar; a quick tap does nothing. The zone
 * is invisible (no background) — only the stick appears while dragging. Room/chair actions on
 * mobile go through the contextual action button (see MobileControls), not floor taps, so the
 * zone never needs to forward events to the office beneath it.
 */
export function FloatingJoystick({ onMove }: FloatingJoystickProps) {
  const origin = useRef<{ x: number; y: number } | null>(null)
  const engaged = useRef(false)
  const [stick, setStick] = useState<{ ox: number; oy: number; kx: number; ky: number } | null>(null)

  const down = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    origin.current = { x: e.clientX, y: e.clientY }
    engaged.current = false
  }

  const drag = (e: ReactPointerEvent<HTMLDivElement>) => {
    const o = origin.current
    if (!o) return
    let dx = e.clientX - o.x
    let dy = e.clientY - o.y
    if (!engaged.current) {
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return
      engaged.current = true // first real movement — this touch is a joystick drag, not a tap
    }
    const len = Math.hypot(dx, dy)
    if (len > RADIUS) {
      dx = (dx / len) * RADIUS
      dy = (dy / len) * RADIUS
    }
    setStick({ ox: o.x, oy: o.y, kx: dx, ky: dy })
    const nx = dx / RADIUS
    const ny = dy / RADIUS
    if (Math.hypot(nx, ny) < DEADZONE) onMove(0, 0)
    else onMove(nx, ny)
  }

  const up = () => {
    origin.current = null
    engaged.current = false
    onMove(0, 0)
    setStick(null)
  }

  return (
    <>
      <div
        onPointerDown={down}
        onPointerMove={drag}
        onPointerUp={up}
        onPointerCancel={up}
        onContextMenu={(e) => e.preventDefault()}
        aria-label="Movement area"
        className="absolute inset-x-0 bottom-0 z-30 h-1/2 touch-none select-none"
      />
      {stick && (
        <div className="pointer-events-none absolute inset-0 z-30">
          <div
            className="absolute rounded-full bg-black/15 ring-1 ring-white/40 backdrop-blur-sm"
            style={{
              width: RADIUS * 2,
              height: RADIUS * 2,
              left: stick.ox - RADIUS,
              top: stick.oy - RADIUS,
            }}
          />
          <div
            className="absolute rounded-full bg-white/80 shadow-lg ring-1 ring-black/10"
            style={{
              width: RADIUS,
              height: RADIUS,
              left: stick.ox + stick.kx - RADIUS / 2,
              top: stick.oy + stick.ky - RADIUS / 2,
            }}
          />
        </div>
      )}
    </>
  )
}
