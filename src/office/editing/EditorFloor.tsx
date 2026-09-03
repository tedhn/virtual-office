import { useRef } from "react"
import { FloorCanvas } from "../FloorCanvas"
import { FloorLayout } from "../FloorLayout"
import { rectToPx, type Layout } from "../layout"
import { moveZone, resizeZone, RESIZE_HANDLES, type ResizeHandle } from "./layoutEdits"

interface EditorFloorProps {
  /** The draft being authored, drawn whole. */
  layout: Layout
  /** Id of the Zone currently selected, or null. */
  selectedId: string | null
  onSelect: (id: string | null) => void
  /** The draft as a drag has left it. Called continuously while dragging. */
  onChange: (layout: Layout) => void
}

/** Screen px, held constant however far the Floor is scaled down. */
const HANDLE_PX = 10
const OUTLINE_PX = 2

/** Where each handle sits on the selected Zone, as a fraction of its box. */
const HANDLE_SPOT: Record<ResizeHandle, { fx: number; fy: number; cursor: string }> = {
  nw: { fx: 0, fy: 0, cursor: "nwse-resize" },
  n: { fx: 0.5, fy: 0, cursor: "ns-resize" },
  ne: { fx: 1, fy: 0, cursor: "nesw-resize" },
  w: { fx: 0, fy: 0.5, cursor: "ew-resize" },
  e: { fx: 1, fy: 0.5, cursor: "ew-resize" },
  sw: { fx: 0, fy: 1, cursor: "nesw-resize" },
  s: { fx: 0.5, fy: 1, cursor: "ns-resize" },
  se: { fx: 1, fy: 1, cursor: "nwse-resize" },
}

/** What a pointer is in the middle of doing. */
interface Drag {
  id: string
  handle: ResizeHandle | null
  /** The Layout as it was when the drag began — every move is measured from here. */
  from: Layout
  startX: number
  startY: number
}

/**
 * The Floor, as something to author rather than to walk on.
 *
 * `FloorLayout` draws the Zones — the same renderer a Visitor sees, so what is being
 * authored looks like what will be published. Everything this file adds sits on top of
 * that: one transparent box per Zone to grab, an outline on the selected one, and its
 * eight resize handles.
 *
 * A drag is measured from the Layout it started on, not accumulated step by step, which is
 * what makes dragging into an edge behave: the Zone stops at the Floor's edge and comes
 * away again the moment the pointer comes back, rather than lagging by however far the
 * pointer travelled while it was stuck. Holding that origin is the reason the edit itself
 * is applied here rather than handed upward as a delta — the Layout a drag started on is
 * this component's, and nobody else should have to be told about it.
 */
export function EditorFloor({ layout, selectedId, onSelect, onChange }: EditorFloorProps) {
  const drag = useRef<Drag | null>(null)
  const { floor } = layout

  const begin = (e: React.PointerEvent, id: string, handle: ResizeHandle | null) => {
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    onSelect(id)
    drag.current = { id, handle, from: layout, startX: e.clientX, startY: e.clientY }
  }

  const during = (e: React.PointerEvent, scale: number) => {
    const active = drag.current
    if (!active || scale <= 0) return
    const dx = (e.clientX - active.startX) / scale / floor.width
    const dy = (e.clientY - active.startY) / scale / floor.height
    onChange(
      active.handle
        ? resizeZone(active.from, active.id, active.handle, { dx, dy })
        : moveZone(active.from, active.id, { dx, dy }),
    )
  }

  const end = (e: React.PointerEvent) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
    drag.current = null
  }

  const selected = layout.zones.find((z) => z.id === selectedId)

  return (
    // A press that reaches the Floor itself landed on none of the Zones above it.
    <FloorCanvas floor={floor} onPointerDown={() => onSelect(null)}>
      {(scale) => {
        /** Screen px as world px, so a handle is the same size however far the Floor shrinks. */
        const world = (px: number) => (scale > 0 ? px / scale : px)
        const selectedBox = selected ? rectToPx(selected.rect, floor) : null
        const outline = world(OUTLINE_PX)
        const handleSize = world(HANDLE_PX)

        return (
          <>
            {/* The Zones themselves, drawn exactly as a Visitor will see them. No callbacks:
                nothing here is a Room to be entered or a chair to be taken. */}
            <FloorLayout layout={layout} insideRoom={null} occupied={[]} />

            {/* One grab box per Zone, in the order they are drawn — so the topmost Zone is
                also the one a press finds, which is the one that looks topmost. */}
            {layout.zones.map((zone) => {
              const box = rectToPx(zone.rect, floor)
              return (
                <div
                  key={zone.id}
                  className="absolute cursor-move"
                  style={{ left: box.left, top: box.top, width: box.width, height: box.height }}
                  onPointerDown={(e) => begin(e, zone.id, null)}
                  onPointerMove={(e) => during(e, scale)}
                  onPointerUp={end}
                  onPointerCancel={end}
                />
              )
            })}

            {selected && selectedBox && (
              <>
                <div
                  className="pointer-events-none absolute border-sky-500"
                  style={{
                    left: selectedBox.left - outline,
                    top: selectedBox.top - outline,
                    width: selectedBox.width + outline * 2,
                    height: selectedBox.height + outline * 2,
                    borderWidth: outline,
                    borderStyle: "solid",
                  }}
                />

                {RESIZE_HANDLES.map((handle) => {
                  const { fx, fy, cursor } = HANDLE_SPOT[handle]
                  return (
                    <div
                      key={handle}
                      className="absolute rounded-[1px] border-white bg-sky-500"
                      style={{
                        left: selectedBox.left + selectedBox.width * fx - handleSize / 2,
                        top: selectedBox.top + selectedBox.height * fy - handleSize / 2,
                        width: handleSize,
                        height: handleSize,
                        borderWidth: world(1),
                        borderStyle: "solid",
                        cursor,
                      }}
                      onPointerDown={(e) => begin(e, selected.id, handle)}
                      onPointerMove={(e) => during(e, scale)}
                      onPointerUp={end}
                      onPointerCancel={end}
                    />
                  )
                })}
              </>
            )}
          </>
        )
      }}
    </FloorCanvas>
  )
}
