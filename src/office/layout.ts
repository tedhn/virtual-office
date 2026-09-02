import type { Position, Size } from "./types"

/** A rectangle in normalized floor space (0..1), so the layout scales to any viewport. */
export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export type ZoneKind = "room" | "toilet" | "dining" | "table" | "wall" | "exterior"

/** Zones that are private, click-to-enter spaces (rooms and toilets behave identically). */
export const isRoomLike = (k: ZoneKind) => k === "room" || k === "toilet"

export interface Zone {
  id: string
  kind: ZoneKind
  /** Shown for rooms and the dining table; plain tables are unlabeled. */
  label?: string
  rect: Rect
  /** Max chairs for a table (default 6). */
  seats?: number
}

/**
 * The complete authored description of an office: its floor dimensions plus every zone
 * on it. Zone rects are normalized (0..1) against `floor`, so the two travel together —
 * a rect means nothing without the floor it is measured against.
 *
 * Every function below takes the Layout it operates on. Nothing here reads a floorplan
 * from module scope, so an office's geometry is data, not code: see `defaultLayout.ts`
 * for the one this app currently ships.
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

function zoneMatch(
  layout: Layout,
  pos: Position,
  pred: (k: ZoneKind) => boolean,
): string | null {
  for (const z of layout.zones) {
    if (!pred(z.kind)) continue
    const r = rectToPx(z.rect, layout.floor)
    if (pos.x >= r.left && pos.x <= r.left + r.width && pos.y >= r.top && pos.y <= r.top + r.height) {
      return z.id
    }
  }
  return null
}

/**
 * Private-room id (A/B/C in the default office) containing this point, or null for the
 * open floor. Drives audio/video/chat isolation. Toilets are deliberately excluded: you
 * can enter one, but it doesn't cut you off from the open floor. Use zoneAt for
 * movement/enter logic that treats toilets and rooms the same.
 */
export function roomAt(layout: Layout, pos: Position): string | null {
  return zoneMatch(layout, pos, (k) => k === "room")
}

/**
 * Id of the room-LIKE enclosure (room or toilet) containing this point, or null. Used
 * for wall-crossing collision and click-to-enter, which gate toilets exactly like rooms
 * even though toilets carry no audio/video/chat privacy.
 */
export function zoneAt(layout: Layout, pos: Position): string | null {
  return zoneMatch(layout, pos, isRoomLike)
}

/** True if an avatar of radius `half` centered at `pos` overlaps a solid zone (tables + walls). */
export function hitsTable(layout: Layout, pos: Position, half: number): boolean {
  for (const z of layout.zones) {
    // Only tables, the dining table and walls are solid; rooms use wall-crossing rules
    // and the exterior is a visual-only region (fenced by its walls).
    if (isRoomLike(z.kind) || z.kind === "exterior") continue
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

const DEFAULT_SEATS = 6

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
    !zoneAt(layout, s) &&
    !hitsTable(layout, s, half)
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
 * of the same office agrees.
 */
export function seatSlots(layout: Layout, zone: Zone, half: number): Position[] {
  if (zone.kind !== "table" && zone.kind !== "dining") return []
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
 * Nearest room-like zone (room/toilet) you're standing just OUTSIDE of, within `pad` px of
 * its walls — for the proximity Join prompt. Null if none, or if you're already inside a
 * zone (that case is Leave, driven by zoneAt).
 */
export function roomLikeNear(layout: Layout, pos: Position, pad: number): Zone | null {
  if (zoneAt(layout, pos)) return null
  let best: Zone | null = null
  let bd = Infinity
  for (const z of layout.zones) {
    if (!isRoomLike(z.kind)) continue
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
    // seatSlots returns [] for non-seat zones, so no explicit kind gate is needed here.
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
    if (isRoomLike(z.kind)) continue
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
