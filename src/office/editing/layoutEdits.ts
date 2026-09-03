// The `.ts` extensions match this module's neighbours in `src/office/`, several of which
// need them because the server loads them from source (ADR-0004). Nothing on the server
// loads this one — authoring an Office is the browser's business — so that rule does not
// bind this file, and the extensions are here to spare the next reader working out which
// side of the line it falls on.
import type { Layout, Rect, Zone, ZoneKind } from "../layout.ts"
import { AVATAR_SIZE, type Size } from "../types.ts"

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
 * Rects are in normalized floor space (0..1), which is how a Layout stores them, and a
 * drag arrives already converted into it. World pixels turn up only where a person is
 * naming a real size: the minimum a Zone may be shrunk to, the range a Floor may be given,
 * and the numbers the inspector types (`placeZone`, `resizeFloor`) — because a pixel is
 * what an Owner is actually deciding about in each of those, and a fraction of a Floor is
 * not.
 */

/**
 * Smallest a Zone may be shrunk to, dragged or typed, in world px. Below this it is a Zone
 * nobody can click to grow again, which in an editor is the same as losing it — and the
 * schema's own floor of "greater than zero" is no help there. In px rather than a fraction
 * because the Floor is not square: 0.01 of the height and 0.01 of the width are different
 * sizes.
 *
 * Exported because a field an Owner types a size into has to say what size it will accept,
 * rather than quietly correcting them afterwards.
 */
export const MIN_ZONE_PX = 16

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

/**
 * The smallest and largest Floor an Owner may ask for, in world px.
 *
 * The minimum is measured in Avatars, because a Floor is something people walk around on,
 * and an Avatar is 44px of it. Movement is inset by half an Avatar at every edge
 * (`clampToFloor`), so four across leaves about three Avatars of walkable span — already
 * less an Office than a corridor, and the point where proximity audio has no distance to
 * fade over. Nothing in the schema enforces a Floor this size: a publishable Office needs
 * a Spawn Zone that holds a whole Avatar, which a Floor far smaller than this still could.
 * The number is a judgement about what is worth authoring, which is why it is refused here,
 * at the field, rather than at publish.
 *
 * The maximum is where the editor gives out rather than where the domain does. The whole
 * Floor is fitted on screen at once (`FloorCanvas`), so a Floor this wide is drawn at
 * roughly a sixth of its size on a laptop, which leaves the smallest Zone anyone can author
 * about three screen px to grab. Past that the canvas has stopped being a way to edit an
 * Office, and a Floor that can only be authored by typing is not one to hand out.
 */
export const FLOOR_MIN_PX = AVATAR_SIZE * 4
export const FLOOR_MAX_PX = 5000

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

/**
 * Replace one Zone, leaving the Layout it came from untouched.
 *
 * A change that hands back the Zone it was given hands back the Layout it was given, whole.
 * The editor tells saved work from unsaved by comparing Layouts by reference, so a new
 * object for an edit that edited nothing is an unsaved change that nobody made — and it
 * would guard the tab against being closed over it.
 */
function withZone(layout: Layout, id: string, change: (zone: Zone) => Zone): Layout {
  const zone = layout.zones.find((z) => z.id === id)
  if (!zone) return layout
  const changed = change(zone)
  if (changed === zone) return layout
  return { ...layout, zones: layout.zones.map((z) => (z === zone ? changed : z)) }
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

/**
 * A Zone's rectangle in world px: the shape the numeric inspector reads and writes.
 *
 * A stored `Rect` is normalized against the Floor, which is the right thing to store and
 * the wrong thing to type. An Owner placing a Wall against a Room thinks in pixels, and
 * 0.333333 of a Floor is not a number anybody means.
 */
export interface RectPx {
  x: number
  y: number
  w: number
  h: number
}

/**
 * A rect in whole world px, for showing in a field somebody types into.
 *
 * Whole px because the round trip has to hold still: a rect keeps six decimal places of a
 * fraction, so 300px of a 900px Floor comes back as 299.9997, and an inspector that showed
 * that would renumber the Owner's Zone for having been looked at.
 *
 * Takes the Zone rather than its rect, because `Rect` and `RectPx` are the same four
 * numbers to the compiler: a function that took a rect would happily accept the px rect it
 * exists to produce, and multiply a Floor by a Floor.
 */
export function zoneRectPx(zone: Zone, floor: Size): RectPx {
  return {
    x: Math.round(zone.rect.x * floor.width),
    y: Math.round(zone.rect.y * floor.height),
    w: Math.round(zone.rect.w * floor.width),
    h: Math.round(zone.rect.h * floor.height),
  }
}

/**
 * Whether a field has been typed into a number yet. An untouched field is `undefined`, and
 * an emptied or half-typed one arrives as a NaN or an Infinity — none of which is a size
 * anybody asked for. See `placeZone`.
 */
const isTyped = (px: number | undefined): px is number =>
  px !== undefined && Number.isFinite(px)

/** A typed px value as its share of a Floor span, or null while it is not a number. */
const shareOf = (px: number | undefined, span: number): number | null =>
  isTyped(px) ? px / span : null

/**
 * Put a Zone exactly where it is typed: an origin and a size in world px, any subset of
 * them, straight from the numeric inspector.
 *
 * This is the edit `moveZone` and `resizeZone` make without the pointer, so it is held to
 * the same invariant — on the Floor, no smaller than something you can grab. Where the two
 * numbers cannot both be had, the size wins and the origin gives way: an Owner who types
 * the width of the whole Floor gets a Zone that wide, shifted left to fit, rather than the
 * half of one that would have fitted where it stood. The width is the part they were
 * certain about; where it ended up is the part they can see.
 *
 * A field that is not a number is not an edit. Fields are typed into one character at a
 * time, and an empty one, a lone minus sign or a figure too long to be finite has to leave
 * the Zone alone rather than collapse it to the minimum en route to 250.
 */
export function placeZone(layout: Layout, id: string, patch: Partial<RectPx>): Layout {
  const { width, height } = layout.floor
  const minW = MIN_ZONE_PX / width
  const minH = MIN_ZONE_PX / height

  return withZone(layout, id, (zone) => {
    const w = clamp(shareOf(patch.w, width) ?? zone.rect.w, minW, 1)
    const h = clamp(shareOf(patch.h, height) ?? zone.rect.h, minH, 1)
    const x = clamp(shareOf(patch.x, width) ?? zone.rect.x, 0, 1 - w)
    const y = clamp(shareOf(patch.y, height) ?? zone.rect.y, 0, 1 - h)
    const rect = tidy({ x, y, w, h })
    const same =
      rect.x === zone.rect.x && rect.y === zone.rect.y &&
      rect.w === zone.rect.w && rect.h === zone.rect.h
    return same ? zone : { ...zone, rect }
  })
}

/**
 * Set the Floor's own dimensions, in whole world px, within the range above. This is the
 * one edit here that is about the Office rather than about something on it.
 *
 * Zones come through untouched, which is not the same as unmoved: a rect is normalized
 * against the Floor, so every Zone keeps the share of it it had and the whole Office scales
 * with the change. Anything else would mean re-checking every rect against the new edges
 * and then moving or shrinking the ones that no longer fitted, without having been asked
 * to — and a resize that quietly rearranges an Office is not one an Owner can undo.
 *
 * The cost of that is worth naming: shrink a Floor a long way and everything on it shrinks
 * too, until a Zone is below the size a pointer can grab. Typing is the way back, which is
 * why these two arrived in the same afternoon's work.
 *
 * Whole px because the Office row stores these two numbers as integers beside the document
 * they were taken from, and the database refuses a row where the two disagree.
 */
export function resizeFloor(layout: Layout, size: Partial<Size>): Layout {
  const asked = (px: number | undefined, current: number) =>
    isTyped(px) ? Math.round(clamp(px, FLOOR_MIN_PX, FLOOR_MAX_PX)) : current

  const width = asked(size.width, layout.floor.width)
  const height = asked(size.height, layout.floor.height)
  // A number retyped as the number it already was is not a change to the draft, and must
  // not be reported as one — see `withZone`.
  if (width === layout.floor.width && height === layout.floor.height) return layout
  return { ...layout, floor: { width, height } }
}
