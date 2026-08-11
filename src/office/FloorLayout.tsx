import { LAYOUT, rectToPx, seatSlots, type Zone } from "./layout"
import { AVATAR_SIZE, type Position, type Size } from "./types"

interface FloorLayoutProps {
  floor: Size
  /** Room id the local avatar is currently inside, or null. */
  currentRoom: string | null
  /** Peer positions, used to mark which seats are taken. */
  occupied: Position[]
  /** Join/leave a clicked room. */
  onEnter: (zone: Zone) => void
  /** Sit at (or, if it's your seat, stand from) a clicked chair. */
  onSit: (zone: Zone, seat: Position) => void
}

const EPS = 1e-6
const ROOM_RADIUS = 8 // px, on interior corners only
const ROOM_BORDER = 2 // px
const SEAT_D = AVATAR_SIZE * 0.72 // seat-indicator diameter
const HALF = AVATAR_SIZE / 2

/**
 * Draws the office layout beneath the avatars: rooms (click to join/leave — private
 * audio zones), tables (non-interactive furniture) and the chairs around each table
 * (click a chair to walk over and sit; taken chairs are filled in). Walls are solid bars.
 *
 * A room edge on a perimeter wall drops its border and squares that corner so it merges
 * into the wall as one line.
 */
export function FloorLayout({ floor, currentRoom, occupied, onEnter, onSit }: FloorLayoutProps) {
  return (
    <div className="absolute inset-0 pointer-events-none">
      {LAYOUT.map((zone) => {
        const box = rectToPx(zone.rect, floor)

        // Walls: solid bars, not interactive.
        if (zone.kind === "wall") {
          return (
            <div
              key={zone.id}
              className="absolute rounded-sm bg-black/45 pointer-events-none dark:bg-white/35"
              style={{ left: box.left, top: box.top, width: box.width, height: box.height }}
            />
          )
        }

        // Tables / dining: furniture only — you interact with the chairs, not the table.
        if (zone.kind === "table" || zone.kind === "dining") {
          const dining = zone.kind === "dining"
          return (
            <div
              key={zone.id}
              className={[
                "absolute flex items-center justify-center rounded-lg pointer-events-none",
                dining
                  ? "border border-amber-800/40 bg-amber-600/25 dark:border-amber-300/30 dark:bg-amber-400/15"
                  : "border border-black/15 bg-black/10 dark:border-white/15 dark:bg-white/10",
              ].join(" ")}
              style={{ left: box.left, top: box.top, width: box.width, height: box.height }}
            >
              {zone.label && (
                <span className="select-none font-semibold text-black/40 dark:text-white/40">
                  {zone.label}
                </span>
              )}
            </div>
          )
        }

        // Rooms (and toilets): click to join / leave.
        const r = zone.rect
        const onL = r.x <= EPS
        const onR = r.x + r.w >= 1 - EPS
        const onT = r.y <= EPS
        const onB = r.y + r.h >= 1 - EPS
        const toilet = zone.kind === "toilet"
        return (
          <div
            key={zone.id}
            onClick={() => onEnter(zone)}
            className={[
              "group absolute flex items-center justify-center cursor-pointer pointer-events-auto",
              toilet
                ? "border-cyan-700/40 bg-cyan-500/[.10] hover:bg-cyan-500/[.18] dark:border-cyan-300/30 dark:bg-cyan-400/[.10] dark:hover:bg-cyan-400/[.18]"
                : "border-black/30 bg-black/[.04] hover:bg-black/[.08] dark:border-white/25 dark:bg-white/[.04] dark:hover:bg-white/[.08]",
            ].join(" ")}
            style={{
              left: box.left,
              top: box.top,
              width: box.width,
              height: box.height,
              borderStyle: "solid",
              borderTopWidth: onT ? 0 : ROOM_BORDER,
              borderBottomWidth: onB ? 0 : ROOM_BORDER,
              borderLeftWidth: onL ? 0 : ROOM_BORDER,
              borderRightWidth: onR ? 0 : ROOM_BORDER,
              borderTopLeftRadius: onT || onL ? 0 : ROOM_RADIUS,
              borderTopRightRadius: onT || onR ? 0 : ROOM_RADIUS,
              borderBottomLeftRadius: onB || onL ? 0 : ROOM_RADIUS,
              borderBottomRightRadius: onB || onR ? 0 : ROOM_RADIUS,
            }}
          >
            {zone.label && (
              <span className="select-none font-semibold text-black/40 dark:text-white/40 group-hover:opacity-0">
                {zone.label}
              </span>
            )}
            <span className="pointer-events-none absolute rounded-full bg-black/75 px-3 py-1 text-sm font-medium text-white opacity-0 shadow-sm transition-opacity group-hover:opacity-100 dark:bg-white/90 dark:text-black">
              {currentRoom === zone.id ? `Leave ${zone.label}` : `Join ${zone.label}`}
            </span>
          </div>
        )
      })}

      {/* Chairs: click a free one to sit; taken ones are filled. */}
      {LAYOUT.filter((z) => z.kind === "table" || z.kind === "dining").flatMap((z) =>
        seatSlots(z, floor, HALF).map((s, i) => {
          const taken = occupied.some((o) => Math.hypot(o.x - s.x, o.y - s.y) < HALF * 1.5)
          return (
            <div
              key={`${z.id}-seat-${i}`}
              onClick={taken ? undefined : () => onSit(z, s)}
              title={taken ? undefined : "Sit here"}
              className={[
                "absolute rounded-full border",
                taken
                  ? "border-black/25 bg-black/25 pointer-events-none dark:border-white/25 dark:bg-white/25"
                  : "cursor-pointer pointer-events-auto border-dashed border-black/40 hover:bg-black/15 dark:border-white/40 dark:hover:bg-white/15",
              ].join(" ")}
              style={{ width: SEAT_D, height: SEAT_D, left: s.x - SEAT_D / 2, top: s.y - SEAT_D / 2 }}
            />
          )
        }),
      )}
    </div>
  )
}
