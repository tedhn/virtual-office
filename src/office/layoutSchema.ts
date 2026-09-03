// Relative imports carry an explicit `.ts` extension, and nothing here is a third-party
// or DOM import: this module lives under ADR-0004's rules, because `server/officeLayouts.mjs`
// loads it from source the way the relay loads the geometry. One answer to "is this a
// Layout?" for the browser that writes one and the server that enforces privacy with it.
import { isSolidZone, rectsOverlap, type Layout, type ZoneKind } from "./layout.ts"
import { AVATAR_SIZE } from "./types.ts"

/**
 * The outcome of checking an untrusted value against the Layout shape. Errors are
 * collected rather than thrown on the first one, so an Owner sees everything wrong with
 * a Layout at once.
 */
export type LayoutValidation =
  | { ok: true; layout: Layout }
  | { ok: false; errors: string[] }

/**
 * Structural check of an untrusted value against the Layout shape: floor dimensions and
 * every Zone's kind, rect and flags. This is what any write of a Layout must pass —
 * draft or published alike — so nothing that isn't a Layout reaches the database.
 *
 * Validity beyond shape (a Layout being a sensible Office rather than merely a
 * well-formed one) is `validatePublishableLayout`'s job: a draft is free to be nonsense,
 * a published Layout is not.
 */
export function validateLayout(value: unknown): LayoutValidation {
  const errors: string[] = []
  if (!isRecord(value)) return { ok: false, errors: ["layout: expected an object"] }

  const floor = value.floor
  if (!isRecord(floor)) {
    errors.push("floor: expected an object")
  } else {
    // Whole pixels: the Floor is a coordinate space, and the Office row stores these
    // dimensions as integers alongside the document they came from.
    if (!isWholeAndPositive(floor.width)) errors.push("floor.width: expected a positive number")
    if (!isWholeAndPositive(floor.height)) errors.push("floor.height: expected a positive number")
  }

  const zones = value.zones
  if (!Array.isArray(zones)) {
    errors.push("zones: expected an array")
  } else {
    const seen = new Set<string>()
    zones.forEach((zone, i) => validateZone(zone, i, seen, errors))
  }

  return errors.length === 0
    ? { ok: true, layout: value as unknown as Layout }
    : { ok: false, errors }
}

/**
 * The five kinds, as a lookup rather than a list, so adding a kind to `ZoneKind` without
 * teaching this module about it is a compile error rather than a validator that rejects
 * the new kind at runtime.
 */
const ZONE_KINDS: Record<ZoneKind, true> = {
  room: true,
  table: true,
  wall: true,
  spawn: true,
  exterior: true,
}

const KIND_NAMES = Object.keys(ZONE_KINDS)

const isZoneKind = (value: unknown): value is ZoneKind =>
  typeof value === "string" && Object.hasOwn(ZONE_KINDS, value)

function validateZone(zone: unknown, i: number, seen: Set<string>, errors: string[]): void {
  const at = `zones[${i}]`
  if (!isRecord(zone)) {
    errors.push(`${at}: expected an object`)
    return
  }

  const id = zone.id
  if (typeof id !== "string" || id.length === 0) {
    errors.push(`${at}.id: expected a non-empty string`)
  } else if (seen.has(id)) {
    errors.push(`${at}.id: duplicate id "${id}"`)
  } else {
    seen.add(id)
  }

  const kind = zone.kind
  if (!isZoneKind(kind)) {
    errors.push(`${at}.kind: expected one of ${KIND_NAMES.join(", ")} (got ${JSON.stringify(kind)})`)
  }

  validateRect(zone.rect, `${at}.rect`, errors)
  validateFlags(zone, kind, at, errors)
}

/**
 * A Zone's rectangle, in normalized floor space: an origin inside the Floor and a
 * positive size that stays on it. A rect that leaves the Floor describes a Zone nobody
 * can reach, so it is a malformed Layout rather than an unusual one.
 */
function validateRect(rect: unknown, at: string, errors: string[]): void {
  if (!isRecord(rect)) {
    errors.push(`${at}: expected an object`)
    return
  }
  const bounded = (key: string) => {
    const n = rect[key]
    if (typeof n !== "number" || !Number.isFinite(n) || n < 0 || n > 1) {
      errors.push(`${at}.${key}: expected a number between 0 and 1`)
      return null
    }
    return n
  }
  const positive = (key: string) => {
    const n = rect[key]
    if (!isPositive(n) || n > 1) {
      errors.push(`${at}.${key}: expected a positive number`)
      return null
    }
    return n
  }
  const x = bounded("x")
  const y = bounded("y")
  const w = positive("w")
  const h = positive("h")
  if (x !== null && w !== null && x + w > 1) {
    errors.push(`${at}: runs past the right edge of the floor (x + w must be <= 1)`)
  }
  if (y !== null && h !== null && y + h > 1) {
    errors.push(`${at}: runs past the bottom edge of the floor (y + h must be <= 1)`)
  }
}

/**
 * The optional fields, each of which belongs to one kind: privacy is a Room's, styling
 * and seat count are a Table's. A private wall or a styled Room is a Layout that has
 * misunderstood the domain, so it is rejected rather than quietly ignored.
 */
function validateFlags(zone: Record<string, unknown>, kind: unknown, at: string, errors: string[]): void {
  if (zone.label !== undefined && typeof zone.label !== "string") {
    errors.push(`${at}.label: expected a string`)
  }

  if (zone.private !== undefined) {
    if (kind !== "room") errors.push(`${at}.private: only a room may be private`)
    else if (typeof zone.private !== "boolean") errors.push(`${at}.private: expected a boolean`)
  }

  if (zone.style !== undefined) {
    if (kind !== "table") errors.push(`${at}.style: only a table may be styled`)
    else if (zone.style !== "plain" && zone.style !== "dining") {
      errors.push(`${at}.style: expected one of plain, dining (got ${JSON.stringify(zone.style)})`)
    }
  }

  if (zone.seats !== undefined) {
    if (kind !== "table") errors.push(`${at}.seats: only a table may have seats`)
    else if (!isPositive(zone.seats) || !Number.isInteger(zone.seats)) {
      errors.push(`${at}.seats: expected a positive whole number`)
    }
  }
}

function isPositive(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
}

function isWholeAndPositive(value: unknown): value is number {
  return isPositive(value) && Number.isInteger(value)
}

/**
 * The check Publishing applies: a Layout that is structurally sound *and* describes an
 * Office that works. A draft is free to be nonsense; this is the moment that stops being
 * true (see CONTEXT.md, Layout).
 *
 * Four things beyond shape have to hold, and each is here because of something that breaks
 * at runtime rather than because of tidiness: exactly one Spawn Zone, big enough to hold an
 * Avatar, with nothing solid under it, and no two Rooms over the same Floor. Every
 * rejection names the Zones involved by id, because "this Layout is invalid" is not
 * something an Owner can act on.
 */
export function validatePublishableLayout(value: unknown): LayoutValidation {
  const structural = validateLayout(value)
  if (!structural.ok) return structural

  const { zones } = structural.layout
  const errors: string[] = []

  // A Zone that runs off the Floor is already refused above, as malformed rather than as
  // unpublishable — so out-of-bounds is caught before this line, for drafts and published
  // Layouts alike.

  const spawns = zones.filter((z) => z.kind === "spawn")
  if (spawns.length !== 1) {
    errors.push(`zones: an Office needs exactly one spawn Zone (found ${spawns.length})`)
  }

  // Room-context resolution must have exactly one answer for any point on the Floor. Two
  // Rooms over the same ground give an answer that depends on which one the geometry
  // happened to look at first, which is order-dependent privacy (CONTEXT.md, Room-context).
  const rooms = zones.filter((z) => z.kind === "room")
  for (let i = 0; i < rooms.length; i++) {
    for (let j = i + 1; j < rooms.length; j++) {
      if (rectsOverlap(rooms[i].rect, rooms[j].rect)) {
        errors.push(
          `zones: rooms "${rooms[i].id}" and "${rooms[j].id}" overlap — a point on the Floor must be inside one Room or none, never two`,
        )
      }
    }
  }

  const { floor } = structural.layout
  for (const spawn of spawns) {
    // Arrivals are inset by an Avatar's radius so the whole Avatar lands inside the Zone
    // — which a Zone narrower than an Avatar cannot do. Then every arrival stacks on its
    // middle instead of scattering (CONTEXT.md, Spawn) and hangs over its edges, which is
    // how somebody materialises inside the Wall next door without this Zone touching it.
    const width = Math.round(spawn.rect.w * floor.width)
    const height = Math.round(spawn.rect.h * floor.height)
    if (width < AVATAR_SIZE || height < AVATAR_SIZE) {
      errors.push(
        `zones: the spawn Zone "${spawn.id}" is ${width}x${height}px, too small for anyone to arrive in (${AVATAR_SIZE}px across at least)`,
      )
    }

    // And with the whole Avatar landing inside the Zone, a Spawn clear of everything solid
    // is an Office nobody can arrive inside a Wall in. The Exterior counts for the same
    // reason a Wall does, even though it is only meant to be looked at.
    for (const zone of zones) {
      if (!isSolidZone(zone)) continue
      if (rectsOverlap(spawn.rect, zone.rect)) {
        errors.push(
          `zones: the spawn Zone "${spawn.id}" overlaps the ${zone.kind} "${zone.id}" — Visitors would arrive inside it`,
        )
      }
    }
  }

  return errors.length === 0 ? structural : { ok: false, errors }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
