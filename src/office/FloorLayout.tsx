import { DoorOpen, Lock } from "lucide-react"
import { rectToPx, seatSlots, type Layout, type Zone } from "./layout"
import { AVATAR_SIZE, type Position } from "./types"
import { seatAppearance, zoneAppearance, type ZoneMark } from "./zoneAppearance"

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

/** The glyph for a Room's privacy, drawn beside its name. See `zoneAppearance`. */
const MARK_ICON: Record<Exclude<ZoneMark, null>, typeof Lock> = {
  private: Lock,
  nonprivate: DoorOpen,
}

/** The mark as a picture. The words beside it are `MARK_LABEL`'s, for readers who need them. */
function MarkIcon({ mark }: { mark: Exclude<ZoneMark, null> }) {
  const Icon = MARK_ICON[mark]
  return <Icon className="size-4 shrink-0" aria-hidden focusable="false" />
}

/**
 * The one thing a Room's mark has to say, in words, for anyone who cannot see it: whether
 * walking in cuts you off from the Floor.
 */
const MARK_LABEL: Record<Exclude<ZoneMark, null>, string> = {
  private: "Private room: voices, video and chat stay inside",
  nonprivate: "Non-private room: voices, video and chat carry to the open floor",
}

/**
 * Draws the office layout beneath the avatars: Rooms (click to join/leave; a private one
 * isolates audio, video and chat), Tables (non-interactive furniture) and the chairs
 * around each Table (click a free chair to walk over and sit; taken chairs are filled
 * in). Walls and the Exterior are solid bars/regions. The Spawn Zone is ordinary open
 * floor, so it draws nothing — `EditorFloor` marks it for the Owner instead, because a
 * Zone that has to be moved has to be findable, and a Visitor being shown where the
 * arrivals area is would be a promise the Office does not keep.
 *
 * What each Zone is painted with is `zoneAppearance`'s, not this file's: named tokens
 * rather than opacities guessed at here, and — for the difference between a private Room
 * and a non-private one — three signals that agree rather than a hue on its own.
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
        const appearance = zoneAppearance(zone)

        // Walls: solid bars, not interactive.
        if (zone.kind === "wall") {
          return (
            <div
              key={zone.id}
              className={`absolute rounded-sm pointer-events-none ${appearance.className}`}
              style={{ left: box.left, top: box.top, width: box.width, height: box.height }}
            />
          )
        }

        // Exterior: outside the office's footprint. Solid, visual only.
        if (zone.kind === "exterior") {
          return (
            <div
              key={zone.id}
              className={`absolute pointer-events-none ${appearance.className}`}
              style={{ left: box.left, top: box.top, width: box.width, height: box.height }}
            />
          )
        }

        // Spawn: where arrivals appear, and nothing else. Plain walkable floor to look at.
        if (zone.kind === "spawn") return null

        // Tables: furniture only — you interact with the chairs, not the table. Styling
        // is cosmetic; a dining table behaves exactly like a plain one.
        if (zone.kind === "table") {
          return (
            <div
              key={zone.id}
              className={`absolute flex items-center justify-center rounded-lg border pointer-events-none ${appearance.className}`}
              style={{ left: box.left, top: box.top, width: box.width, height: box.height }}
            >
              {zone.label && (
                <span className="select-none font-semibold text-floor-label">{zone.label}</span>
              )}
            </div>
          )
        }

        // Rooms: click to join / leave. A non-private one is tinted, bordered and marked
        // differently, since walking in doesn't cut you off from the open Floor.
        const r = zone.rect
        const onL = r.x <= EPS
        const onR = r.x + r.w >= 1 - EPS
        const onT = r.y <= EPS
        const onB = r.y + r.h >= 1 - EPS
        const mark = appearance.mark
        return (
          <div
            key={zone.id}
            onClick={onEnter ? () => onEnter(zone) : undefined}
            className={[
              "group absolute flex items-center justify-center",
              onEnter ? "cursor-pointer pointer-events-auto" : "pointer-events-none",
              appearance.className,
            ].join(" ")}
            style={{
              left: box.left,
              top: box.top,
              width: box.width,
              height: box.height,
              borderStyle: appearance.borderStyle,
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
            {/* Name and privacy mark. The mark is drawn whether or not the Room is named,
                because it is the label that is decoration here and the mark that is not:
                which side of a private wall you are about to step over is the one thing
                this Zone has to say.

                It is also the channel that always survives. A Room flush against a
                perimeter wall drops that edge's border to merge into it, which costs the
                solid-versus-broken signal on that side; the glyph is drawn regardless. */}
            <span className="flex select-none items-center gap-1.5 font-semibold text-floor-label group-hover:opacity-0">
              {mark && <MarkIcon mark={mark} />}
              {zone.label}
              {mark && <span className="sr-only">{MARK_LABEL[mark]}</span>}
            </span>
            {onEnter && (
              <span className="pointer-events-none absolute rounded-full bg-floor-prompt px-3 py-1 text-sm font-medium text-floor-prompt-foreground opacity-0 shadow-md transition-opacity group-hover:opacity-100">
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
            const sittable = !!onSit && !taken
            const seat = seatAppearance({ taken, sittable })
            return (
              <div
                key={`${z.id}-seat-${i}`}
                onClick={sittable ? () => onSit(z, s) : undefined}
                title={sittable ? "Sit here" : taken ? "Taken" : undefined}
                className={[
                  "absolute rounded-full border",
                  sittable ? "cursor-pointer pointer-events-auto" : "pointer-events-none",
                  seat.className,
                ].join(" ")}
                style={{
                  width: SEAT_D,
                  height: SEAT_D,
                  left: s.x - SEAT_D / 2,
                  top: s.y - SEAT_D / 2,
                  borderStyle: seat.borderStyle,
                }}
              />
            )
          }),
        )}
    </div>
  )
}
