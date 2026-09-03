import { useLayoutEffect, useRef, useState, type ReactNode } from "react"
import type { Size } from "./types"

interface FloorCanvasProps {
  /** The Floor's dimensions in world px. Everything inside is drawn in that space. */
  floor: Size
  /**
   * What to draw on it, in world px. Given the scale, because anything that should stay a
   * constant size on screen — a handle, an outline — has to divide by it.
   */
  children: (scale: number) => ReactNode
  /** A press that reached the Floor itself rather than anything drawn on it. */
  onPointerDown?: () => void
}

/**
 * A whole Floor, fitted into whatever space it is given.
 *
 * Contain rather than cover: whichever axis runs out first sets the scale, so the entire
 * footprint is on screen at once. That is what you want when you are looking at an Office
 * rather than standing in it — `OfficeFloor` is the other way to draw a Layout, zoomed to
 * a person and scrolled to follow them.
 *
 * Children are drawn in world px inside a scaled box, so they can use a Layout's own
 * coordinates directly and never think about the viewport.
 */
export function FloorCanvas({ floor, children, onPointerDown }: FloorCanvasProps) {
  const boxRef = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(0)

  useLayoutEffect(() => {
    const el = boxRef.current
    if (!el) return
    const measure = () =>
      setScale(Math.min(el.clientWidth / floor.width, el.clientHeight / floor.height))
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [floor.width, floor.height])

  return (
    <div ref={boxRef} className="flex h-full w-full items-center justify-center overflow-hidden">
      {/* Sizer takes the scaled footprint, so centring measures the drawn size. */}
      <div style={{ width: floor.width * scale, height: floor.height * scale }}>
        <div
          className="relative overflow-hidden rounded-xl border-2 border-black/40 bg-neutral-200 dark:border-white/25 dark:bg-neutral-900"
          style={{
            width: floor.width,
            height: floor.height,
            transform: `scale(${scale})`,
            transformOrigin: "top left",
            backgroundImage:
              "linear-gradient(to right, rgba(0,0,0,.06) 1px, transparent 1px), linear-gradient(to bottom, rgba(0,0,0,.06) 1px, transparent 1px)",
            backgroundSize: "40px 40px",
          }}
          onPointerDown={onPointerDown}
        >
          {children(scale)}
        </div>
      </div>
    </div>
  )
}
