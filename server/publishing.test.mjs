import { describe, expect, it, vi } from "vitest"
import { republishedRoute, visitorCountRoute } from "./publishing.mjs"

/** A minimal Layout, recognisable when it comes back out of an announcement. */
const A_LAYOUT = {
  floor: { width: 900, height: 2000 },
  zones: [{ id: "spawn", kind: "spawn", rect: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 } }],
}

/** The two express methods these routes use, recorded rather than sent. */
function fakeRes() {
  const sent = { status: 200, body: undefined }
  const res = {
    status(code) {
      sent.status = code
      return res
    },
    json(body) {
      sent.body = body
      return res
    },
  }
  return { res, sent }
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
  return {
    announced,
    forgotten,
    visitorCount: () => inside,
    forget: (slug) => forgotten.push(slug),
    layoutFor: vi.fn(async () => layout),
    announceLayout: (slug, published) => announced.push([slug, published]),
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
