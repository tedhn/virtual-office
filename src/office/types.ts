export interface Position {
  x: number
  y: number
}

export interface Size {
  width: number
  height: number
}

/** Fixed office floor size in px (portrait — same for every client, so world
 * coordinates line up across peers). Shape matches the layout sketch. */
export const FLOOR_WIDTH = 900
export const FLOOR_HEIGHT = 2000
export const FLOOR: Size = { width: FLOOR_WIDTH, height: FLOOR_HEIGHT }

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
