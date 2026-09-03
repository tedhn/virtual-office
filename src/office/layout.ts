// Relative imports in this module carry an explicit `.ts` extension: the server loads it
// straight from source with Node's type stripping, and Node ESM does no extension
// resolution. See ADR-0004.
import { hashId, type Position, type Size } from "./types.ts"

/** A rectangle in normalized floor space (0..1), so the layout scales to any viewport. */
export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/**
 * The five kinds of Zone an Owner can place. Behaviour that used to be a kind of its own
 * is a flag now: a toilet is a non-private `room`, a dining table is a styled `table`.
 */
export type ZoneKind = "room" | "table" | "wall" | "spawn" | "exterior"

export interface Zone {
  id: string
  kind: ZoneKind
  /** Shown for rooms and the dining table; plain tables are unlabeled. */
  label?: string
  rect: Rect
  /**
   * Room only: a private Room isolates the audio, video and chat of everyone inside it
   * from the rest of the Floor. A Room without this flag is enclosed but not private —
   * its occupants stay part of the open Floor.
   */
  private?: boolean
  /** Table only: cosmetic variant. Styling changes nothing about a Table's behaviour. */
  style?: "plain" | "dining"
  /** Table only: max chairs (default 6). */
  seats?: number
}

/**
 * The complete authored description of an office: its floor dimensions plus every zone
 * on it. Zone rects are normalized (0..1) against `floor`, so the two travel together —
 * a rect means nothing without the floor it is measured against.
 *
 * Every function below takes the Layout it operates on. Nothing here reads a floorplan
 * from module scope, so an office's geometry is data, not code: a Layout comes from the
 * Office being stood in, and the only one written out in this repo is the fixture in
 * `exampleLayout.ts`.
 */
export interface Layout {
  floor: Size
  zones: Zone[]
}

/** Normalized rect → absolute pixels for the given floor size. */
export function rectToPx(rect: Rect, floor: Size) {
  return {
    left: rect.x * floor.width,
    top: rect.y * floor.height,
    width: rect.w * floor.width,
    height: rect.h * floor.height,
  }
}

/**
 * Whether a Zone is a private Room — the only kind that creates a Room-context, and so
 * the single place privacy is decided from. A Room with no `private` flag is not private.
 */
export const isPrivateRoom = (zone: Zone) => zone.kind === "room" && zone.private === true

function zoneMatch(layout: Layout, pos: Position, pred: (z: Zone) => boolean): string | null {
  for (const z of layout.zones) {
    if (!pred(z)) continue
    const r = rectToPx(z.rect, layout.floor)
    if (pos.x >= r.left && pos.x <= r.left + r.width && pos.y >= r.top && pos.y <= r.top + r.height) {
      return z.id
    }
  }
  return null
}

/**
 * Room-context of a point: the id of the private Room it stands inside, or null for the
 * open Floor. Drives audio/video/chat isolation, on the client and on the server alike.
 * Non-private Rooms are deliberately excluded: you can enter one, but it doesn't cut you
 * off from the open Floor. Use roomAt for movement/enter logic, which treats every Room
 * the same.
 */
export function roomContextAt(layout: Layout, pos: Position): string | null {
  return zoneMatch(layout, pos, isPrivateRoom)
}

/**
 * Id of the Room enclosing this point, private or not, else null. Used for wall-crossing
 * collision and click-to-enter, which gate every Room alike even though a non-private one
 * carries no audio/video/chat privacy.
 */
export function roomAt(layout: Layout, pos: Position): string | null {
  return zoneMatch(layout, pos, (z) => z.kind === "room")
}

/**
 * True if an avatar of radius `half` centered at `pos` overlaps a solid zone. Tables,
 * walls and the exterior are solid; Rooms use wall-crossing rules instead, and the Spawn
 * Zone is ordinary walkable floor.
 */
export function hitsSolid(layout: Layout, pos: Position, half: number): boolean {
  for (const z of layout.zones) {
    if (z.kind === "room" || z.kind === "spawn") continue
    const r = rectToPx(z.rect, layout.floor)
    if (
      pos.x > r.left - half &&
      pos.x < r.left + r.width + half &&
      pos.y > r.top - half &&
      pos.y < r.top + r.height + half
    ) {
      return true
    }
  }
  return false
}

/**
 * Where a Visitor appears when they enter an Office: a point inside the Spawn Zone,
 * inset so the whole avatar fits, scattered by user id so arrivals don't stack on one
 * spot. Deterministic, so every client agrees on where a newcomer showed up. Falls back
 * to the middle of the Floor for an Office with no Spawn Zone.
 */
export function spawnPoint(layout: Layout, userId: string, half: number): Position {
  const zone = layout.zones.find((z) => z.kind === "spawn")
  if (!zone) return { x: layout.floor.width / 2, y: layout.floor.height / 2 }
  const r = rectToPx(zone.rect, layout.floor)
  const insetX = Math.min(half, r.width / 2)
  const insetY = Math.min(half, r.height / 2)
  const h = hashId(userId)
  return {
    x: r.left + insetX + ((h % 1000) / 1000) * (r.width - insetX * 2),
    y: r.top + insetY + (((h >>> 10) % 1000) / 1000) * (r.height - insetY * 2),
  }
}

const EPS = 1e-6

/**
 * Spot to stand when joining a room: `from` clamped into the room interior (inset by
 * the avatar radius), i.e. the nearest point fully inside the room's walls.
 */
export function joinSpot(layout: Layout, zone: Zone, from: Position, half: number): Position {
  const r = rectToPx(zone.rect, layout.floor)
  return {
    x: Math.max(r.left + half, Math.min(r.left + r.width - half, from.x)),
    y: Math.max(r.top + half, Math.min(r.top + r.height - half, from.y)),
  }
}

/**
 * Spot to stand when leaving a room: just outside its nearest *interior* wall (a wall
 * not shared with the floor perimeter, so you land on the open floor, never off-map).
 */
export function exitSpot(layout: Layout, zone: Zone, from: Position, half: number): Position {
  const floor = layout.floor
  const r = rectToPx(zone.rect, floor)
  const gap = half + 6
  const spanX = (x: number) => Math.max(r.left, Math.min(r.left + r.width, x))
  const spanY = (y: number) => Math.max(r.top, Math.min(r.top + r.height, y))
  const cands: Position[] = []
  if (zone.rect.y > EPS) cands.push({ x: spanX(from.x), y: r.top - gap }) // top wall interior
  if (zone.rect.y + zone.rect.h < 1 - EPS) cands.push({ x: spanX(from.x), y: r.top + r.height + gap }) // bottom
  if (zone.rect.x > EPS) cands.push({ x: r.left - gap, y: spanY(from.y) }) // left
  if (zone.rect.x + zone.rect.w < 1 - EPS) cands.push({ x: r.left + r.width + gap, y: spanY(from.y) }) // right
  if (cands.length === 0) return { x: floor.width / 2, y: floor.height / 2 }
  let best = cands[0]
  let bd = Infinity
  for (const c of cands) {
    const d = Math.hypot(c.x - from.x, c.y - from.y)
    if (d < bd) {
      bd = d
      best = c
    }
  }
  return best
}

/**
 * Seat position for a table: the point on the table's perimeter (offset out by the
 * avatar radius) nearest to `from`, so you sit against the side you approached from.
 */
export function seatFor(layout: Layout, zone: Zone, from: Position, half: number): Position {
  const r = rectToPx(zone.rect, layout.floor)
  const gap = half + 6
  const minX = r.left - gap
  const maxX = r.left + r.width + gap
  const minY = r.top - gap
  const maxY = r.top + r.height + gap
  const cx = Math.max(minX, Math.min(maxX, from.x))
  const cy = Math.max(minY, Math.min(maxY, from.y))
  // Snap to whichever edge of the inflated rect is closest, keeping the seat outside the table.
  const dl = cx - minX
  const dr = maxX - cx
  const dt = cy - minY
  const db = maxY - cy
  const m = Math.min(dl, dr, dt, db)
  if (m === dl) return { x: minX, y: cy }
  if (m === dr) return { x: maxX, y: cy }
  if (m === dt) return { x: cx, y: minY }
  return { x: cx, y: maxY }
}

/** Chairs a Table has when its Layout does not say. The editor shows this too. */
export const DEFAULT_SEATS = 6

/** A chair counts as taken if an occupant is within this multiple of the avatar radius. */
const SEAT_TAKEN_RADIUS = 1.5

/** Whether any occupant is sitting on (or claiming) `seat`. Canonical occupancy test. */
export function isSeatTaken(seat: Position, occupied: Position[], half: number): boolean {
  return occupied.some((o) => Math.hypot(o.x - seat.x, o.y - seat.y) < half * SEAT_TAKEN_RADIUS)
}

function seatValid(layout: Layout, s: Position, half: number): boolean {
  return (
    s.x >= half &&
    s.x <= layout.floor.width - half &&
    s.y >= half &&
    s.y <= layout.floor.height - half &&
    !roomAt(layout, s) &&
    !hitsSolid(layout, s, half)
  )
}

/** `count` chairs evenly spaced along a horizontal edge at height `y`. */
function edgeChairs(left: number, width: number, y: number, count: number): Position[] {
  const out: Position[] = []
  for (let i = 0; i < count; i++) out.push({ x: left + ((i + 1) / (count + 1)) * width, y })
  return out
}

/**
 * Chair anchors around a table (offset out by the avatar radius). `zone.seats` chairs
 * (default 6) split evenly between the top and bottom edges; if one edge is blocked
 * (off-floor or backing onto a wall) all chairs go on the open edge. Even rows, aligned
 * columns. Deterministic (pure function of the layout + the table's rect): every client
 * of the same office agrees. A table's styling has no say in this.
 */
export function seatSlots(layout: Layout, zone: Zone, half: number): Position[] {
  if (zone.kind !== "table") return []
  const seats = zone.seats ?? DEFAULT_SEATS
  const r = rectToPx(zone.rect, layout.floor)
  const gap = half + 6
  const topY = r.top - gap
  const botY = r.top + r.height + gap
  // An edge is usable if a chair centered on it would be valid.
  const topOk = seatValid(layout, { x: r.left + r.width / 2, y: topY }, half)
  const botOk = seatValid(layout, { x: r.left + r.width / 2, y: botY }, half)

  let topN = 0
  let botN = 0
  if (topOk && botOk) {
    topN = Math.ceil(seats / 2)
    botN = seats - topN
  } else if (topOk) {
    topN = seats
  } else if (botOk) {
    botN = seats
  }

  return [...edgeChairs(r.left, r.width, topY, topN), ...edgeChairs(r.left, r.width, botY, botN)].filter(
    (s) => seatValid(layout, s, half),
  )
}

/**
 * Nearest FREE chair to `from` (a table seats at most `zone.seats`, default 6). Returns
 * null when every chair is taken, so a full table refuses new sitters.
 */
export function nearestFreeSeat(
  layout: Layout,
  zone: Zone,
  half: number,
  from: Position,
  occupied: Position[],
): Position | null {
  const free = seatSlots(layout, zone, half).filter((s) => !isSeatTaken(s, occupied, half))
  if (free.length === 0) return null
  let best = free[0]
  let bd = Infinity
  for (const s of free) {
    const d = Math.hypot(s.x - from.x, s.y - from.y)
    if (d < bd) {
      bd = d
      best = s
    }
  }
  return best
}

/**
 * Nearest Room you're standing just OUTSIDE of, within `pad` px of its walls — for the
 * proximity Join prompt. Null if none, or if you're already inside a Room (that case is
 * Leave, driven by roomAt).
 */
export function roomNear(layout: Layout, pos: Position, pad: number): Zone | null {
  if (roomAt(layout, pos)) return null
  let best: Zone | null = null
  let bd = Infinity
  for (const z of layout.zones) {
    if (z.kind !== "room") continue
    const r = rectToPx(z.rect, layout.floor)
    if (
      pos.x < r.left - pad ||
      pos.x > r.left + r.width + pad ||
      pos.y < r.top - pad ||
      pos.y > r.top + r.height + pad
    ) {
      continue
    }
    const cx = r.left + r.width / 2
    const cy = r.top + r.height / 2
    const d = Math.hypot(pos.x - cx, pos.y - cy)
    if (d < bd) {
      bd = d
      best = z
    }
  }
  return best
}

/**
 * Nearest FREE chair within `pad` px of `pos`, across all tables — for the proximity Sit
 * prompt. Occupancy uses the same `half*1.5` test as elsewhere. Returns { zone, seat } or null.
 */
export function freeSeatNear(
  layout: Layout,
  pos: Position,
  half: number,
  pad: number,
  occupied: Position[],
): { zone: Zone; seat: Position } | null {
  let best: { zone: Zone; seat: Position } | null = null
  let bd = Infinity
  for (const z of layout.zones) {
    // seatSlots returns [] for non-table zones, so no explicit kind gate is needed here.
    for (const s of seatSlots(layout, z, half)) {
      const d = Math.hypot(pos.x - s.x, pos.y - s.y)
      if (d > pad || d >= bd) continue
      if (isSeatTaken(s, occupied, half)) continue
      bd = d
      best = { zone: z, seat: s }
    }
  }
  return best
}

/** Table id whose chair `pos` is sitting on (within the avatar radius), else null. */
export function seatedTableAt(layout: Layout, pos: Position, half: number): string | null {
  for (const z of layout.zones) {
    if (z.kind !== "table") continue
    for (const s of seatSlots(layout, z, half)) {
      if (Math.hypot(pos.x - s.x, pos.y - s.y) <= half) return z.id
    }
  }
  return null
}

/** A spot just off the table (pushed away from its center) so you leave the chair. */
export function standSpot(layout: Layout, zone: Zone, from: Position, half: number): Position {
  const r = rectToPx(zone.rect, layout.floor)
  const cx = r.left + r.width / 2
  const cy = r.top + r.height / 2
  const dx = from.x - cx
  const dy = from.y - cy
  const len = Math.hypot(dx, dy) || 1
  return { x: from.x + (dx / len) * half * 2.5, y: from.y + (dy / len) * half * 2.5 }
}
