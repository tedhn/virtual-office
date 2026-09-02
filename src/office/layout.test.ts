import { describe, expect, it } from "vitest"
import { DEFAULT_LAYOUT } from "./defaultLayout"
import {
  hitsTable,
  roomAt,
  seatSlots,
  seatedTableAt,
  zoneAt,
  type Layout,
  type Zone,
} from "./layout"
import { AVATAR_SIZE } from "./types"

const HALF = AVATAR_SIZE / 2

/** A square 1000x1000 test floor, so a normalized 0.1 is 100px on either axis. */
const TEST_FLOOR = { width: 1000, height: 1000 }

const layoutOf = (...zones: Zone[]): Layout => ({ floor: TEST_FLOOR, zones })

/** Rooms 200..600 on both axes; the toilet is the top-left 0..100 square. */
const room = (id: string): Zone => ({ id, kind: "room", rect: { x: 0.2, y: 0.2, w: 0.4, h: 0.4 } })
const toilet = (id: string): Zone => ({ id, kind: "toilet", rect: { x: 0, y: 0, w: 0.1, h: 0.1 } })

/** A free-standing table: 200..600 across, 400..450 down. Chairs land at y 372 and y 478. */
const table = (id: string, seats?: number): Zone => ({
  id,
  kind: "table",
  seats,
  rect: { x: 0.2, y: 0.4, w: 0.4, h: 0.05 },
})

describe("Room-context resolution", () => {
  it("names the Room a point stands inside", () => {
    expect(roomAt(layoutOf(room("C")), { x: 400, y: 400 })).toBe("C")
  })

  it("resolves to the open Floor when the point is inside no Room", () => {
    expect(roomAt(layoutOf(room("C")), { x: 700, y: 400 })).toBeNull()
  })

  it("counts a point on a Room's edge as inside it", () => {
    const layout = layoutOf(room("C"))
    expect(roomAt(layout, { x: 200, y: 200 })).toBe("C")
    expect(roomAt(layout, { x: 600, y: 600 })).toBe("C")
    expect(roomAt(layout, { x: 601, y: 400 })).toBeNull()
  })

  it("leaves a toilet on the open Floor: enclosed, but not private", () => {
    const layout = layoutOf(toilet("T1"))
    expect(roomAt(layout, { x: 50, y: 50 })).toBeNull()
    expect(zoneAt(layout, { x: 50, y: 50 })).toBe("T1")
  })

  it("treats rooms and toilets alike for enclosure", () => {
    const layout = layoutOf(room("C"), toilet("T1"))
    expect(zoneAt(layout, { x: 400, y: 400 })).toBe("C")
    expect(zoneAt(layout, { x: 50, y: 50 })).toBe("T1")
    expect(zoneAt(layout, { x: 700, y: 700 })).toBeNull()
  })

  it("resolves the default office's rooms", () => {
    expect(roomAt(DEFAULT_LAYOUT, { x: 675, y: 800 })).toBe("C")
    expect(roomAt(DEFAULT_LAYOUT, { x: 200, y: 1900 })).toBe("A")
    expect(roomAt(DEFAULT_LAYOUT, { x: 700, y: 1900 })).toBe("B")
    expect(roomAt(DEFAULT_LAYOUT, { x: 400, y: 1200 })).toBeNull()
    // Toilets are enclosures without privacy.
    expect(roomAt(DEFAULT_LAYOUT, { x: 70, y: 70 })).toBeNull()
    expect(zoneAt(DEFAULT_LAYOUT, { x: 70, y: 70 })).toBe("T1")
    expect(zoneAt(DEFAULT_LAYOUT, { x: 100, y: 260 })).toBe("T2")
  })

  it("answers for the layout it is given, not a module-level floorplan", () => {
    const here = layoutOf({ ...room("C"), rect: { x: 0, y: 0, w: 0.5, h: 0.5 } })
    const there = layoutOf({ ...room("C"), rect: { x: 0.5, y: 0.5, w: 0.5, h: 0.5 } })
    expect(roomAt(here, { x: 100, y: 100 })).toBe("C")
    expect(roomAt(there, { x: 100, y: 100 })).toBeNull()
  })
})

describe("Solid-zone collision", () => {
  it("blocks an avatar standing on a table", () => {
    expect(hitsTable(layoutOf(table("t1")), { x: 400, y: 425 }, HALF)).toBe(true)
  })

  it("blocks an avatar whose radius overlaps a table edge", () => {
    expect(hitsTable(layoutOf(table("t1")), { x: 400, y: 385 }, HALF)).toBe(true)
  })

  it("lets an avatar past once its radius clears the table", () => {
    expect(hitsTable(layoutOf(table("t1")), { x: 400, y: 370 }, HALF)).toBe(false)
  })

  it("treats walls as solid", () => {
    const wall: Zone = { id: "w", kind: "wall", rect: { x: 0.2, y: 0.4, w: 0.4, h: 0.05 } }
    expect(hitsTable(layoutOf(wall), { x: 400, y: 425 }, HALF)).toBe(true)
  })

  it("walks through rooms, toilets and the exterior, which are not solid", () => {
    const exterior: Zone = { id: "x", kind: "exterior", rect: { x: 0.2, y: 0.4, w: 0.4, h: 0.05 } }
    expect(hitsTable(layoutOf(room("C")), { x: 400, y: 400 }, HALF)).toBe(false)
    expect(hitsTable(layoutOf(toilet("T1")), { x: 50, y: 50 }, HALF)).toBe(false)
    expect(hitsTable(layoutOf(exterior), { x: 400, y: 425 }, HALF)).toBe(false)
  })

  it("blocks the default office's furniture and walls", () => {
    expect(hitsTable(DEFAULT_LAYOUT, { x: 135, y: 620 }, HALF)).toBe(true) // table t4
    expect(hitsTable(DEFAULT_LAYOUT, { x: 135, y: 568 }, HALF)).toBe(true) // wall beside room C
    expect(hitsTable(DEFAULT_LAYOUT, { x: 675, y: 250 }, HALF)).toBe(true) // dining table D
    expect(hitsTable(DEFAULT_LAYOUT, { x: 400, y: 1700 }, HALF)).toBe(false) // open floor
    expect(hitsTable(DEFAULT_LAYOUT, { x: 675, y: 800 }, HALF)).toBe(false) // inside room C
  })
})

describe("Seat derivation", () => {
  it("splits six chairs evenly between a table's open edges", () => {
    expect(seatSlots(layoutOf(table("t1")), table("t1"), HALF)).toEqual([
      { x: 300, y: 372 },
      { x: 400, y: 372 },
      { x: 500, y: 372 },
      { x: 300, y: 478 },
      { x: 400, y: 478 },
      { x: 500, y: 478 },
    ])
  })

  it("honours a table's own seat count", () => {
    const t = table("t1", 2)
    expect(seatSlots(layoutOf(t), t, HALF)).toEqual([
      { x: 400, y: 372 },
      { x: 400, y: 478 },
    ])
  })

  it("puts every chair on the open edge when the other backs onto nothing walkable", () => {
    // Flush against the top of the floor, so a chair above it would sit off-map.
    const t: Zone = { id: "t1", kind: "table", rect: { x: 0.15, y: 0, w: 0.7, h: 0.05 } }
    expect(seatSlots(layoutOf(t), t, HALF)).toEqual([
      { x: 250, y: 78 },
      { x: 350, y: 78 },
      { x: 450, y: 78 },
      { x: 550, y: 78 },
      { x: 650, y: 78 },
      { x: 750, y: 78 },
    ])
  })

  it("derives no chairs for zones that are not tables", () => {
    expect(seatSlots(layoutOf(room("C")), room("C"), HALF)).toEqual([])
    expect(seatSlots(layoutOf(toilet("T1")), toilet("T1"), HALF)).toEqual([])
  })

  it("derives the default office's chairs", () => {
    const zone = (id: string) => DEFAULT_LAYOUT.zones.find((z) => z.id === id)!
    // t4 seats 2, and the wall above it blocks that edge, so both chairs go below.
    expect(seatSlots(DEFAULT_LAYOUT, zone("t4"), HALF)).toEqual([
      { x: 90, y: 708 },
      { x: 180, y: 708 },
    ])
    expect(seatSlots(DEFAULT_LAYOUT, zone("t1"), HALF)).toEqual([
      { x: 562.5, y: 1132 },
      { x: 675, y: 1132 },
      { x: 787.5, y: 1132 },
      { x: 562.5, y: 1288 },
      { x: 675, y: 1288 },
      { x: 787.5, y: 1288 },
    ])
    expect(seatSlots(DEFAULT_LAYOUT, zone("C"), HALF)).toEqual([])
  })

  it("recognises an avatar sitting on a derived chair", () => {
    expect(seatedTableAt(DEFAULT_LAYOUT, { x: 90, y: 708 }, HALF)).toBe("t4")
    expect(seatedTableAt(DEFAULT_LAYOUT, { x: 675, y: 1132 }, HALF)).toBe("t1")
    expect(seatedTableAt(DEFAULT_LAYOUT, { x: 400, y: 1200 }, HALF)).toBeNull()
  })
})
