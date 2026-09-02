import { describe, expect, it } from "vitest"
import { randomTail } from "./randomTail"

describe("A random tail", () => {
  it("is short, slug-safe, and different each time", () => {
    const tails = new Set(Array.from({ length: 200 }, randomTail))
    for (const tail of tails) expect(tail).toMatch(/^[a-z0-9]{4}$/)
    // 36^4 possibilities: 200 draws colliding into fewer than 150 distinct values would
    // mean the tail is not random enough to separate two Offices with the same name.
    expect(tails.size).toBeGreaterThan(150)
  })
})
