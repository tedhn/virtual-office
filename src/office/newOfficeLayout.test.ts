import { describe, expect, it } from "vitest"
import { hitsSolid, roomAt, roomContextAt, spawnPoint, rectToPx } from "./layout"
import { validatePublishableLayout } from "./layoutSchema"
import { newOfficeLayout } from "./newOfficeLayout"
import { AVATAR_SIZE } from "./types"

const HALF = AVATAR_SIZE / 2

describe("The Layout a new Office starts with", () => {
  it("is an empty Floor with exactly one Spawn Zone and nothing else", () => {
    const layout = newOfficeLayout()
    expect(layout.zones.map((z) => z.kind)).toEqual(["spawn"])
  })

  it("is publishable, so a brand new Office is one a Visitor can arrive in", () => {
    expect(validatePublishableLayout(newOfficeLayout()).ok).toBe(true)
  })

  it("has a Floor with whole, positive dimensions", () => {
    const { floor } = newOfficeLayout()
    expect(Number.isInteger(floor.width) && floor.width > 0).toBe(true)
    expect(Number.isInteger(floor.height) && floor.height > 0).toBe(true)
  })

  it("puts arrivals inside its Spawn Zone, whoever they are", () => {
    const layout = newOfficeLayout()
    const spawn = rectToPx(layout.zones[0].rect, layout.floor)
    for (const userId of ["ted", "someone-else", "a", crypto.randomUUID()]) {
      const at = spawnPoint(layout, userId, HALF)
      expect(at.x).toBeGreaterThanOrEqual(spawn.left)
      expect(at.x).toBeLessThanOrEqual(spawn.left + spawn.width)
      expect(at.y).toBeGreaterThanOrEqual(spawn.top)
      expect(at.y).toBeLessThanOrEqual(spawn.top + spawn.height)
    }
  })

  it("is empty in the sense that matters: nothing to walk into, nowhere private", () => {
    const layout = newOfficeLayout()
    const at = spawnPoint(layout, "ted", HALF)
    expect(hitsSolid(layout, at, HALF)).toBe(false)
    expect(roomAt(layout, at)).toBe(null)
    expect(roomContextAt(layout, at)).toBe(null)
  })

  it("hands out a Layout of its own each time, since an Owner goes on to edit it", () => {
    const first = newOfficeLayout()
    const second = newOfficeLayout()
    expect(first).toEqual(second)
    expect(first.zones).not.toBe(second.zones)
    first.zones.push({ id: "scratch", kind: "wall", rect: { x: 0, y: 0, w: 0.1, h: 0.1 } })
    expect(second.zones).toHaveLength(1)
  })
})
