// The `.ts` extension matches this module's neighbours in `src/office/`, several of which
// need it because the server loads them from source (ADR-0004). This one does not: its
// only import is a type, erased before anything runs. Adding a *runtime* import here would
// bring it under that rule.
import type { Layout, Rect, Zone, ZoneKind } from "../layout.ts"

/**
 * Authoring a Layout: the edits an Owner makes, as functions from a Layout to a Layout.
 *
 * One invariant holds across every function here, and it is the reason they exist rather
 * than the screen editing rects directly: **what comes out is always structurally a
 * Layout**. Rects stay on the Floor, Zones keep a size somebody can grab, and a flag that
 * belongs to one kind never lands on another.
 *
 * That is not the same as the Layout being any good. A draft is free to be an Office
 * nobody could use — no Spawn Zone, rooms stacked on each other, a Floor of nothing at all
 * — and staying that way is the point of a draft (CONTEXT.md, Layout). What it is not free
 * to be is malformed, because `saveDraft` refuses to store a document that is not a Layout,
 * and an Owner losing their work to a rect that slid off the Floor would be this module's
 * fault.
 *
 * Everything is in normalized floor space (0..1), which is how a Layout stores rects. The
 * screen converts pointer pixels into that space; nothing here knows about pixels, apart
 * from the one minimum below that has to.
 */

/**
 * Smallest a Zone may be dragged down to, in world px. Below this it is a Zone nobody can
 * click to grow again, which in an editor is the same as losing it — and the schema's own
 * floor of "greater than zero" is no help there. In px rather than a fraction because the
 * Floor is not square: 0.01 of the height and 0.01 of the width are different sizes.
 */
const MIN_ZONE_PX = 16

/**
 * What each kind is when it first lands: a size that reads as the thing it is, and is big
 * enough to grab. A wall arrives as a bar, a table as furniture, a room as a room.
 */
const STARTING_SIZE: Record<ZoneKind, { w: number; h: number }> = {
  room: { w: 0.4, h: 0.12 },
  table: { w: 0.3, h: 0.05 },
  wall: { w: 0.3, h: 0.008 },
  spawn: { w: 0.24, h: 0.06 },
  exterior: { w: 0.3, h: 0.1 },
}

/** A drag, in normalized floor space. */
export interface Delta {
  dx: number
  dy: number
}

/**
 * Which part of a Zone is being dragged: a corner moves two edges, a side moves one. The
 * edges not named stay exactly where they are, which is what makes a resize feel like
 * pulling one side rather than moving the whole thing.
 */
export type ResizeHandle = "nw" | "n" | "ne" | "w" | "e" | "sw" | "s" | "se"

export const RESIZE_HANDLES: ResizeHandle[] = ["nw", "n", "ne", "w", "e", "sw", "s", "se"]

const clamp = (value: number, low: number, high: number) =>
  Math.max(low, Math.min(high, value))

/**
 * Normalized coordinates kept to six places — a thousandth of a pixel on any Floor anyone
 * will author. Every edit is computed from the rect the last one produced, so without this
 * a Zone dragged back and forth all afternoon accumulates binary-fraction dust: a stored
 * draft full of 0.30000000000000004, and a slow drift nobody asked for.
 */
const PLACES = 1e6
const round = (value: number) => Math.round(value * PLACES) / PLACES

/**
 * Round a rect, and repair the one thing rounding can break.
 *
 * Callers hand this a rect already on the Floor, so all it does is tidy the numbers — and
 * then check, because rounding four numbers independently can nudge an origin a hair past
 * what its own size leaves room for, and `x + w > 1` is a malformed Layout however small
 * the hair. Repairing rather than clamping up front is deliberate: `1 - w` is itself a
 * float with dust on it (`1 - 0.8` is not `0.2`), so clamping against it would put the
 * dust back into every rect to prevent a case that almost never arises.
 */
function tidy(rect: Rect): Rect {
  const w = round(rect.w)
  const h = round(rect.h)
  let x = round(rect.x)
  let y = round(rect.y)
  if (x + w > 1) x = Math.max(0, 1 - w)
  if (y + h > 1) y = Math.max(0, 1 - h)
  return { x, y, w, h }
}

/** Replace one Zone, leaving the Layout it came from untouched. */
function withZone(layout: Layout, id: string, change: (zone: Zone) => Zone): Layout {
  if (!layout.zones.some((z) => z.id === id)) return layout
  return { ...layout, zones: layout.zones.map((z) => (z.id === id ? change(z) : z)) }
}

/**
 * An id for a new Zone of this kind: its kind and the lowest number not already spoken
 * for. Duplicate ids are a malformed Layout, so this is the caller's protection against
 * the one mistake that would cost them their draft.
 */
export function newZoneId(layout: Layout, kind: ZoneKind): string {
  const taken = new Set(layout.zones.map((z) => z.id))
  let n = 1
  while (taken.has(`${kind}-${n}`)) n++
  return `${kind}-${n}`
}

/**
 * How far each successive Zone is offset from the middle, and how many steps before the
 * cascade starts over. Dropping three Rooms in a row and getting one Room-shaped pile —
 * where only the top one can be grabbed, and the others have to be dug out — is the
 * failure this prevents.
 */
const CASCADE_STEP = 0.03
const CASCADE_LENGTH = 6

/**
 * Drop a Zone on the Floor: near the middle, on top of everything else, at the starting
 * size for its kind. The Owner drags it where they want it from there.
 *
 * Near rather than exactly, because Zones arrive one after another: each lands a step
 * further down the cascade than the last, so a handful dropped in a row are all reachable
 * without moving any of them first.
 */
export function addZone(layout: Layout, kind: ZoneKind, id: string): Layout {
  const { w, h } = STARTING_SIZE[kind]
  const step = (layout.zones.length % CASCADE_LENGTH) * CASCADE_STEP
  const zone: Zone = {
    id,
    kind,
    rect: tidy({
      x: clamp(0.5 - w / 2 + step, 0, 1 - w),
      y: clamp(0.5 - h / 2 + step, 0, 1 - h),
      w,
      h,
    }),
  }
  return { ...layout, zones: [...layout.zones, zone] }
}

/** Take a Zone off the Floor. A Floor with nothing on it is a perfectly good draft. */
export function removeZone(layout: Layout, id: string): Layout {
  return { ...layout, zones: layout.zones.filter((z) => z.id !== id) }
}

/** Shift a Zone by a drag, stopping at the edges of the Floor rather than going over. */
export function moveZone(layout: Layout, id: string, { dx, dy }: Delta): Layout {
  return withZone(layout, id, (zone) => ({
    ...zone,
    rect: tidy({
      ...zone.rect,
      x: clamp(zone.rect.x + dx, 0, 1 - zone.rect.w),
      y: clamp(zone.rect.y + dy, 0, 1 - zone.rect.h),
    }),
  }))
}

/**
 * Pull one corner or side of a Zone. The edges the handle does not name hold still, and
 * the ones it does stop at the Floor's edge in one direction and at the minimum size in
 * the other — so a resize can neither leave the Floor nor collapse the Zone.
 */
export function resizeZone(
  layout: Layout,
  id: string,
  handle: ResizeHandle,
  { dx, dy }: Delta,
): Layout {
  const minW = MIN_ZONE_PX / layout.floor.width
  const minH = MIN_ZONE_PX / layout.floor.height

  return withZone(layout, id, (zone) => {
    let { x: left, y: top } = zone.rect
    let right = left + zone.rect.w
    let bottom = top + zone.rect.h

    // A handle never names two opposite edges, so each clamp can read the other edge as
    // the fixed one it is.
    if (handle.includes("w")) left = clamp(left + dx, 0, right - minW)
    if (handle.includes("e")) right = clamp(right + dx, left + minW, 1)
    if (handle.includes("n")) top = clamp(top + dy, 0, bottom - minH)
    if (handle.includes("s")) bottom = clamp(bottom + dy, top + minH, 1)

    return { ...zone, rect: tidy({ x: left, y: top, w: right - left, h: bottom - top }) }
  })
}

/** The fields an Owner can set on a Zone, beyond where it is and how big it is. */
export interface ZonePatch {
  label?: string
  private?: boolean
  style?: "plain" | "dining"
  seats?: number
}

/**
 * Change what a Zone is: its name, and the flags its kind allows.
 *
 * Flags belong to kinds — privacy is a Room's, styling and seat count are a Table's — and
 * the schema rejects a Layout that has them anywhere else. So a flag offered to the wrong
 * kind is dropped here rather than written and refused at save time. An emptied label is
 * dropped too: a Zone with no name and a Zone named "" should not be two different
 * documents.
 */
export function updateZone(layout: Layout, id: string, patch: ZonePatch): Layout {
  return withZone(layout, id, (zone) => {
    const next: Zone = { ...zone }

    if (patch.label !== undefined) {
      const label = patch.label.trim()
      if (label) next.label = label
      else delete next.label
    }

    if (patch.private !== undefined && zone.kind === "room") next.private = patch.private

    if (zone.kind === "table") {
      if (patch.style !== undefined) next.style = patch.style
      if (patch.seats !== undefined) next.seats = patch.seats
    }

    return next
  })
}
