import { describe, expect, it } from "vitest"
import { validateLayout } from "../layoutSchema"
import type { Layout } from "../layout"
import {
  addZone,
  moveZone,
  newZoneId,
  removeZone,
  resizeZone,
  RESIZE_HANDLES,
  updateZone,
} from "./layoutEdits"

/** A Floor with round numbers, so a minimum size in px converts to a tidy fraction. */
const FLOOR = { width: 1000, height: 1000 }

const layoutOf = (...zones: Layout["zones"]): Layout => ({ floor: FLOOR, zones })

const A_ROOM = {
  id: "room-1",
  kind: "room" as const,
  rect: { x: 0.2, y: 0.2, w: 0.4, h: 0.4 },
}

/** The rect of one Zone, which is what nearly every assertion here is about. */
const rectOf = (layout: Layout, id: string) => layout.zones.find((z) => z.id === id)?.rect

describe("Naming a new Zone", () => {
  it("names it after its kind", () => {
    expect(newZoneId(layoutOf(), "room")).toBe("room-1")
  })

  it("does not hand out an id the Layout already uses", () => {
    // Duplicate ids are a malformed Layout, so this is the one thing the caller must not
    // be able to get wrong.
    const layout = layoutOf(A_ROOM, { ...A_ROOM, id: "room-2" })
    expect(newZoneId(layout, "room")).toBe("room-3")
  })

  it("counts only the ids in the way, not every Zone", () => {
    const layout = layoutOf(A_ROOM, { ...A_ROOM, id: "table-1", kind: "table" })
    expect(newZoneId(layout, "table")).toBe("table-2")
  })
})

describe("Dropping a Zone on the Floor", () => {
  it("puts the first one in the middle, where the Owner is looking", () => {
    const layout = addZone(layoutOf(), "room", "room-1")
    const rect = rectOf(layout, "room-1")!
    expect(rect.x + rect.w / 2).toBeCloseTo(0.5)
    expect(rect.y + rect.h / 2).toBeCloseTo(0.5)
  })

  it("cascades the next ones, so a handful dropped in a row are all reachable", () => {
    // Three Rooms landing on the same spot is one Room-shaped pile with two Rooms hidden
    // under it — each would have to be dragged clear before the next could be grabbed.
    let layout = layoutOf()
    for (const id of ["a", "b", "c"]) layout = addZone(layout, "room", id)
    const corners = layout.zones.map((z) => `${z.rect.x},${z.rect.y}`)
    expect(new Set(corners).size).toBe(3)
  })

  it("gives every kind a starting size somebody can grab", () => {
    for (const kind of ["room", "table", "wall", "spawn", "exterior"] as const) {
      const layout = addZone(layoutOf(), kind, `${kind}-1`)
      const rect = rectOf(layout, `${kind}-1`)!
      expect(rect.w).toBeGreaterThan(0)
      expect(rect.h).toBeGreaterThan(0)
      expect(validateLayout(layout).ok).toBe(true)
    }
  })

  it("leaves the Layout it was given alone", () => {
    // The Owner's work in progress is React state; an edit that mutates in place is an
    // edit the screen never notices.
    const before = layoutOf(A_ROOM)
    const after = addZone(before, "wall", "wall-1")
    expect(before.zones).toHaveLength(1)
    expect(after.zones).toHaveLength(2)
  })

  it("puts the newcomer on top, where a click will find it", () => {
    const layout = addZone(layoutOf(A_ROOM), "table", "table-1")
    expect(layout.zones.at(-1)?.id).toBe("table-1")
  })
})

describe("Moving a Zone", () => {
  it("shifts it by the distance dragged", () => {
    const layout = moveZone(layoutOf(A_ROOM), "room-1", { dx: 0.1, dy: -0.05 })
    expect(rectOf(layout, "room-1")).toEqual({ x: 0.3, y: 0.15, w: 0.4, h: 0.4 })
  })

  it("stops at the edge of the Floor rather than half off it", () => {
    // A Zone that runs past the Floor is a malformed Layout, and a draft still has to be
    // a Layout — so this is the invariant that keeps the save button working.
    const layout = moveZone(layoutOf(A_ROOM), "room-1", { dx: 5, dy: -5 })
    expect(rectOf(layout, "room-1")).toEqual({ x: 0.6, y: 0, w: 0.4, h: 0.4 })
    expect(validateLayout(layout).ok).toBe(true)
  })

  it("ignores a Zone that is not there", () => {
    const before = layoutOf(A_ROOM)
    expect(moveZone(before, "nobody", { dx: 0.1, dy: 0 })).toEqual(before)
  })
})

describe("Resizing a Zone", () => {
  it("moves the corner dragged and leaves the opposite one where it was", () => {
    const layout = resizeZone(layoutOf(A_ROOM), "room-1", "se", { dx: 0.1, dy: 0.1 })
    expect(rectOf(layout, "room-1")).toEqual({ x: 0.2, y: 0.2, w: 0.5, h: 0.5 })
  })

  it("moves the origin when the corner dragged is the top-left one", () => {
    const layout = resizeZone(layoutOf(A_ROOM), "room-1", "nw", { dx: 0.1, dy: 0.1 })
    expect(rectOf(layout, "room-1")).toEqual({ x: 0.3, y: 0.3, w: 0.3, h: 0.3 })
  })

  it("moves one edge for an edge handle and leaves the other axis alone", () => {
    const layout = resizeZone(layoutOf(A_ROOM), "room-1", "e", { dx: 0.1, dy: 0.4 })
    expect(rectOf(layout, "room-1")).toEqual({ x: 0.2, y: 0.2, w: 0.5, h: 0.4 })
  })

  it("refuses to shrink a Zone past the point of being grabbable", () => {
    const layout = resizeZone(layoutOf(A_ROOM), "room-1", "nw", { dx: 1, dy: 1 })
    const rect = rectOf(layout, "room-1")!
    // 16px of a 1000px Floor.
    expect(rect.w).toBeCloseTo(0.016)
    expect(rect.h).toBeCloseTo(0.016)
    expect(validateLayout(layout).ok).toBe(true)
  })

  it("stops growing at the edge of the Floor", () => {
    const layout = resizeZone(layoutOf(A_ROOM), "room-1", "se", { dx: 5, dy: 5 })
    expect(rectOf(layout, "room-1")).toEqual({ x: 0.2, y: 0.2, w: 0.8, h: 0.8 })
    expect(validateLayout(layout).ok).toBe(true)
  })
})

describe("Changing what a Zone is", () => {
  it("names a Room", () => {
    const layout = updateZone(layoutOf(A_ROOM), "room-1", { label: "Focus" })
    expect(layout.zones[0].label).toBe("Focus")
  })

  it("drops a label emptied out, rather than storing a blank one", () => {
    const named = updateZone(layoutOf(A_ROOM), "room-1", { label: "Focus" })
    expect(updateZone(named, "room-1", { label: "  " }).zones[0]).not.toHaveProperty("label")
  })

  it("makes a Room private, which is the only Zone privacy means anything for", () => {
    const layout = updateZone(layoutOf(A_ROOM), "room-1", { private: true })
    expect(layout.zones[0].private).toBe(true)
  })

  it("refuses privacy to a Zone that is not a Room", () => {
    // A private wall is a Layout that has misunderstood the domain, and the schema rejects
    // it — so the editor must not be able to build one at all.
    const wall = { id: "wall-1", kind: "wall" as const, rect: { x: 0, y: 0, w: 0.1, h: 0.1 } }
    const layout = updateZone(layoutOf(wall), "wall-1", { private: true, seats: 4 })
    expect(layout.zones[0]).not.toHaveProperty("private")
    expect(layout.zones[0]).not.toHaveProperty("seats")
    expect(validateLayout(layout).ok).toBe(true)
  })

  it("gives a Table its seats and its styling, and a Room neither", () => {
    const table = { id: "table-1", kind: "table" as const, rect: { x: 0, y: 0, w: 0.2, h: 0.1 } }
    const layout = updateZone(layoutOf(table), "table-1", { seats: 4, style: "dining" })
    expect(layout.zones[0]).toMatchObject({ seats: 4, style: "dining" })

    const room = updateZone(layoutOf(A_ROOM), "room-1", { seats: 4, style: "dining" })
    expect(room.zones[0]).not.toHaveProperty("seats")
    expect(room.zones[0]).not.toHaveProperty("style")
  })
})

describe("Removing a Zone", () => {
  it("takes it off the Floor", () => {
    const layout = removeZone(layoutOf(A_ROOM, { ...A_ROOM, id: "room-2" }), "room-1")
    expect(layout.zones.map((z) => z.id)).toEqual(["room-2"])
  })

  it("leaves an Office with nothing on it, which a draft is allowed to be", () => {
    const layout = removeZone(layoutOf(A_ROOM), "room-1")
    expect(layout.zones).toEqual([])
    expect(validateLayout(layout).ok).toBe(true)
  })
})

describe("The invariant every edit holds", () => {
  /**
   * A repeatable stand-in for a person dragging things around for a while. Seeded rather
   * than random, so a failure here is a failure anyone can reproduce.
   */
  function lcg(seed: number) {
    let state = seed
    return () => {
      state = (state * 1103515245 + 12345) % 2147483648
      return state / 2147483648
    }
  }

  it("survives a long afternoon of dragging still being a Layout", () => {
    // This is what lets the editor save whatever state it is in: a draft may be a useless
    // Office, but it is never a malformed document.
    const next = lcg(20260903)
    const kinds = ["room", "table", "wall", "spawn", "exterior"] as const
    let layout = layoutOf()

    for (let step = 0; step < 500; step++) {
      const ids = layout.zones.map((z) => z.id)
      const id = ids[Math.floor(next() * ids.length)]
      // A drag that overshoots the Floor by miles is the ordinary case here, not the
      // exotic one: people fling things at the edge and let go.
      const delta = { dx: (next() - 0.5) * 3, dy: (next() - 0.5) * 3 }
      const roll = next()

      if (roll < 0.25 || ids.length === 0) {
        const kind = kinds[Math.floor(next() * kinds.length)]
        layout = addZone(layout, kind, newZoneId(layout, kind))
      } else if (roll < 0.55) {
        layout = moveZone(layout, id, delta)
      } else if (roll < 0.9) {
        layout = resizeZone(layout, id, RESIZE_HANDLES[Math.floor(next() * 8)], delta)
      } else {
        layout = removeZone(layout, id)
      }

      const checked = validateLayout(layout)
      if (!checked.ok) throw new Error(`step ${step}: ${checked.errors.join("; ")}`)
    }

    expect(layout.zones.length).toBeGreaterThan(0)
  })
})
