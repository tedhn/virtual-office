import { isPrivateRoom, rectToPx, seatSlots, type Layout, type Zone } from "./layout"
import { AVATAR_SIZE, type Position } from "./types"

interface FloorLayoutProps {
  /** The office being drawn: floor dimensions plus every zone on it. */
  layout: Layout
  /** Id of the Room the local avatar is standing inside, private or not, else null. */
  insideRoom: string | null
  /** Peer positions, used to mark which seats are taken. */
  occupied: Position[]
  /** Join/leave a clicked room. Omitted when the Floor is only being looked at. */
  onEnter?: (zone: Zone) => void
  /** Sit at (or, if it's your seat, stand from) a clicked chair. Omitted likewise. */
  onSit?: (zone: Zone, seat: Position) => void
}

const EPS = 1e-6
const ROOM_RADIUS = 8 // px, on interior corners only
const ROOM_BORDER = 2 // px
const SEAT_D = AVATAR_SIZE * 0.72 // seat-indicator diameter
const HALF = AVATAR_SIZE / 2

/**
 * Draws the office layout beneath the avatars: Rooms (click to join/leave; a private one
 * isolates audio, video and chat), Tables (non-interactive furniture) and the chairs
 * around each Table (click a free chair to walk over and sit; taken chairs are filled
 * in). Walls and the Exterior are solid bars/regions. The Spawn Zone is ordinary open
 * floor, so it draws nothing.
 *
 * A Room edge on a perimeter wall drops its border and squares that corner so it merges
 * into the wall as one line.
 *
 * Without `onEnter` / `onSit` the same Floor draws as something to look at rather than
 * something to walk on: no cursors, no hover prompts, nothing clickable. That is how an
 * Office renders for someone who is not standing in it.
 */
export function FloorLayout({ layout, insideRoom, occupied, onEnter, onSit }: FloorLayoutProps) {
  return (
    <div className="absolute inset-0 pointer-events-none">
      {layout.zones.map((zone) => {
        const box = rectToPx(zone.rect, layout.floor)

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

        // Exterior: outside the office's footprint. Solid, visual only.
        if (zone.kind === "exterior") {
          return (
            <div
              key={zone.id}
              className="absolute bg-black/[.07] pointer-events-none dark:bg-white/[.05]"
              style={{ left: box.left, top: box.top, width: box.width, height: box.height }}
            />
          )
        }

        // Spawn: where arrivals appear, and nothing else. Plain walkable floor to look at.
        if (zone.kind === "spawn") return null

        // Tables: furniture only — you interact with the chairs, not the table. Styling
        // is cosmetic; a dining table behaves exactly like a plain one.
        if (zone.kind === "table") {
          const dining = zone.style === "dining"
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

        // Rooms: click to join / leave. A non-private one is tinted differently, since
        // walking in doesn't cut you off from the open Floor.
        const r = zone.rect
        const onL = r.x <= EPS
        const onR = r.x + r.w >= 1 - EPS
        const onT = r.y <= EPS
        const onB = r.y + r.h >= 1 - EPS
        const nonPrivate = !isPrivateRoom(zone)
        return (
          <div
            key={zone.id}
            onClick={onEnter ? () => onEnter(zone) : undefined}
            className={[
              "group absolute flex items-center justify-center",
              onEnter ? "cursor-pointer pointer-events-auto" : "pointer-events-none",
              nonPrivate
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
            {onEnter && (
              <span className="pointer-events-none absolute rounded-full bg-black/75 px-3 py-1 text-sm font-medium text-white opacity-0 shadow-sm transition-opacity group-hover:opacity-100 dark:bg-white/90 dark:text-black">
                {insideRoom === zone.id ? `Leave ${zone.label}` : `Join ${zone.label}`}
              </span>
            )}
          </div>
        )
      })}

      {/* Chairs: click a free one to sit; taken ones are filled. */}
      {layout.zones
        .filter((z) => z.kind === "table")
        .flatMap((z) =>
          seatSlots(layout, z, HALF).map((s, i) => {
            const taken = occupied.some((o) => Math.hypot(o.x - s.x, o.y - s.y) < HALF * 1.5)
            const sittable = onSit && !taken
            return (
              <div
                key={`${z.id}-seat-${i}`}
                onClick={sittable ? () => onSit(z, s) : undefined}
                title={sittable ? "Sit here" : undefined}
                className={[
                  "absolute rounded-full border",
                  taken
                    ? "border-black/25 bg-black/25 pointer-events-none dark:border-white/25 dark:bg-white/25"
                    : "border-dashed border-black/40 dark:border-white/40",
                  sittable
                    ? "cursor-pointer pointer-events-auto hover:bg-black/15 dark:hover:bg-white/15"
                    : "pointer-events-none",
                ].join(" ")}
                style={{ width: SEAT_D, height: SEAT_D, left: s.x - SEAT_D / 2, top: s.y - SEAT_D / 2 }}
              />
            )
          }),
        )}
    </div>
  )
}
