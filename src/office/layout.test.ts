import { describe, expect, it } from "vitest"
import { EXAMPLE_LAYOUT } from "./exampleLayout"
import {
  hitsSolid,
  roomAt,
  roomContextAt,
  seatSlots,
  seatedTableAt,
  spawnPoint,
  type Layout,
  type Zone,
} from "./layout"
import { AVATAR_SIZE } from "./types"

const HALF = AVATAR_SIZE / 2

/** A square 1000x1000 test floor, so a normalized 0.1 is 100px on either axis. */
const TEST_FLOOR = { width: 1000, height: 1000 }

const layoutOf = (...zones: Zone[]): Layout => ({ floor: TEST_FLOOR, zones })

/** A private Room: 200..600 on both axes. */
const room = (id: string): Zone => ({
  id,
  kind: "room",
  private: true,
  rect: { x: 0.2, y: 0.2, w: 0.4, h: 0.4 },
})

/** A non-private Room — enclosed, but no isolation. The top-left 0..100 square. */
const openRoom = (id: string): Zone => ({
  id,
  kind: "room",
  private: false,
  rect: { x: 0, y: 0, w: 0.1, h: 0.1 },
})

/** A free-standing table: 200..600 across, 400..450 down. Chairs land at y 372 and y 478. */
const table = (id: string, seats?: number): Zone => ({
  id,
  kind: "table",
  seats,
  rect: { x: 0.2, y: 0.4, w: 0.4, h: 0.05 },
})

describe("Room-context resolution", () => {
  it("names the private Room a point stands inside", () => {
    expect(roomContextAt(layoutOf(room("C")), { x: 400, y: 400 })).toBe("C")
  })

  it("returns the open Floor for a point outside every Room", () => {
    expect(roomContextAt(layoutOf(room("C")), { x: 700, y: 400 })).toBeNull()
  })

  it("counts a point on a Room's own edge as inside", () => {
    const layout = layoutOf(room("C"))
    expect(roomContextAt(layout, { x: 200, y: 200 })).toBe("C")
    expect(roomContextAt(layout, { x: 600, y: 600 })).toBe("C")
    expect(roomContextAt(layout, { x: 601, y: 400 })).toBeNull()
  })

  it("leaves a non-private Room's occupant on the open Floor", () => {
    const layout = layoutOf(openRoom("T1"))
    expect(roomContextAt(layout, { x: 50, y: 50 })).toBeNull()
    expect(roomAt(layout, { x: 50, y: 50 })).toBe("T1")
  })

  it("treats a Room with no privacy flag as not private", () => {
    const bare: Zone = { id: "R", kind: "room", rect: { x: 0.2, y: 0.2, w: 0.4, h: 0.4 } }
    expect(roomContextAt(layoutOf(bare), { x: 400, y: 400 })).toBeNull()
    expect(roomAt(layoutOf(bare), { x: 400, y: 400 })).toBe("R")
  })

  it("treats private and non-private Rooms alike for enclosure", () => {
    const layout = layoutOf(room("C"), openRoom("T1"))
    expect(roomAt(layout, { x: 400, y: 400 })).toBe("C")
    expect(roomAt(layout, { x: 50, y: 50 })).toBe("T1")
    expect(roomAt(layout, { x: 700, y: 700 })).toBeNull()
  })

  it("resolves the example office's Rooms", () => {
    expect(roomContextAt(EXAMPLE_LAYOUT, { x: 675, y: 800 })).toBe("C")
    expect(roomContextAt(EXAMPLE_LAYOUT, { x: 200, y: 1900 })).toBe("A")
    expect(roomContextAt(EXAMPLE_LAYOUT, { x: 700, y: 1900 })).toBe("B")
    expect(roomContextAt(EXAMPLE_LAYOUT, { x: 400, y: 1200 })).toBeNull()
    // The two former toilets are non-private Rooms: enclosed, but still on the open Floor.
    expect(roomContextAt(EXAMPLE_LAYOUT, { x: 70, y: 70 })).toBeNull()
    expect(roomAt(EXAMPLE_LAYOUT, { x: 70, y: 70 })).toBe("T1")
    expect(roomAt(EXAMPLE_LAYOUT, { x: 100, y: 260 })).toBe("T2")
  })

  it("reads the Layout it is handed, not a floorplan of its own", () => {
    const here = layoutOf({ id: "C", kind: "room", private: true, rect: { x: 0, y: 0, w: 0.5, h: 0.5 } })
    const there = layoutOf({ id: "C", kind: "room", private: true, rect: { x: 0.5, y: 0.5, w: 0.5, h: 0.5 } })
    expect(roomContextAt(here, { x: 100, y: 100 })).toBe("C")
    expect(roomContextAt(there, { x: 100, y: 100 })).toBeNull()
  })
})

describe("Solid-zone collision", () => {
  it("blocks an avatar standing on a table", () => {
    expect(hitsSolid(layoutOf(table("t1")), { x: 400, y: 425 }, HALF)).toBe(true)
  })

  it("blocks an avatar whose radius overlaps a table edge", () => {
    expect(hitsSolid(layoutOf(table("t1")), { x: 400, y: 385 }, HALF)).toBe(true)
  })

  it("lets an avatar past once its radius clears the table", () => {
    expect(hitsSolid(layoutOf(table("t1")), { x: 400, y: 370 }, HALF)).toBe(false)
  })

  it("treats walls as solid", () => {
    const wall: Zone = { id: "w", kind: "wall", rect: { x: 0.2, y: 0.4, w: 0.4, h: 0.05 } }
    expect(hitsSolid(layoutOf(wall), { x: 400, y: 425 }, HALF)).toBe(true)
  })

  it("treats the exterior as solid: it is outside the Office's footprint", () => {
    const exterior: Zone = { id: "x", kind: "exterior", rect: { x: 0.2, y: 0.4, w: 0.4, h: 0.05 } }
    expect(hitsSolid(layoutOf(exterior), { x: 400, y: 425 }, HALF)).toBe(true)
  })

  it("walks through Rooms and the Spawn Zone, which are not solid", () => {
    const spawn: Zone = { id: "s", kind: "spawn", rect: { x: 0.2, y: 0.4, w: 0.4, h: 0.05 } }
    expect(hitsSolid(layoutOf(room("C")), { x: 400, y: 400 }, HALF)).toBe(false)
    expect(hitsSolid(layoutOf(openRoom("T1")), { x: 50, y: 50 }, HALF)).toBe(false)
    expect(hitsSolid(layoutOf(spawn), { x: 400, y: 425 }, HALF)).toBe(false)
  })

  it("blocks the example office's furniture and walls", () => {
    expect(hitsSolid(EXAMPLE_LAYOUT, { x: 135, y: 620 }, HALF)).toBe(true) // table t4
    expect(hitsSolid(EXAMPLE_LAYOUT, { x: 135, y: 568 }, HALF)).toBe(true) // wall beside room C
    expect(hitsSolid(EXAMPLE_LAYOUT, { x: 675, y: 250 }, HALF)).toBe(true) // dining-styled table D
    expect(hitsSolid(EXAMPLE_LAYOUT, { x: 400, y: 1700 }, HALF)).toBe(false) // open floor
    expect(hitsSolid(EXAMPLE_LAYOUT, { x: 675, y: 800 }, HALF)).toBe(false) // inside room C
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

  it("seats a dining-styled table exactly like a plain one", () => {
    const plain = table("t1")
    const dining: Zone = { ...table("t1"), style: "dining" }
    expect(seatSlots(layoutOf(dining), dining, HALF)).toEqual(
      seatSlots(layoutOf(plain), plain, HALF),
    )
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
    const spawn: Zone = { id: "s", kind: "spawn", rect: { x: 0.2, y: 0.4, w: 0.4, h: 0.05 } }
    expect(seatSlots(layoutOf(room("C")), room("C"), HALF)).toEqual([])
    expect(seatSlots(layoutOf(openRoom("T1")), openRoom("T1"), HALF)).toEqual([])
    expect(seatSlots(layoutOf(spawn), spawn, HALF)).toEqual([])
  })

  it("derives the example office's chairs", () => {
    const zone = (id: string) => EXAMPLE_LAYOUT.zones.find((z) => z.id === id)!
    // t4 seats 2, and the wall above it blocks that edge, so both chairs go below.
    expect(seatSlots(EXAMPLE_LAYOUT, zone("t4"), HALF)).toEqual([
      { x: 90, y: 708 },
      { x: 180, y: 708 },
    ])
    expect(seatSlots(EXAMPLE_LAYOUT, zone("t1"), HALF)).toEqual([
      { x: 562.5, y: 1132 },
      { x: 675, y: 1132 },
      { x: 787.5, y: 1132 },
      { x: 562.5, y: 1288 },
      { x: 675, y: 1288 },
      { x: 787.5, y: 1288 },
    ])
    expect(seatSlots(EXAMPLE_LAYOUT, zone("C"), HALF)).toEqual([])
  })

  it("recognises an avatar sitting on a derived chair", () => {
    expect(seatedTableAt(EXAMPLE_LAYOUT, { x: 90, y: 708 }, HALF)).toBe("t4")
    expect(seatedTableAt(EXAMPLE_LAYOUT, { x: 675, y: 1132 }, HALF)).toBe("t1")
    expect(seatedTableAt(EXAMPLE_LAYOUT, { x: 400, y: 1200 }, HALF)).toBeNull()
  })
})

describe("Spawn", () => {
  const spawn: Zone = { id: "s", kind: "spawn", rect: { x: 0.2, y: 0.6, w: 0.4, h: 0.2 } }
  const layout = layoutOf(spawn)
  const ids = ["alice", "bob", "carol", "dave", "erin", "frank", "grace", "heidi"]

  it("puts an arrival inside the Spawn Zone, avatar and all", () => {
    for (const id of ids) {
      const p = spawnPoint(layout, id, HALF)
      expect(p.x).toBeGreaterThanOrEqual(200 + HALF)
      expect(p.x).toBeLessThanOrEqual(600 - HALF)
      expect(p.y).toBeGreaterThanOrEqual(600 + HALF)
      expect(p.y).toBeLessThanOrEqual(800 - HALF)
    }
  })

  it("is deterministic per user id, so every client agrees on where you appeared", () => {
    expect(spawnPoint(layout, "alice", HALF)).toEqual(spawnPoint(layout, "alice", HALF))
  })

  it("scatters arrivals rather than stacking them on one point", () => {
    const seen = new Set(ids.map((id) => JSON.stringify(spawnPoint(layout, id, HALF))))
    expect(seen.size).toBeGreaterThan(1)
  })

  it("falls back to the middle of the Floor when an Office has no Spawn Zone", () => {
    expect(spawnPoint(layoutOf(room("C")), "alice", HALF)).toEqual({ x: 500, y: 500 })
  })

  it("lands on walkable open Floor in the example office", () => {
    for (const id of ids) {
      const p = spawnPoint(EXAMPLE_LAYOUT, id, HALF)
      expect(hitsSolid(EXAMPLE_LAYOUT, p, HALF)).toBe(false)
      expect(roomAt(EXAMPLE_LAYOUT, p)).toBeNull()
    }
  })
})
