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
 * Office layout. Coordinates are normalized (0..1) — multiply by the floor size to
 * get pixels (see rectToPx). Footprint is an L: the main office is the tall block to
 * the right of x≈0.34; the toilet wing (F male, E female) juts out top-left, OUTSIDE
 * the main office; the bottom-left is exterior (empty, non-walkable).
 *
 * Open-plan interior: only rooms (G, C, A, B) and the toilets have walls; the rest is
 * open floor with the dining table D up top and three work tables down the right.
 */
export const LAYOUT: Zone[] = [
  { id: "wall-beside-c-top", kind: "wall", rect: { x: 0.0, y: 0.28, w: 0.3, h: 0.008 } },
  { id: "wall-beside-c-bottom", kind: "wall", rect: { x: 0.0, y: 0.512, w: 0.3, h: 0.008 } },
  { id: "t4", kind: "table", seats: 2, rect: { x: 0.0, y: 0.29, w: 0.3, h: 0.05 } },
  { id: "T1", kind: "toilet", label: "MT", rect: { x: 0.0, y: 0.0, w: 0.155, h: 0.07 } },
  { id: "T2", kind: "toilet", label: "FT", rect: { x: 0.0, y: 0.11, w: 0.263, h: 0.06 } },
  { id: "wall-toilet-right", kind: "wall", rect: { x: 0.267, y: 0.03, w: 0.018, h: 0.142 } },
  { id: "wall-male-right", kind: "wall", rect: { x: 0.160, y: 0.0, w: 0.018, h: 0.07 } },
  { id: "wall-toilet-bottom", kind: "wall", rect: { x: 0.0, y: 0.172, w: 0.286, h: 0.008 } },
  { id: "D", kind: "dining", label: "D", rect: { x: 0.56, y: 0.07, w: 0.3, h: 0.11 } },
  { id: "C", kind: "room", label: "C", rect: { x: 0.5, y: 0.28, w: 0.5, h: 0.24 } },
  { id: "t1", kind: "table", rect: { x: 0.5, y: 0.58, w: 0.5, h: 0.05 } },
  { id: "t2", kind: "table", rect: { x: 0.5, y: 0.68, w: 0.5, h: 0.05 } },
  { id: "t3", kind: "table", rect: { x: 0.5, y: 0.78, w: 0.5, h: 0.05 } },
  { id: "A", kind: "room", label: "A", rect: { x: 0.0, y: 0.88, w: 0.5, h: 0.12 } },
  { id: "B", kind: "room", label: "B", rect: { x: 0.5, y: 0.88, w: 0.5, h: 0.12 } },
]

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
  pos: Position,
  floor: Size,
  pred: (k: ZoneKind) => boolean,
): string | null {
  for (const z of LAYOUT) {
    if (!pred(z.kind)) continue
    const r = rectToPx(z.rect, floor)
    if (pos.x >= r.left && pos.x <= r.left + r.width && pos.y >= r.top && pos.y <= r.top + r.height) {
      return z.id
    }
  }
  return null
}

/**
 * Private-room id (A/B/C) containing this point, or null. Drives audio/video/chat
 * isolation. Toilets are deliberately excluded: you can enter one, but it doesn't cut
 * you off from the open floor. Use zoneAt for movement/enter logic that treats toilets
 * and rooms the same.
 */
export function roomAt(pos: Position, floor: Size): string | null {
  return zoneMatch(pos, floor, (k) => k === "room")
}

/**
 * Id of the room-LIKE enclosure (room or toilet) containing this point, or null. Used
 * for wall-crossing collision and click-to-enter, which gate toilets exactly like rooms
 * even though toilets carry no audio/video/chat privacy.
 */
export function zoneAt(pos: Position, floor: Size): string | null {
  return zoneMatch(pos, floor, isRoomLike)
}

/** True if an avatar of radius `half` centered at `pos` overlaps a solid zone (tables + walls). */
export function hitsTable(pos: Position, floor: Size, half: number): boolean {
  for (const z of LAYOUT) {
    // Only tables, the dining table and walls are solid; rooms use wall-crossing rules
    // and the exterior is a visual-only region (fenced by its walls).
    if (isRoomLike(z.kind) || z.kind === "exterior") continue
    const r = rectToPx(z.rect, floor)
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
export function joinSpot(zone: Zone, floor: Size, from: Position, half: number): Position {
  const r = rectToPx(zone.rect, floor)
  return {
    x: Math.max(r.left + half, Math.min(r.left + r.width - half, from.x)),
    y: Math.max(r.top + half, Math.min(r.top + r.height - half, from.y)),
  }
}

/**
 * Spot to stand when leaving a room: just outside its nearest *interior* wall (a wall
 * not shared with the floor perimeter, so you land on the open floor, never off-map).
 */
export function exitSpot(zone: Zone, floor: Size, from: Position, half: number): Position {
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
export function seatFor(zone: Zone, floor: Size, from: Position, half: number): Position {
  const r = rectToPx(zone.rect, floor)
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

function seatValid(s: Position, floor: Size, half: number): boolean {
  return (
    s.x >= half &&
    s.x <= floor.width - half &&
    s.y >= half &&
    s.y <= floor.height - half &&
    !zoneAt(s, floor) &&
    !hitsTable(s, floor, half)
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
 * columns. Deterministic (pure function of the rect + floor): every client agrees.
 */
export function seatSlots(zone: Zone, floor: Size, half: number): Position[] {
  if (zone.kind !== "table" && zone.kind !== "dining") return []
  const seats = zone.seats ?? DEFAULT_SEATS
  const r = rectToPx(zone.rect, floor)
  const gap = half + 6
  const topY = r.top - gap
  const botY = r.top + r.height + gap
  // An edge is usable if a chair centered on it would be valid.
  const topOk = seatValid({ x: r.left + r.width / 2, y: topY }, floor, half)
  const botOk = seatValid({ x: r.left + r.width / 2, y: botY }, floor, half)

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
    (s) => seatValid(s, floor, half),
  )
}

/**
 * Nearest FREE chair to `from` (a table seats at most SEATS_PER_EDGE*2 = 6). Returns
 * null when every chair is taken, so a full table refuses new sitters.
 */
export function nearestFreeSeat(
  zone: Zone,
  floor: Size,
  half: number,
  from: Position,
  occupied: Position[],
): Position | null {
  const free = seatSlots(zone, floor, half).filter((s) => !isSeatTaken(s, occupied, half))
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
export function roomLikeNear(pos: Position, floor: Size, pad: number): Zone | null {
  if (zoneAt(pos, floor)) return null
  let best: Zone | null = null
  let bd = Infinity
  for (const z of LAYOUT) {
    if (!isRoomLike(z.kind)) continue
    const r = rectToPx(z.rect, floor)
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
  pos: Position,
  floor: Size,
  half: number,
  pad: number,
  occupied: Position[],
): { zone: Zone; seat: Position } | null {
  let best: { zone: Zone; seat: Position } | null = null
  let bd = Infinity
  for (const z of LAYOUT) {
    // seatSlots returns [] for non-seat zones, so no explicit kind gate is needed here.
    for (const s of seatSlots(z, floor, half)) {
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
export function seatedTableAt(pos: Position, floor: Size, half: number): string | null {
  for (const z of LAYOUT) {
    if (isRoomLike(z.kind)) continue
    for (const s of seatSlots(z, floor, half)) {
      if (Math.hypot(pos.x - s.x, pos.y - s.y) <= half) return z.id
    }
  }
  return null
}

/** A spot just off the table (pushed away from its center) so you leave the chair. */
export function standSpot(zone: Zone, floor: Size, from: Position, half: number): Position {
  const r = rectToPx(zone.rect, floor)
  const cx = r.left + r.width / 2
  const cy = r.top + r.height / 2
  const dx = from.x - cx
  const dy = from.y - cy
  const len = Math.hypot(dx, dy) || 1
  return { x: from.x + (dx / len) * half * 2.5, y: from.y + (dy / len) * half * 2.5 }
}
