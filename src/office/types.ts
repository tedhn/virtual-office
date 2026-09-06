export interface Position {
  x: number
  y: number
}

export interface Size {
  width: number
  height: number
}

/** The Floor a new Office starts with, in px. An Office's own Floor travels with its
 * Layout — this is only the size one is given to begin with. Every client of the same
 * Office shares that Floor, so world coordinates line up across peers. */
export const FLOOR_WIDTH = 900
export const FLOOR_HEIGHT = 2000
export const FLOOR: Size = { width: FLOOR_WIDTH, height: FLOOR_HEIGHT }

/**
 * The Floor's grid, in world px.
 *
 * One number, read by the two things that have to agree about it: `FloorCanvas` draws the
 * lines, and `resizeZone` lands a dragged edge on them. A grid you can see but not land on
 * is worse than no grid at all, so neither of them carries a 40 of its own.
 *
 * World px rather than screen px, so the lines stay put under the Floor as it is scaled to
 * fit — a grid that changed pitch with the viewport would align Zones differently on a
 * laptop than on a monitor.
 */
export const GRID_PX = 40

/** Avatar visuals. */
export const AVATAR_SIZE = 44 // diameter in px
export const MOVE_SPEED = 320 // px per second

/** Proximity audio falloff radii (world px, measured center-to-center). */
export const INNER_RADIUS = 120 // full volume within this distance
export const OUTER_RADIUS = 300 // silent beyond this distance

/** Distance-based volume 0..1 with a linear falloff between the two radii. */
export function proximityVolume(distance: number): number {
  if (distance <= INNER_RADIUS) return 1
  if (distance >= OUTER_RADIUS) return 0
  return 1 - (distance - INNER_RADIUS) / (OUTER_RADIUS - INNER_RADIUS)
}

export function distance(a: Position, b: Position): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

/** Stable hash of a user id, for deriving per-user values without a random source. */
export function hashId(id: string): number {
  let hash = 0
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0
  return Math.abs(hash)
}

/** Deterministic pleasant color from a user id (HSL hue). */
export function colorForId(id: string): string {
  return `hsl(${hashId(id) % 360} 65% 55%)`
}
