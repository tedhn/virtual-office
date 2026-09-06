import { isPrivateRoom, type Zone } from "./layout"

/**
 * What a Zone looks like, decided once and away from the drawing.
 *
 * Two things live here that used to be scattered through `FloorLayout` as utility strings.
 *
 * The first is the colour. Every Zone is painted from a named token — `bg-zone-wall`, not
 * `bg-black/45` — so the next palette is one edit to `index.css` rather than a hunt
 * through call sites for an opacity somebody guessed at. `zoneAppearance.test.ts` holds
 * that rule by refusing any class naming a raw colour.
 *
 * The second is that colour is not the only channel. A private Room isolates the audio,
 * video and chat of everyone inside it, and whether you are about to walk into one is not
 * something to say in hue alone: anyone who cannot separate the two tints would be walking
 * into a private Room unawares. So a Room carries three signals that agree — its tint, a
 * wall drawn solid or broken, and a glyph beside its name — and a Seat carries two.
 */

/** A glyph drawn beside a Zone's label. `FloorLayout` decides which icon each one is. */
export type ZoneMark = "private" | "nonprivate" | null

export interface ZoneAppearance {
  /** Fill, border colour, hover and depth, all as token-backed utilities. */
  className: string
  /** The channel that is not colour: a solid wall seals, a broken one does not. */
  borderStyle: "solid" | "dashed"
  /** The channel that is neither colour nor shape. Null where a Zone says nothing. */
  mark: ZoneMark
}

export interface SeatAppearance {
  /** A taken Seat's token paints a fill; a free one's paints only its ring. */
  className: string
  borderStyle: "solid" | "dashed"
}

/**
 * A Zone's paint, by kind — and for a Room, by whether it is private.
 *
 * Walls and Tables carry a shadow because a Floor is a room seen from above: furniture
 * sits on the surface, a Wall rises off it. Rooms and the Exterior do not, being regions
 * of the Floor rather than objects standing on it.
 */
export function zoneAppearance(zone: Zone): ZoneAppearance {
  switch (zone.kind) {
    case "wall":
      return { className: "bg-zone-wall shadow-wall", borderStyle: "solid", mark: null }

    case "exterior":
      return { className: "bg-zone-exterior", borderStyle: "solid", mark: null }

    case "spawn":
      // Drawn as nothing for a Visitor — see `FloorLayout`. These are the Owner's colours,
      // used by `EditorFloor` alone, and kept here so every Zone's paint is in one file.
      return {
        className: "border-zone-spawn-border bg-zone-spawn text-zone-spawn-label",
        borderStyle: "dashed",
        mark: null,
      }

    case "table":
      return zone.style === "dining"
        ? {
            className: "border-zone-dining-border bg-zone-dining shadow-zone",
            borderStyle: "solid",
            mark: null,
          }
        : {
            className: "border-zone-table-border bg-zone-table shadow-zone",
            borderStyle: "solid",
            mark: null,
          }

    case "room":
      return isPrivateRoom(zone)
        ? {
            className:
              "border-zone-room-private-border bg-zone-room-private hover:bg-zone-room-private-hover",
            borderStyle: "solid",
            mark: "private",
          }
        : {
            className:
              "border-zone-room-nonprivate-border bg-zone-room-nonprivate hover:bg-zone-room-nonprivate-hover",
            borderStyle: "dashed",
            mark: "nonprivate",
          }
  }
}

/**
 * A Seat's paint. Taken and free differ in fill and in ring, not only in colour: a taken
 * chair is a filled disc with a solid ring, a free one an outline with a broken one.
 *
 * `sittable` is not the same question as `taken`. A Floor being looked at rather than
 * stood on has free Seats that nobody can take, and offering a hover on one would promise
 * a click that does nothing.
 */
export function seatAppearance({
  taken,
  sittable,
}: {
  taken: boolean
  sittable: boolean
}): SeatAppearance {
  if (taken) {
    return { className: "border-zone-seat-taken bg-zone-seat-taken", borderStyle: "solid" }
  }
  return {
    className: sittable ? "border-zone-seat hover:bg-zone-seat-hover" : "border-zone-seat",
    borderStyle: "dashed",
  }
}
