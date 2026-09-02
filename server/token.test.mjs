import { describe, expect, it } from "vitest"
import { tokenRoute } from "./token.mjs"

/** The two express methods the route uses, recorded rather than sent. */
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

function route({ published = ["acme-hq"], mint = () => "a.jwt.token" } = {}) {
  const asked = []
  const handler = tokenRoute({
    apiKey: "stream-key",
    mintToken: mint,
    isOfficePublished: async (slug) => {
      asked.push(slug)
      return published.includes(slug)
    },
  })
  return { handler, asked }
}

async function post(handler, body) {
  const { res, sent } = fakeRes()
  await handler({ body }, res)
  return sent
}

describe("Minting a Stream token", () => {
  it("mints for a Visitor of a published Office", async () => {
    const { handler } = route()
    const sent = await post(handler, { userId: "visitor-1", office: "acme-hq" })
    expect(sent).toEqual({
      status: 200,
      body: { apiKey: "stream-key", token: "a.jwt.token" },
    })
  })

  it("mints for the identity asked for, and no other", async () => {
    const minted = []
    const { handler } = route({
      mint: (userId) => {
        minted.push(userId)
        return "a.jwt.token"
      },
    })
    await post(handler, { userId: "visitor-1", office: "acme-hq" })
    expect(minted).toEqual(["visitor-1"])
  })

  it("refuses an Office that does not exist", async () => {
    const { handler, asked } = route()
    const sent = await post(handler, { userId: "visitor-1", office: "nowhere" })
    expect(sent.status).toBe(404)
    expect(asked).toEqual(["nowhere"])
  })

  it("refuses an Office that is not published, which it cannot see either", async () => {
    // `isOfficePublished` reads the published surface, so a draft-only Office is
    // indistinguishable from one that was never created — and both are refused.
    const { handler } = route({ published: [] })
    const sent = await post(handler, { userId: "visitor-1", office: "acme-hq" })
    expect(sent.status).toBe(404)
  })

  it("refuses to mint without being told which Office", async () => {
    const { handler, asked } = route()
    const sent = await post(handler, { userId: "visitor-1" })
    expect(sent.status).toBe(400)
    expect(sent.body.error).toMatch(/office/)
    expect(asked).toEqual([])
  })

  it("refuses to mint without an identity", async () => {
    const { handler, asked } = route()
    const sent = await post(handler, { office: "acme-hq" })
    expect(sent.status).toBe(400)
    expect(sent.body.error).toMatch(/userId/)
    expect(asked).toEqual([])
  })

  it("refuses a request with no body at all", async () => {
    const { handler } = route()
    const { res, sent } = fakeRes()
    await handler({}, res)
    expect(sent.status).toBe(400)
  })

  it("refuses a slug shaped like something else, without asking the database", async () => {
    const { handler, asked } = route()
    const sent = await post(handler, { userId: "visitor-1", office: "../../etc/passwd" })
    expect(sent.status).toBe(404)
    expect(asked).toEqual([])
  })

  it("does not mint when it cannot tell whether the Office exists", async () => {
    const handler = tokenRoute({
      apiKey: "stream-key",
      mintToken: () => "a.jwt.token",
      isOfficePublished: async () => {
        throw new Error("database unreachable")
      },
    })
    const sent = await post(handler, { userId: "visitor-1", office: "acme-hq" })
    expect(sent.status).toBe(503)
    expect(sent.body.token).toBeUndefined()
  })

  it("reports a minting failure as one, having got that far", async () => {
    const { handler } = route({
      mint: () => {
        throw new Error("bad secret")
      },
    })
    const sent = await post(handler, { userId: "visitor-1", office: "acme-hq" })
    expect(sent.status).toBe(500)
    expect(sent.body.token).toBeUndefined()
  })
})
