import { useEffect, useRef, useState } from "react"
import type { PeerState } from "./useRealtime"

const LERP = 0.25 // per-frame approach toward target (higher = snappier)

/**
 * Renders peer positions smoothly. The relay delivers discrete target positions;
 * this rAF loop eases each avatar toward its latest target so motion looks fluid
 * regardless of network jitter. Reads `targetsRef` (mutated by the socket) and
 * returns render-ready positions as state.
 */
export function useInterpolatedPositions(
  targetsRef: React.RefObject<Map<string, PeerState>>,
): Record<string, PeerState> {
  const [rendered, setRendered] = useState<Record<string, PeerState>>({})
  const renderedRef = useRef<Record<string, PeerState>>({})

  useEffect(() => {
    let raf = 0
    const tick = () => {
      raf = requestAnimationFrame(tick)
      const targets = targetsRef.current
      const prev = renderedRef.current
      const next: Record<string, PeerState> = {}
      let changed = false

      for (const [id, target] of targets) {
        const cur = prev[id]
        if (!cur) {
          next[id] = { ...target } // new peer: snap into place
          changed = true
          continue
        }
        const x = cur.x + (target.x - cur.x) * LERP
        const y = cur.y + (target.y - cur.y) * LERP
        next[id] = { x, y, name: target.name, deafened: target.deafened, watching: target.watching }
        if (
          Math.abs(x - cur.x) > 0.05 ||
          Math.abs(y - cur.y) > 0.05 ||
          cur.name !== target.name ||
          cur.deafened !== target.deafened ||
          cur.watching !== target.watching
        ) {
          changed = true
        }
      }

      // Detect removals.
      for (const id in prev) if (!(id in next)) changed = true

      if (changed) {
        renderedRef.current = next
        setRendered(next)
      }
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [targetsRef])

  return rendered
}
