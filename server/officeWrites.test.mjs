import { describe, expect, it } from "vitest"
import { fakeRes } from "./fakeRes.mjs"
import { officeWriteRoutes, supabaseSecret } from "./officeWrites.mjs"
import { OfficeWriteError } from "../src/lib/offices.ts"
import { EXAMPLE_LAYOUT } from "../src/office/exampleLayout.ts"
import { newOfficeLayout } from "../src/office/newOfficeLayout.ts"

/**
 * The write endpoints, with the database and the auth server replaced by fakes.
 *
 * What is being proven here is the gate rather than the write: who is allowed to change an
 * Office, and what a Layout has to be before it is stored. The write itself is
 * `src/lib/offices.ts`, already tested against a fake row store, and the grant that makes
 * this server the only way in is proven against a real database in
 * `officeWrites.database.test.mjs`.
 */

/** A Layout that is well shaped but describes nothing: exactly what the client cannot be trusted to refuse. */
const NONSENSE_ZONES = {
  floor: { width: 2000, height: 1200 },
  zones: [{ id: "wat", kind: "teleporter", rect: { x: 5, y: -1, w: 0, h: 99 } }],
}

/** A Layout nobody could arrive in. Fine as a draft, refused as a publish. */
const NO_SPAWN = { floor: newOfficeLayout().floor, zones: [] }

const OWNER = "owner-1"
const STRANGER = "stranger-1"

/**
 * A server wired to fakes: an auth server that recognises three tokens, a directory with
 * one Office in it, and a row store that records what it was asked to write.
 */
function routes({ offices = [{ id: "office-1", slug: "acme-hq", owner_id: OWNER }] } = {}) {
  const inserted = []
  const updated = []
  let unreachable = null

  const callerOf = async (token) => {
    if (unreachable === "auth") throw new Error("auth server down")
    if (token === "owner.jwt") return { id: OWNER, anonymous: false }
    if (token === "stranger.jwt") return { id: STRANGER, anonymous: false }
    if (token === "visitor.jwt") return { id: "visitor-1", anonymous: true }
    return null
  }

  const officeAt = async (slug) => {
    if (unreachable === "directory") throw new Error("directory down")
    return offices.find((o) => o.slug === slug) ?? null
  }

  let rowFailure = null

  const rows = {
    insert: async (fields) => {
      if (rowFailure) throw rowFailure
      inserted.push(fields)
      return { id: "office-new", layout_version: fields.published_layout ? 1 : 0, ...fields }
    },
    update: async (id, patch) => {
      if (rowFailure) throw rowFailure
      updated.push({ id, patch })
      const office = offices.find((o) => o.id === id)
      return { id, slug: office?.slug, owner_id: office?.owner_id, ...patch }
    },
  }

  const handlers = officeWriteRoutes({
    callerOf,
    officeAt,
    rows,
    now: () => "2026-09-03T12:00:00.000Z",
  })

  return {
    ...handlers,
    inserted,
    updated,
    breaks: (what) => {
      unreachable = what
    },
    rowsThrow: (error) => {
      rowFailure = error
    },
  }
}

/** Call a handler the way Express would, and hand back what it answered. */
async function call(handler, { token = "owner.jwt", slug, body } = {}) {
  const { res, sent } = fakeRes()
  await handler(
    {
      headers: token === null ? {} : { authorization: `Bearer ${token}` },
      params: slug === undefined ? {} : { slug },
      body,
    },
    res,
  )
  return sent
}

describe("Creating an Office through the server", () => {
  it("creates it for the account the token names", async () => {
    const server = routes()
    const sent = await call(server.create, { body: { name: "Acme HQ" } })

    expect(sent.status).toBe(200)
    expect(sent.body.office).toMatchObject({ owner_id: OWNER, name: "Acme HQ", slug: "acme-hq" })
    expect(server.inserted).toHaveLength(1)
    expect(server.inserted[0].published_layout).toEqual(newOfficeLayout())
  })

  it("owns it to the token's account, not to whatever the body claims", async () => {
    const server = routes()
    await call(server.create, { body: { name: "Acme HQ", ownerId: STRANGER, owner_id: STRANGER } })

    expect(server.inserted[0].owner_id).toBe(OWNER)
  })

  it("refuses an anonymous Visitor, who has no account to own an Office with", async () => {
    const server = routes()
    const sent = await call(server.create, { token: "visitor.jwt", body: { name: "Transient" } })

    expect(sent.status).toBe(403)
    expect(server.inserted).toEqual([])
  })

  it("refuses a caller who has not signed in at all", async () => {
    const server = routes()
    expect((await call(server.create, { token: null, body: { name: "Acme" } })).status).toBe(401)
    expect(server.inserted).toEqual([])
  })

  it("refuses a token the auth server does not recognise", async () => {
    const server = routes()
    expect((await call(server.create, { token: "forged", body: { name: "Acme" } })).status).toBe(401)
    expect(server.inserted).toEqual([])
  })

  it("says it could not ask rather than no, when the auth server cannot be reached", async () => {
    const server = routes()
    server.breaks("auth")
    expect((await call(server.create, { body: { name: "Acme" } })).status).toBe(503)
  })

  it("answers a nameless Office with the reason, not with a row", async () => {
    const server = routes()
    const sent = await call(server.create, { body: { name: "   " } })

    expect(sent.status).toBe(400)
    expect(sent.body.error).toContain("name")
    expect(server.inserted).toEqual([])
  })
})

describe("Saving a draft through the server", () => {
  it("stores a draft that is not a publishable Office, because a draft may not be one", async () => {
    const server = routes()
    const sent = await call(server.saveDraft, { slug: "acme-hq", body: { layout: NO_SPAWN } })

    expect(sent.status).toBe(200)
    expect(server.updated).toEqual([{ id: "office-1", patch: { draft_layout: NO_SPAWN } }])
  })

  it("refuses a Layout full of nonsense Zones, which is the whole point of being here", async () => {
    const server = routes()
    const sent = await call(server.saveDraft, {
      slug: "acme-hq",
      body: { layout: NONSENSE_ZONES },
    })

    expect(sent.status).toBe(400)
    expect(sent.body.error).toContain("zones[0].kind")
    expect(server.updated).toEqual([])
  })

  it("leaves the floor columns alone, so a draft may propose a Floor of its own", async () => {
    const server = routes()
    const wider = {
      ...EXAMPLE_LAYOUT,
      floor: { width: EXAMPLE_LAYOUT.floor.width + 400, height: EXAMPLE_LAYOUT.floor.height },
    }
    await call(server.saveDraft, { slug: "acme-hq", body: { layout: wider } })

    expect(Object.keys(server.updated[0].patch)).toEqual(["draft_layout"])
  })

  it("tells a stranger what it tells anyone asking after an Office that is not there", async () => {
    const server = routes()
    const mine = await call(server.saveDraft, {
      token: "stranger.jwt",
      slug: "acme-hq",
      body: { layout: EXAMPLE_LAYOUT },
    })
    const nobodys = await call(server.saveDraft, {
      slug: "not-an-office",
      body: { layout: EXAMPLE_LAYOUT },
    })

    expect(mine).toEqual(nobodys)
    expect(mine.status).toBe(404)
    expect(server.updated).toEqual([])
  })

  it("answers an address no Office could ever have without asking the database", async () => {
    const server = routes()
    server.breaks("directory")
    expect((await call(server.saveDraft, { slug: "NOPE!", body: { layout: EXAMPLE_LAYOUT } })).status).toBe(404)
  })

  it("says it could not ask rather than no, when the directory cannot be reached", async () => {
    const server = routes()
    server.breaks("directory")
    const sent = await call(server.saveDraft, { slug: "acme-hq", body: { layout: EXAMPLE_LAYOUT } })

    expect(sent.status).toBe(503)
  })

  it("refuses a body with no Layout in it, and every falsy thing sent in its place", async () => {
    // A route that returns having sent nothing leaves Express holding the socket open, so
    // "absent" and "0" and "false" all have to come back as an answer — the first as a
    // missing Layout, the rest as a Layout that is not one.
    const server = routes()
    for (const body of [{}, { layout: 0 }, { layout: false }, { layout: "" }, { layout: null }]) {
      const sent = await call(server.saveDraft, { slug: "acme-hq", body })
      expect(sent.status, JSON.stringify(body)).toBe(400)
      expect(sent.body.error, JSON.stringify(body)).toBeTruthy()
    }
    expect(server.updated).toEqual([])
  })
})

describe("Publishing through the server", () => {
  it("writes the published Layout, the draft and the floor columns together", async () => {
    const server = routes()
    const sent = await call(server.publish, { slug: "acme-hq", body: { layout: EXAMPLE_LAYOUT } })

    expect(sent.status).toBe(200)
    expect(server.updated).toEqual([
      {
        id: "office-1",
        patch: {
          published_layout: EXAMPLE_LAYOUT,
          draft_layout: EXAMPLE_LAYOUT,
          floor_width: EXAMPLE_LAYOUT.floor.width,
          floor_height: EXAMPLE_LAYOUT.floor.height,
        },
      },
    ])
  })

  it("holds a publish to describing an Office that works, unlike a draft", async () => {
    const server = routes()
    const sent = await call(server.publish, { slug: "acme-hq", body: { layout: NO_SPAWN } })

    expect(sent.status).toBe(400)
    expect(sent.body.error).toMatch(/spawn/)
    expect(server.updated).toEqual([])
  })

  it("refuses to publish over an Office the caller does not own", async () => {
    const server = routes()
    const sent = await call(server.publish, {
      token: "stranger.jwt",
      slug: "acme-hq",
      body: { layout: EXAMPLE_LAYOUT },
    })

    expect(sent.status).toBe(404)
    expect(server.updated).toEqual([])
  })
})

describe("When the write itself goes wrong", () => {
  it("does not quote a database refusal back as though the Layout were at fault", async () => {
    // 400 means "fix your Layout and try again", and its message is put on the Owner's
    // screen. A refusal from the database is neither of those things.
    const server = routes()
    server.rowsThrow(new OfficeWriteError("permission denied for table offices", "42501"))
    const sent = await call(server.saveDraft, { slug: "acme-hq", body: { layout: EXAMPLE_LAYOUT } })

    expect(sent.status).toBe(500)
    expect(sent.body.error).not.toContain("permission denied")
  })

  it("answers a bug in this process as ours, not as the caller's", async () => {
    const server = routes()
    server.rowsThrow(new TypeError("cannot read properties of undefined"))
    const sent = await call(server.publish, { slug: "acme-hq", body: { layout: EXAMPLE_LAYOUT } })

    expect(sent.status).toBe(500)
    expect(sent.body.error).not.toContain("undefined")
  })
})

describe("Renaming and deleting through the server", () => {
  it("renames an Office, trimmed", async () => {
    const server = routes()
    const sent = await call(server.rename, { slug: "acme-hq", body: { name: "  Acme Global " } })

    expect(sent.status).toBe(200)
    expect(server.updated).toEqual([{ id: "office-1", patch: { name: "Acme Global" } }])
  })

  it("refuses to rename an Office the caller does not own", async () => {
    const server = routes()
    const sent = await call(server.rename, {
      token: "stranger.jwt",
      slug: "acme-hq",
      body: { name: "Mine now" },
    })

    expect(sent.status).toBe(404)
    expect(server.updated).toEqual([])
  })

  it("deletes by marking the row, never by removing it", async () => {
    const server = routes()
    const sent = await call(server.remove, { slug: "acme-hq" })

    expect(sent.status).toBe(200)
    expect(server.updated).toEqual([
      { id: "office-1", patch: { deleted_at: "2026-09-03T12:00:00.000Z" } },
    ])
  })

  it("refuses to delete an Office the caller does not own", async () => {
    const server = routes()
    const sent = await call(server.remove, { token: "stranger.jwt", slug: "acme-hq" })

    expect(sent.status).toBe(404)
    expect(server.updated).toEqual([])
  })
})

describe("Finding the key the server writes with", () => {
  it("takes the secret key under the name Supabase gives it now", () => {
    expect(supabaseSecret({ SUPABASE_SECRET_KEY: "sb_secret_x" })).toBe("sb_secret_x")
  })

  it("still reads it under the name Supabase gave it before the rename", () => {
    expect(supabaseSecret({ SUPABASE_SERVICE_ROLE_KEY: "service_role_x" })).toBe("service_role_x")
  })

  it("reports nothing rather than fall back to a key the browser also holds", () => {
    expect(supabaseSecret({})).toBe(null)
    expect(supabaseSecret({ VITE_SUPABASE_PUBLISHABLE_KEY: "sb_pub" })).toBe(null)
  })
})
