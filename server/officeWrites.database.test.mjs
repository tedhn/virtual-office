import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { fakeRes } from "./fakeRes.mjs"
import { officeStore, officeWriteRoutes, supabaseCallers } from "./officeWrites.mjs"
import { readOwnOffice, readPublishedOffice } from "../src/lib/officeRows.ts"
import { EXAMPLE_LAYOUT } from "../src/office/exampleLayout.ts"
import { newOfficeLayout } from "../src/office/newOfficeLayout.ts"
import { account, anonymousVisitor, asAdmin } from "../supabase/tests/accounts.ts"
import {
  configured,
  missingConfigWarning,
  publishableKey,
  secretKey,
  supabaseUrl,
} from "../supabase/tests/testEnv.ts"

/**
 * The write endpoints against a real Supabase: real tokens, real ownership, real rows.
 *
 * `officeWrites.test.mjs` proves the gate with the auth server and the database replaced by
 * fakes, which is where the branches are. This proves the two things a fake cannot: that a
 * token minted by Supabase is verified by Supabase, and that the secret key really does
 * write rows the browser is no longer allowed to (ADR-0011). Between them and
 * `supabase/tests/offices.rls.test.ts` — which proves the browser's refusal from the other
 * side — the boundary is covered end to end.
 *
 * Point them at a database with `supabase/migrations` applied — `npx supabase start` for a
 * local stack, or a linked project — via .env. They skip when none is configured.
 */
if (!configured) console.warn(`[officeWrites.database] skipped: ${missingConfigWarning}`)

/** A Layout that is well shaped and describes nothing. The write the shared schema exists to refuse. */
const NONSENSE_ZONES = {
  floor: { width: 2000, height: 1200 },
  zones: [{ id: "wat", kind: "teleporter", rect: { x: 5, y: -1, w: 0, h: 99 } }],
}

/** A Layout nobody could arrive in: fine as a draft, refused as a publish. */
const NO_SPAWN = { floor: newOfficeLayout().floor, zones: [] }

describe.skipIf(!configured)("Writing an Office through the server", () => {
  let admin
  let owner
  let stranger
  let visitor
  let writes
  const createdUsers = []

  /** Call a handler the way Express would, and hand back what it answered. */
  async function call(handler, { token, slug, body } = {}) {
    const { res, sent } = fakeRes()
    await handler(
      {
        headers: token ? { authorization: `Bearer ${token}` } : {},
        params: slug === undefined ? {} : { slug },
        body,
      },
      res,
    )
    return sent
  }

  /** An Office of the Owner's, made the way the product makes one. */
  async function anOffice(name = `Acme ${crypto.randomUUID().slice(0, 8)}`) {
    const sent = await call(writes.create, { token: owner.token, body: { name } })
    expect(sent.status).toBe(200)
    return sent.body.office
  }

  beforeAll(async () => {
    admin = asAdmin()
    owner = await account(admin)
    createdUsers.push(owner.id)
    stranger = await account(admin)
    createdUsers.push(stranger.id)
    visitor = await anonymousVisitor()

    const store = officeStore({ url: supabaseUrl, secretKey })
    writes = officeWriteRoutes({
      callerOf: supabaseCallers({ url: supabaseUrl, key: publishableKey }),
      officeAt: store.officeAt,
      rows: store.rows,
    })
  }, 30_000)

  afterAll(async () => {
    for (const id of createdUsers) await admin?.auth.admin.deleteUser(id)
  })

  it("creates an Office owned by the account its token names, published and reachable", async () => {
    const office = await anOffice("Acme HQ")

    expect(office).toMatchObject({ owner_id: owner.id, name: "Acme HQ", layout_version: 1 })
    expect(await readPublishedOffice(visitor.client, office.slug)).toMatchObject({
      slug: office.slug,
      published_layout: newOfficeLayout(),
    })
  })

  it("refuses an anonymous Visitor, who has nowhere durable to be an Owner from", async () => {
    const sent = await call(writes.create, {
      token: visitor.token,
      body: { name: "Transient" },
    })

    expect(sent.status).toBe(403)
  })

  it("refuses a token Supabase did not issue", async () => {
    const sent = await call(writes.create, {
      token: "not.a.jwt",
      body: { name: "Forged" },
    })

    expect(sent.status).toBe(401)
  })

  it("saves a draft that is not a publishable Office, and leaves what Visitors see alone", async () => {
    const office = await anOffice()
    const sent = await call(writes.saveDraft, {
      token: owner.token,
      slug: office.slug,
      body: { layout: NO_SPAWN },
    })

    expect(sent.status).toBe(200)
    expect((await readOwnOffice(owner.client, office.slug))?.draft_layout).toEqual(NO_SPAWN)
    expect((await readPublishedOffice(visitor.client, office.slug))?.published_layout).toEqual(
      newOfficeLayout(),
    )
  })

  it("refuses a Layout full of nonsense Zones, which is the whole reason the write is here", async () => {
    const office = await anOffice()
    const sent = await call(writes.saveDraft, {
      token: owner.token,
      slug: office.slug,
      body: { layout: NONSENSE_ZONES },
    })

    expect(sent.status).toBe(400)
    expect(sent.body.error).toContain("zones[0].kind")
    expect((await readOwnOffice(owner.client, office.slug))?.draft_layout).toEqual(newOfficeLayout())
  })

  it("publishes a Layout, floor columns and version counter and all", async () => {
    const office = await anOffice()
    const sent = await call(writes.publish, {
      token: owner.token,
      slug: office.slug,
      body: { layout: EXAMPLE_LAYOUT },
    })

    expect(sent.status).toBe(200)
    expect(await readPublishedOffice(visitor.client, office.slug)).toMatchObject({
      published_layout: EXAMPLE_LAYOUT,
      floor_width: EXAMPLE_LAYOUT.floor.width,
      floor_height: EXAMPLE_LAYOUT.floor.height,
      layout_version: 2,
    })
  })

  it("refuses to publish an Office nobody could arrive in", async () => {
    const office = await anOffice()
    const sent = await call(writes.publish, {
      token: owner.token,
      slug: office.slug,
      body: { layout: NO_SPAWN },
    })

    expect(sent.status).toBe(400)
    expect(sent.body.error).toMatch(/spawn/)
  })

  it("tells a stranger nothing about an Office that is not theirs, and changes nothing in it", async () => {
    const office = await anOffice("Not yours")

    for (const [handler, body] of [
      [writes.saveDraft, { layout: EXAMPLE_LAYOUT }],
      [writes.publish, { layout: EXAMPLE_LAYOUT }],
      [writes.rename, { name: "Mine now" }],
      [writes.remove, undefined],
    ]) {
      const sent = await call(handler, { token: stranger.token, slug: office.slug, body })
      expect(sent.status).toBe(404)
    }

    const stored = await readOwnOffice(owner.client, office.slug)
    expect(stored?.name).toBe("Not yours")
    expect(stored?.published_layout).toEqual(newOfficeLayout())
  })

  it("renames an Office without moving it, so a shared link still opens it", async () => {
    const office = await anOffice("Old name")
    const sent = await call(writes.rename, {
      token: owner.token,
      slug: office.slug,
      body: { name: "  New name  " },
    })

    expect(sent.status).toBe(200)
    expect(sent.body.office.slug).toBe(office.slug)
    expect((await readPublishedOffice(visitor.client, office.slug))?.name).toBe("New name")
  })

  it("deletes by marking the row, so the slug stays spent and the Office stops answering", async () => {
    const office = await anOffice("Doomed")
    const sent = await call(writes.remove, { token: owner.token, slug: office.slug })

    expect(sent.status).toBe(200)
    expect(await readPublishedOffice(visitor.client, office.slug)).toBeNull()
    expect(await readOwnOffice(owner.client, office.slug)).toBeNull()

    // The row is still there, holding its address against anybody who wants it next — and
    // the server no longer treats it as an Office to write to either.
    const again = await call(writes.rename, {
      token: owner.token,
      slug: office.slug,
      body: { name: "Back from the dead" },
    })
    expect(again.status).toBe(404)
  })
})
