import { describe, expect, it, vi } from "vitest"
import { fakeRes } from "./fakeRes.mjs"
import { deletedRoute, republishedRoute, visitorCountRoute } from "./publishing.mjs"

/** A minimal Layout, recognisable when it comes back out of an announcement. */
const A_LAYOUT = {
  floor: { width: 900, height: 2000 },
  zones: [{ id: "spawn", kind: "spawn", rect: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 } }],
}

async function call(handler, slug) {
  const { res, sent } = fakeRes()
  await handler({ params: { slug } }, res)
  return sent
}

/** An office with `inside` people standing in it, and a Layout to publish. */
function harness({ inside = 0, layout = A_LAYOUT } = {}) {
  const announced = []
  const forgotten = []
  const emptied = []
  return {
    announced,
    forgotten,
    emptied,
    visitorCount: () => inside,
    forget: (slug) => forgotten.push(slug),
    layoutFor: vi.fn(async () => layout),
    announceLayout: (slug, published) => announced.push([slug, published]),
    closeOffice: (slug) => {
      emptied.push(slug)
      return inside
    },
  }
}

describe("Asking who is in an Office", () => {
  it("counts the people standing in it", async () => {
    const relay = harness({ inside: 3 })
    expect(await call(visitorCountRoute(relay), "acme-hq")).toEqual({
      status: 200,
      body: { visitors: 3 },
    })
  })

  it("answers zero for an Office nobody is in", async () => {
    expect(await call(visitorCountRoute(harness()), "acme-hq")).toEqual({
      status: 200,
      body: { visitors: 0 },
    })
  })

  it("refuses an address no Office could ever have", async () => {
    const sent = await call(visitorCountRoute(harness({ inside: 3 })), "NOT a slug")
    expect(sent.status).toBe(404)
  })
})

describe("Saying an Office has been republished", () => {
  it("forgets the old Layout and hands the new one to the people inside", async () => {
    const relay = harness({ inside: 2 })
    const sent = await call(republishedRoute(relay), "acme-hq")

    expect(relay.forgotten).toEqual(["acme-hq"])
    expect(relay.announced).toEqual([["acme-hq", A_LAYOUT]])
    expect(sent).toEqual({ status: 200, body: { visitors: 2 } })
  })

  it("forgets the old Layout without reading a new one when nobody is inside", async () => {
    // An empty Office has nobody to tell, and the next person to walk in reads the Layout
    // for themselves — so the database is left alone.
    const relay = harness()
    const sent = await call(republishedRoute(relay), "acme-hq")

    expect(relay.forgotten).toEqual(["acme-hq"])
    expect(relay.layoutFor).not.toHaveBeenCalled()
    expect(relay.announced).toEqual([])
    expect(sent).toEqual({ status: 200, body: { visitors: 0 } })
  })

  it("refuses an address no Office could ever have, without touching the cache", async () => {
    const relay = harness({ inside: 2 })
    const sent = await call(republishedRoute(relay), "NOT a slug")

    expect(sent.status).toBe(404)
    expect(relay.forgotten).toEqual([])
  })

  it("tells nobody about an Office that is no longer published", async () => {
    const relay = harness({ inside: 2, layout: null })
    const sent = await call(republishedRoute(relay), "acme-hq")

    expect(sent.status).toBe(404)
    expect(relay.announced).toEqual([])
  })

  it("says so rather than guessing when the directory cannot be reached", async () => {
    const relay = harness({ inside: 2 })
    relay.layoutFor = async () => {
      throw new Error("database unreachable")
    }
    const sent = await call(republishedRoute(relay), "acme-hq")

    expect(sent.status).toBe(503)
    expect(relay.announced).toEqual([])
    // The cache was still dropped: not knowing the new Layout is a reason to stop
    // believing the old one, not a reason to keep it.
    expect(relay.forgotten).toEqual(["acme-hq"])
  })
})

describe("Saying an Office has been deleted", () => {
  it("turns out the people standing in an Office the database no longer has", async () => {
    const relay = harness({ inside: 2, layout: null })
    const sent = await call(deletedRoute(relay), "acme-hq")

    expect(relay.forgotten).toEqual(["acme-hq"])
    expect(relay.emptied).toEqual(["acme-hq"])
    expect(sent).toEqual({ status: 200, body: { visitors: 2 } })
  })

  it("leaves everyone standing in an Office that is still published", async () => {
    // The whole of what makes this endpoint safe to leave unauthenticated: it acts on the
    // database's word, so a stranger calling it cannot empty an Office that is still there.
    const relay = harness({ inside: 2 })
    const sent = await call(deletedRoute(relay), "acme-hq")

    expect(sent.status).toBe(409)
    expect(relay.emptied).toEqual([])
  })

  it("still stops believing the Layout it had, even when the Office is still there", async () => {
    // A caller says the Office has changed; the cheap half of that is true either way, and
    // the reread is what proves the caller wrong.
    const relay = harness({ inside: 2 })
    await call(deletedRoute(relay), "acme-hq")

    expect(relay.forgotten).toEqual(["acme-hq"])
  })

  it("leaves everyone standing when the directory cannot be reached", async () => {
    const relay = harness({ inside: 2 })
    relay.layoutFor = async () => {
      throw new Error("database unreachable")
    }
    const sent = await call(deletedRoute(relay), "acme-hq")

    expect(sent.status).toBe(503)
    expect(relay.emptied).toEqual([])
    // Not knowing whether the Office is still there is a reason to stop believing the
    // Layout, not a reason to keep it.
    expect(relay.forgotten).toEqual(["acme-hq"])
  })

  it("turns nobody out of an Office nobody is standing in", async () => {
    const relay = harness({ layout: null })
    const sent = await call(deletedRoute(relay), "acme-hq")

    expect(sent).toEqual({ status: 200, body: { visitors: 0 } })
  })

  it("refuses an address no Office could ever have, without touching the cache", async () => {
    const relay = harness({ inside: 2, layout: null })
    const sent = await call(deletedRoute(relay), "NOT a slug")

    expect(sent.status).toBe(404)
    expect(relay.forgotten).toEqual([])
    expect(relay.emptied).toEqual([])
  })
})
