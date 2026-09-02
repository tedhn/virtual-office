import { useLayoutEffect, useRef, useState } from "react"
import { FloorLayout } from "./FloorLayout"
import type { Layout } from "./layout"

interface FloorPreviewProps {
  /** The Office being drawn: floor dimensions plus every Zone on it. */
  layout: Layout
}

/**
 * An Office's Floor, whole, with nobody on it.
 *
 * `OfficeFloor` is the other way to draw a Layout: zoomed to a person's surroundings and
 * scrolled to follow them. This one has no person to follow, so it fits the entire Floor
 * into the viewport instead — you are looking at the Office rather than standing in it.
 */
export function FloorPreview({ layout }: FloorPreviewProps) {
  const boxRef = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(0)
  const { floor } = layout

  // Contain rather than cover: whichever axis runs out first sets the scale, so the whole
  // footprint is on screen at once.
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
    <div
      ref={boxRef}
      className="flex h-full w-full items-center justify-center overflow-hidden"
    >
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
        >
          {/* No callbacks: there is nobody here to enter a Room or take a seat. */}
          <FloorLayout layout={layout} insideRoom={null} occupied={[]} />
        </div>
      </div>
    </div>
  )
}
