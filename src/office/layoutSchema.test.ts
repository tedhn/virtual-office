import { describe, expect, it } from "vitest"
import { EXAMPLE_LAYOUT } from "./exampleLayout"
import { validateLayout, validatePublishableLayout } from "./layoutSchema"

describe("A Layout's shape", () => {
  it("accepts the hand-authored example Layout", () => {
    expect(validateLayout(EXAMPLE_LAYOUT)).toEqual({ ok: true, layout: EXAMPLE_LAYOUT })
  })

  it("rejects a value that is not an object", () => {
    expect(validateLayout("not a layout")).toEqual({
      ok: false,
      errors: ["layout: expected an object"],
    })
  })
})

describe("Floor dimensions", () => {
  const zones = EXAMPLE_LAYOUT.zones

  it("rejects a floor with no dimensions", () => {
    expect(validateLayout({ zones })).toEqual({
      ok: false,
      errors: ["floor: expected an object"],
    })
  })

  it("rejects floor dimensions that are not positive numbers", () => {
    expect(validateLayout({ floor: { width: 0, height: -1 }, zones })).toEqual({
      ok: false,
      errors: [
        "floor.width: expected a positive number",
        "floor.height: expected a positive number",
      ],
    })
  })

  it("rejects a floor dimension that is not a number at all", () => {
    expect(validateLayout({ floor: { width: "900", height: NaN }, zones })).toEqual({
      ok: false,
      errors: [
        "floor.width: expected a positive number",
        "floor.height: expected a positive number",
      ],
    })
  })
})

const FLOOR = { width: 900, height: 2000 }
const RECT = { x: 0.1, y: 0.1, w: 0.2, h: 0.2 }

describe("Zone identity and kind", () => {
  it("rejects zones that are not an array", () => {
    expect(validateLayout({ floor: FLOOR, zones: {} })).toEqual({
      ok: false,
      errors: ["zones: expected an array"],
    })
  })

  it("rejects a Zone without an id", () => {
    expect(validateLayout({ floor: FLOOR, zones: [{ kind: "wall", rect: RECT }] })).toEqual({
      ok: false,
      errors: ["zones[0].id: expected a non-empty string"],
    })
  })

  it("rejects a Zone whose kind is not one of the five", () => {
    const zones = [{ id: "toilet-1", kind: "toilet", rect: RECT }]
    expect(validateLayout({ floor: FLOOR, zones })).toEqual({
      ok: false,
      errors: ['zones[0].kind: expected one of room, table, wall, spawn, exterior (got "toilet")'],
    })
  })

  it("rejects two Zones sharing an id", () => {
    const zones = [
      { id: "A", kind: "wall", rect: RECT },
      { id: "A", kind: "wall", rect: RECT },
    ]
    expect(validateLayout({ floor: FLOOR, zones })).toEqual({
      ok: false,
      errors: ['zones[1].id: duplicate id "A"'],
    })
  })
})

describe("Zone rects in normalized floor space", () => {
  const zoneWith = (rect: unknown) => ({ floor: FLOOR, zones: [{ id: "z", kind: "wall", rect }] })

  it("rejects a Zone with no rect", () => {
    expect(validateLayout(zoneWith(undefined))).toEqual({
      ok: false,
      errors: ["zones[0].rect: expected an object"],
    })
  })

  it("rejects a rect with no width", () => {
    expect(validateLayout(zoneWith({ x: 0, y: 0, w: 0, h: 0.1 }))).toEqual({
      ok: false,
      errors: ["zones[0].rect.w: expected a positive number"],
    })
  })

  it("rejects a rect that runs off the Floor", () => {
    expect(validateLayout(zoneWith({ x: 0.9, y: 0.5, w: 0.2, h: 0.6 }))).toEqual({
      ok: false,
      errors: [
        "zones[0].rect: runs past the right edge of the floor (x + w must be <= 1)",
        "zones[0].rect: runs past the bottom edge of the floor (y + h must be <= 1)",
      ],
    })
  })

  it("rejects a rect starting outside the Floor", () => {
    expect(validateLayout(zoneWith({ x: -0.1, y: 0, w: 0.2, h: 0.1 }))).toEqual({
      ok: false,
      errors: ["zones[0].rect.x: expected a number between 0 and 1"],
    })
  })

  it("accepts a rect that fills the whole Floor", () => {
    expect(validateLayout(zoneWith({ x: 0, y: 0, w: 1, h: 1 })).ok).toBe(true)
  })
})

describe("Flags that belong to one kind of Zone", () => {
  const layoutOf = (zone: Record<string, unknown>) => ({ floor: FLOOR, zones: [zone] })

  it("rejects privacy on anything but a Room", () => {
    expect(validateLayout(layoutOf({ id: "t", kind: "table", rect: RECT, private: true }))).toEqual({
      ok: false,
      errors: ["zones[0].private: only a room may be private"],
    })
  })

  it("rejects table styling and seats on anything but a Table", () => {
    const zone = { id: "r", kind: "room", rect: RECT, style: "dining", seats: 4 }
    expect(validateLayout(layoutOf(zone))).toEqual({
      ok: false,
      errors: [
        "zones[0].style: only a table may be styled",
        "zones[0].seats: only a table may have seats",
      ],
    })
  })

  it("rejects an unknown table style", () => {
    const zone = { id: "t", kind: "table", rect: RECT, style: "marble" }
    expect(validateLayout(layoutOf(zone))).toEqual({
      ok: false,
      errors: ['zones[0].style: expected one of plain, dining (got "marble")'],
    })
  })

  it("rejects a seat count that is not a positive whole number", () => {
    const zone = { id: "t", kind: "table", rect: RECT, seats: 2.5 }
    expect(validateLayout(layoutOf(zone))).toEqual({
      ok: false,
      errors: ["zones[0].seats: expected a positive whole number"],
    })
  })

  it("rejects a label that is not a string", () => {
    expect(validateLayout(layoutOf({ id: "r", kind: "room", rect: RECT, label: 7 }))).toEqual({
      ok: false,
      errors: ["zones[0].label: expected a string"],
    })
  })
})

describe("Publishing a Layout", () => {
  const spawn = { id: "spawn", kind: "spawn", rect: RECT }
  const wall = { id: "w", kind: "wall", rect: { x: 0.5, y: 0.5, w: 0.1, h: 0.1 } }

  it("accepts the hand-authored example Layout", () => {
    expect(validatePublishableLayout(EXAMPLE_LAYOUT).ok).toBe(true)
  })

  it("rejects an Office nobody can arrive in", () => {
    expect(validatePublishableLayout({ floor: FLOOR, zones: [wall] })).toEqual({
      ok: false,
      errors: ["zones: an Office needs exactly one spawn Zone (found 0)"],
    })
  })

  it("rejects an Office with two Spawn Zones", () => {
    const zones = [spawn, { ...spawn, id: "spawn-2" }]
    expect(validatePublishableLayout({ floor: FLOOR, zones })).toEqual({
      ok: false,
      errors: ["zones: an Office needs exactly one spawn Zone (found 2)"],
    })
  })

  it("reports structural errors without also complaining about the Spawn", () => {
    expect(validatePublishableLayout("nonsense")).toEqual({
      ok: false,
      errors: ["layout: expected an object"],
    })
  })

  it("rejects a Zone that runs off the Floor", () => {
    const zones = [spawn, { id: "w", kind: "wall", rect: { x: 0.9, y: 0.1, w: 0.2, h: 0.1 } }]
    expect(validatePublishableLayout({ floor: FLOOR, zones })).toEqual({
      ok: false,
      errors: ["zones[1].rect: runs past the right edge of the floor (x + w must be <= 1)"],
    })
  })
})

describe("Rooms that overlap", () => {
  const spawn = { id: "spawn", kind: "spawn", rect: { x: 0.0, y: 0.9, w: 0.1, h: 0.1 } }
  const roomAt = (id: string, x: number) => ({
    id,
    kind: "room",
    rect: { x, y: 0.1, w: 0.3, h: 0.3 },
  })

  it("refuses to publish two Rooms sharing floor, naming both", () => {
    const zones = [spawn, roomAt("meeting", 0.1), roomAt("booth", 0.3)]
    expect(validatePublishableLayout({ floor: FLOOR, zones })).toEqual({
      ok: false,
      errors: [
        'zones: rooms "meeting" and "booth" overlap — a point on the Floor must be inside one Room or none, never two',
      ],
    })
  })

  it("allows two Rooms that share a wall but no floor", () => {
    const zones = [spawn, roomAt("meeting", 0.1), roomAt("booth", 0.4)]
    expect(validatePublishableLayout({ floor: FLOOR, zones }).ok).toBe(true)
  })

  it("names every overlapping pair, not just the first", () => {
    const zones = [spawn, roomAt("a", 0.1), roomAt("b", 0.2), roomAt("c", 0.3)]
    const result = validatePublishableLayout({ floor: FLOOR, zones })
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.errors).toHaveLength(3)
  })

  it("does not object to a Room overlapping something that is not a Room", () => {
    const zones = [spawn, roomAt("meeting", 0.1), { id: "w", kind: "wall", rect: { x: 0.2, y: 0.2, w: 0.1, h: 0.1 } }]
    expect(validatePublishableLayout({ floor: FLOOR, zones }).ok).toBe(true)
  })
})

describe("Where Visitors arrive", () => {
  const spawn = { id: "spawn", kind: "spawn", rect: { x: 0.1, y: 0.1, w: 0.3, h: 0.3 } }
  const solid = (id: string, kind: string) => ({
    id,
    kind,
    rect: { x: 0.3, y: 0.3, w: 0.3, h: 0.3 },
  })

  it("refuses a Spawn over a Wall, naming both", () => {
    const zones = [spawn, solid("divider", "wall")]
    expect(validatePublishableLayout({ floor: FLOOR, zones })).toEqual({
      ok: false,
      errors: [
        'zones: the spawn Zone "spawn" overlaps the wall "divider" — Visitors would arrive inside it',
      ],
    })
  })

  it("refuses a Spawn over a Table", () => {
    const zones = [spawn, solid("desk", "table")]
    expect(validatePublishableLayout({ floor: FLOOR, zones })).toEqual({
      ok: false,
      errors: [
        'zones: the spawn Zone "spawn" overlaps the table "desk" — Visitors would arrive inside it',
      ],
    })
  })

  it("refuses a Spawn over the Exterior, which is solid for the same reason", () => {
    const zones = [spawn, solid("outside", "exterior")]
    expect(validatePublishableLayout({ floor: FLOOR, zones })).toEqual({
      ok: false,
      errors: [
        'zones: the spawn Zone "spawn" overlaps the exterior "outside" — Visitors would arrive inside it',
      ],
    })
  })

  it("refuses a Spawn too small for an Avatar to arrive in", () => {
    // 900 x 2000 floor, so 0.01 across is 9px and an Avatar is 44px. Arrivals would stack
    // on its middle and hang over its edges, which is how one lands inside a neighbour.
    const pinhole = { id: "spawn", kind: "spawn", rect: { x: 0.1, y: 0.1, w: 0.01, h: 0.3 } }
    expect(validatePublishableLayout({ floor: FLOOR, zones: [pinhole] })).toEqual({
      ok: false,
      errors: [
        'zones: the spawn Zone "spawn" is 9x600px, too small for anyone to arrive in (44px across at least)',
      ],
    })
  })

  it("allows a Spawn inside a Room, which is walkable", () => {
    const zones = [spawn, { id: "lobby", kind: "room", rect: { x: 0.0, y: 0.0, w: 0.6, h: 0.6 } }]
    expect(validatePublishableLayout({ floor: FLOOR, zones }).ok).toBe(true)
  })
})

describe("Whole-pixel Floor dimensions", () => {
  it("rejects a Floor measured in fractions of a pixel", () => {
    expect(validateLayout({ floor: { width: 900.5, height: 2000 }, zones: [] })).toEqual({
      ok: false,
      errors: ["floor.width: expected a positive number"],
    })
  })
})
