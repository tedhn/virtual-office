import { describe, expect, it, vi } from "vitest"
import { officeLayouts } from "./officeLayouts.mjs"

/** A minimal Layout: one private Room, so a fetched document is recognisably a Layout. */
const A_LAYOUT = {
  floor: { width: 900, height: 2000 },
  zones: [{ id: "A", kind: "room", private: true, rect: { x: 0, y: 0, w: 0.5, h: 0.5 } }],
}

/** A clock the test moves by hand, so a TTL can be tested without waiting for one. */
function clock(start = 0) {
  let t = start
  return { now: () => t, advance: (ms) => (t += ms) }
}

describe("The Layout the relay enforces privacy against", () => {
  it("fetches the Office's own published Layout", async () => {
    const layouts = officeLayouts({ fetchLayout: async () => A_LAYOUT })
    expect(await layouts.layoutFor("acme-hq")).toEqual(A_LAYOUT)
  })

  it("reports nothing for an address no published Office answers to", async () => {
    const layouts = officeLayouts({ fetchLayout: async () => null })
    expect(await layouts.layoutFor("nowhere")).toBe(null)
  })

  it("asks once per Office and answers the rest from the cache", async () => {
    const fetchLayout = vi.fn(async () => A_LAYOUT)
    const layouts = officeLayouts({ fetchLayout })

    await layouts.layoutFor("acme-hq")
    await layouts.layoutFor("acme-hq")

    expect(fetchLayout).toHaveBeenCalledTimes(1)
  })

  it("keeps two Offices apart", async () => {
    const other = { ...A_LAYOUT, zones: [] }
    const layouts = officeLayouts({
      fetchLayout: async (slug) => (slug === "acme-hq" ? A_LAYOUT : other),
    })

    expect(await layouts.layoutFor("acme-hq")).toEqual(A_LAYOUT)
    expect(await layouts.layoutFor("beta-co")).toEqual(other)
  })

  it("collapses simultaneous arrivals at one Office into a single fetch", async () => {
    // Two people opening the same link at once is the ordinary case, not a rare one.
    let release
    const fetchLayout = vi.fn(() => new Promise((resolve) => (release = resolve)))
    const layouts = officeLayouts({ fetchLayout })

    const both = Promise.all([layouts.layoutFor("acme-hq"), layouts.layoutFor("acme-hq")])
    release(A_LAYOUT)

    expect(await both).toEqual([A_LAYOUT, A_LAYOUT])
    expect(fetchLayout).toHaveBeenCalledTimes(1)
  })

  it("asks again once the entry is old enough to be stale", async () => {
    // Publishing replaces the Layout privacy is enforced against, so a cached copy is
    // only allowed to be believed for so long.
    const time = clock()
    const fetchLayout = vi.fn(async () => A_LAYOUT)
    const layouts = officeLayouts({ fetchLayout, ttlMs: 1000, now: time.now })

    await layouts.layoutFor("acme-hq")
    time.advance(999)
    await layouts.layoutFor("acme-hq")
    expect(fetchLayout).toHaveBeenCalledTimes(1)

    time.advance(1)
    await layouts.layoutFor("acme-hq")
    expect(fetchLayout).toHaveBeenCalledTimes(2)
  })

  it("does not remember a failure as an answer", async () => {
    // Not knowing is not the same answer as no: a database blip must not become a
    // cached "there is no such Office" for the whole TTL.
    let attempt = 0
    const fetchLayout = vi.fn(async () => {
      if (++attempt === 1) throw new Error("database unreachable")
      return A_LAYOUT
    })
    const layouts = officeLayouts({ fetchLayout })

    await expect(layouts.layoutFor("acme-hq")).rejects.toThrow("database unreachable")
    expect(await layouts.layoutFor("acme-hq")).toEqual(A_LAYOUT)
  })

  it("refuses a stored document that is not a Layout", async () => {
    // The column holds JSON written by a client holding a public key, so "the database
    // returned it" is not the same as "it is a Layout" — and rectangles nobody can read
    // are not something to enforce privacy with.
    const complaints = []
    const layouts = officeLayouts({
      fetchLayout: async () => ({ floor: { width: 900 }, zones: "nope" }),
      onInvalid: (slug, errors) => complaints.push([slug, errors]),
    })

    expect(await layouts.layoutFor("acme-hq")).toBe(null)
    expect(complaints[0][0]).toBe("acme-hq")
    expect(complaints[0][1].length).toBeGreaterThan(0)
  })

  it("does not grow without limit as strangers ask for addresses that do not exist", async () => {
    const time = clock()
    const layouts = officeLayouts({ fetchLayout: async () => null, ttlMs: 100, now: time.now })

    for (let i = 0; i < 500; i++) await layouts.layoutFor(`invented-${i}`)
    time.advance(101)
    await layouts.layoutFor("one-more")

    expect(layouts.size()).toBeLessThanOrEqual(256)
  })
})
