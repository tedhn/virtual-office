import type { SupabaseClient } from "@supabase/supabase-js"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import {
  createOffice,
  createOfficeFromName,
  deleteOffice,
  publishDraft,
  renameOffice,
  saveDraft,
  type Office,
} from "@/lib/offices"
import {
  listOwnOffices,
  readOwnOffice,
  readPublishedOffice,
  supabaseOfficeRows,
} from "@/lib/officeRows"
import { slugFrom } from "@/lib/slug"
import { EXAMPLE_LAYOUT } from "@/office/exampleLayout"
import type { Layout } from "@/office/layout"
import { newOfficeLayout } from "@/office/newOfficeLayout"
import { account, anonymousVisitor, asAdmin, asAnon } from "./accounts"
import { configured, missingConfigWarning } from "./testEnv"

/**
 * What the database itself allows, proven against a real Supabase rather than argued about.
 *
 * These are the rules the product cannot be wrong about: a shared link shows a published
 * Layout and never a draft, an Office is invisible to everyone but its Owner, and a slug
 * belongs permanently to the Office it first named.
 *
 * Writing is no longer among them. `insert` and `update` on `offices` are revoked from the
 * keys a browser can hold, so every write here goes through `supabaseOfficeRows(admin)` —
 * the store the token server holds, with the secret key (ADR-0011). Who may perform each
 * write is proven where that decision now lives, in `server/officeWrites.database.test.mjs`.
 * What is proven here is the half that has to remain true underneath it: reads are governed
 * by row-level security exactly as before, and a browser cannot write at all.
 *
 * Point them at a database with `supabase/migrations` applied — `npx supabase start` for
 * a local stack, or a linked project — via .env. They skip when none is configured, so
 * `npm test` still runs on a machine with no database.
 */
if (!configured) console.warn(`[offices.rls] skipped: ${missingConfigWarning}`)

/** A slug is permanent and unique, so every run needs its own. */
const uniqueSlug = (prefix: string) => `${prefix}-${crypto.randomUUID().slice(0, 8)}`

/**
 * A Layout a client would happily send and no Office could ever use. Well shaped enough for
 * the database's own checks — an object with a `zones` array and a numeric Floor — and
 * nonsense past that, which is exactly the gap the server closes.
 */
const NONSENSE_ZONES = {
  floor: { width: 2000, height: 1200 },
  zones: [{ id: "wat", kind: "teleporter", rect: { x: 5, y: -1, w: 0, h: 99 } }],
} as unknown as Layout

describe.skipIf(!configured)("offices row-level security", () => {
  let admin: SupabaseClient
  let owner: SupabaseClient
  let stranger: SupabaseClient
  let visitor: SupabaseClient
  let ownerId: string
  const createdUsers: string[] = []

  /** The row store the token server holds — the only one with anything left to write with. */
  const asServer = () => supabaseOfficeRows(admin)

  /** An Office owned by `owner`, left unpublished. */
  async function anOffice(name = "Acme HQ", layout: Layout = EXAMPLE_LAYOUT): Promise<Office> {
    return createOffice(asServer(), {
      ownerId,
      slug: uniqueSlug("acme"),
      name,
      layout,
    })
  }

  beforeAll(async () => {
    admin = asAdmin()
    const first = await account(admin)
    owner = first.client
    ownerId = first.id
    createdUsers.push(first.id)

    const second = await account(admin)
    stranger = second.client
    createdUsers.push(second.id)

    visitor = (await anonymousVisitor()).client
  }, 30_000)

  afterAll(async () => {
    for (const id of createdUsers) await admin?.auth.admin.deleteUser(id)
  })

  it("lets an Owner create an Office and read it back, draft and all", async () => {
    const office = await anOffice()
    const { data } = await owner.from("offices").select("*").eq("id", office.id).single()
    expect(data).toMatchObject({
      owner_id: ownerId,
      name: "Acme HQ",
      published_layout: null,
      layout_version: 0,
    })
    expect(data?.draft_layout).toEqual(EXAMPLE_LAYOUT)
  })

  it("hides an Office from everyone but its Owner", async () => {
    const office = await anOffice()
    const { data, error } = await stranger.from("offices").select("*").eq("id", office.id)
    expect(error).toBeNull()
    expect(data).toEqual([])
  })

  it("refuses an update from a browser, whoever is holding it", async () => {
    // Not "a stranger may not write to your Office" any more. `insert` and `update` are
    // revoked from `anon` and `authenticated` alike, so the Owner's own client is refused
    // exactly as a stranger's is, and the difference between them stopped being the
    // database's business (ADR-0011).
    const office = await anOffice()

    await expect(supabaseOfficeRows(owner).update(office.id, { name: "Mine" })).rejects.toThrow(
      /permission denied/,
    )
    await expect(
      supabaseOfficeRows(stranger).update(office.id, { name: "Stolen" }),
    ).rejects.toThrow(/permission denied/)

    const { data } = await owner.from("offices").select("name").eq("id", office.id).single()
    expect(data?.name).toBe("Acme HQ")
  })

  it("refuses a Layout full of nonsense Zones from a browser holding the public key", async () => {
    // The write this whole arrangement exists to stop, attempted the way it would really be
    // attempted: past `offices.ts` entirely, straight at PostgREST. The document is well
    // shaped enough for every check the database makes on its own — an object, a `zones`
    // array, a numeric Floor agreeing with the columns — and its Zones are gibberish.
    // Nothing in SQL knows what a Zone is and nothing should (ADR-0004), so the answer has
    // to be that this caller cannot write the column at all.
    const office = await anOffice()
    await publishDraft(asServer(), office.id, EXAMPLE_LAYOUT)

    const { error } = await owner
      .from("offices")
      .update({ published_layout: NONSENSE_ZONES })
      .eq("id", office.id)
    expect(error?.message ?? "").toMatch(/permission denied/)

    // And the Floor the people inside are standing on is exactly where it was.
    const seen = await readPublishedOffice(visitor, office.slug)
    expect(seen?.published_layout).toEqual(EXAMPLE_LAYOUT)
  })

  it("refuses an insert from a browser, so no Office is created behind the server's back", async () => {
    for (const client of [owner, stranger, visitor]) {
      await expect(
        createOffice(supabaseOfficeRows(client), {
          ownerId,
          slug: uniqueSlug("smuggled"),
          name: "Smuggled",
          layout: EXAMPLE_LAYOUT,
        }),
      ).rejects.toThrow(/permission denied/)
    }
  })

  it("removes nothing when anybody tries to delete the row itself", async () => {
    const office = await anOffice()
    const { error } = await stranger.from("offices").delete().eq("id", office.id)
    expect(error).toBeNull() // row-level security filters the delete rather than failing it

    const { data } = await owner.from("offices").select("id").eq("id", office.id)
    expect(data).toHaveLength(1)
  })

  it("shows a Visitor a published Layout, and no unpublished Office at all", async () => {
    const draftOnly = await anOffice("Unpublished")
    const published = await anOffice("Published")
    await publishDraft(asServer(), published.id, EXAMPLE_LAYOUT)

    expect(await readPublishedOffice(visitor, published.slug)).toMatchObject({
      slug: published.slug,
      name: "Published",
      published_layout: EXAMPLE_LAYOUT,
    })
    expect(await readPublishedOffice(visitor, draftOnly.slug)).toBeNull()
  })

  it("never hands a draft Layout to a Visitor", async () => {
    const office = await anOffice("Published")
    await publishDraft(asServer(), office.id, EXAMPLE_LAYOUT)

    // The published surface has no draft column to ask for.
    const asked = await visitor.from("offices_public").select("draft_layout").eq("slug", office.slug)
    expect(asked.error?.message ?? "").toContain("draft_layout")

    // And the table the column lives on is closed to anyone but its Owner.
    const table = await visitor.from("offices").select("draft_layout").eq("id", office.id)
    expect(table.data ?? []).toEqual([])
  })

  it("keeps a slug attached to the Office it first named", async () => {
    const office = await anOffice()
    await expect(
      asServer().update(office.id, { slug: uniqueSlug("renamed") }),
    ).rejects.toThrow(/permanent/)
  })

  it("counts every publish of a Layout", async () => {
    const office = await anOffice()
    expect(office.layout_version).toBe(0)

    const first = await publishDraft(asServer(), office.id, EXAMPLE_LAYOUT)
    expect(first.layout_version).toBe(1)

    const moved: Layout = {
      ...EXAMPLE_LAYOUT,
      zones: EXAMPLE_LAYOUT.zones.filter((z) => z.kind !== "wall"),
    }
    const second = await publishDraft(asServer(), office.id, moved)
    expect(second.layout_version).toBe(2)
  })

  it("refuses a document that is not a Layout, even from its Owner", async () => {
    const office = await anOffice()
    // Straight past the write path in `offices.ts`, which is what the secret key can do:
    // the database has to refuse this on its own, since nothing above it is left to.
    const { error } = await admin
      .from("offices")
      .update({ published_layout: { not: "a layout" } })
      .eq("id", office.id)
    expect(error?.message ?? "").toMatch(/violates check constraint/)

    const { data } = await admin.from("offices").select("published_layout").eq("id", office.id)
    expect(data?.[0]?.published_layout).toBeNull()
  })

  it("refuses an empty document as a draft Layout", async () => {
    const office = await anOffice()
    const { error } = await admin.from("offices").update({ draft_layout: {} }).eq("id", office.id)
    expect(error?.message ?? "").toMatch(/violates check constraint/)
  })

  it("refuses floor columns that disagree with the published Layout", async () => {
    // A Zone rect means nothing without the Floor it is measured against, so the Floor
    // every client of this Office shares and the document they read it from are not
    // allowed to disagree.
    const { error } = await admin.from("offices").insert({
      owner_id: ownerId,
      slug: uniqueSlug("mismatched"),
      name: "Mismatched",
      floor_width: 640,
      floor_height: 480,
      draft_layout: EXAMPLE_LAYOUT,
      published_layout: EXAMPLE_LAYOUT,
    })
    expect(error?.message ?? "").toContain("offices_published_floor_matches")
  })

  it("stores a draft whose Floor is a different size from the published one", async () => {
    // Resizing the Floor is an edit like any other, and a draft is saved long before it is
    // published: the columns describe the published Floor, so a draft is free to propose
    // another one without the save being refused.
    const office = await anOffice()
    await publishDraft(asServer(), office.id, EXAMPLE_LAYOUT)

    const wider: Layout = {
      ...EXAMPLE_LAYOUT,
      floor: { width: EXAMPLE_LAYOUT.floor.width + 400, height: EXAMPLE_LAYOUT.floor.height },
    }
    await saveDraft(asServer(), office.id, wider)

    const stored = await readOwnOffice(owner, office.slug)
    expect(stored?.draft_layout.floor).toEqual(wider.floor)
    expect(stored?.floor_width).toBe(EXAMPLE_LAYOUT.floor.width)
    expect(stored?.published_layout?.floor).toEqual(EXAMPLE_LAYOUT.floor)

    // And publishing it is what makes that Floor the Office's, columns and all.
    await publishDraft(asServer(), office.id, wider)
    expect((await readPublishedOffice(visitor, office.slug))?.floor_width).toBe(wider.floor.width)
  })

  it("stops a malformed Layout before it reaches the database", async () => {
    const slug = uniqueSlug("never")
    const broken = { floor: { width: 0, height: 2000 }, zones: [] } as unknown as Layout
    await expect(
      createOffice(asServer(), { ownerId, slug, name: "Never", layout: broken }),
    ).rejects.toThrow("floor.width")

    const { data } = await admin.from("offices").select("id").eq("slug", slug)
    expect(data).toEqual([])
  })
  it("stops showing an Office the moment its Owner deletes it", async () => {
    const office = await anOffice("Doomed")
    await publishDraft(asServer(), office.id, EXAMPLE_LAYOUT)
    expect(await readPublishedOffice(visitor, office.slug)).not.toBeNull()

    await deleteOffice(asServer(), office.id)

    expect(await readPublishedOffice(visitor, office.slug)).toBeNull()
  })

  it("opens the editor for the Owner, draft and all", async () => {
    // What the editor loads. Nothing in the client decides whether it may — the Owner gets
    // a row and everybody below gets none, which is the whole of the rule.
    const office = await anOffice("Editable", EXAMPLE_LAYOUT)
    const own = await readOwnOffice(owner, office.slug)
    expect(own).toMatchObject({ id: office.id, name: "Editable" })
    expect(own?.draft_layout).toEqual(EXAMPLE_LAYOUT)
  })

  it("opens the editor for nobody else, signed in or not", async () => {
    const office = await anOffice("Private work")
    expect(await readOwnOffice(stranger, office.slug)).toBeNull()
    expect(await readOwnOffice(visitor, office.slug)).toBeNull()
    expect(await readOwnOffice(asAnon(), office.slug)).toBeNull()
  })

  it("stores a saved draft and hands it back exactly", async () => {
    const office = await anOffice("Work in progress", newOfficeLayout())
    const authored: Layout = {
      floor: newOfficeLayout().floor,
      zones: [
        { id: "spawn", kind: "spawn", rect: { x: 0.3, y: 0.45, w: 0.4, h: 0.1 } },
        { id: "room-1", kind: "room", private: true, label: "Focus", rect: { x: 0, y: 0, w: 0.5, h: 0.2 } },
        { id: "table-1", kind: "table", style: "dining", seats: 4, rect: { x: 0.1, y: 0.7, w: 0.3, h: 0.05 } },
      ],
    }

    await saveDraft(asServer(), office.id, authored)

    // Reopening is a fresh read, the way coming back tomorrow is.
    const reopened = await readOwnOffice(owner, office.slug)
    expect(reopened?.draft_layout).toEqual(authored)
  })

  it("saves a draft that is not a publishable Office, because a draft may not be one", async () => {
    // No Spawn Zone: an Office nobody could arrive in. Publishing refuses this; saving a
    // draft must not, or half-finished work has nowhere to live (CONTEXT.md, Layout).
    const office = await anOffice("Half done", newOfficeLayout())
    const noSpawn: Layout = { floor: newOfficeLayout().floor, zones: [] }

    await saveDraft(asServer(), office.id, noSpawn)

    expect((await readOwnOffice(owner, office.slug))?.draft_layout).toEqual(noSpawn)
    await expect(publishDraft(asServer(), office.id, noSpawn)).rejects.toThrow(
      /spawn/,
    )
  })

  it("leaves what Visitors see alone while a draft is being authored", async () => {
    const office = await anOffice("Two layouts", EXAMPLE_LAYOUT)
    await publishDraft(asServer(), office.id, EXAMPLE_LAYOUT)

    await saveDraft(asServer(), office.id, {
      floor: EXAMPLE_LAYOUT.floor,
      zones: [{ id: "spawn", kind: "spawn", rect: { x: 0.3, y: 0.45, w: 0.4, h: 0.1 } }],
    })

    const seen = await readPublishedOffice(visitor, office.slug)
    expect(seen?.published_layout).toEqual(EXAMPLE_LAYOUT)
  })

  it("does not open the editor for an Office its Owner has deleted", async () => {
    const office = await anOffice("Gone")
    await deleteOffice(asServer(), office.id)

    expect(await readOwnOffice(owner, office.slug)).toBeNull()
  })

  it("keeps a deleted Office's slug spent, so its link never resolves elsewhere", async () => {
    const office = await anOffice("Doomed")
    await deleteOffice(asServer(), office.id)

    await expect(
      createOffice(asServer(), {
        ownerId,
        slug: office.slug,
        name: "Squatter",
        layout: EXAMPLE_LAYOUT,
      }),
    ).rejects.toThrow(/duplicate key|offices_slug_key/)
  })

  it("hands an Owner every Office they own, and nobody else's", async () => {
    const mine = await anOffice("Mine")
    const alsoMine = await anOffice("Also mine")

    const listed = await listOwnOffices(owner, ownerId)
    expect(listed.map((o) => o.id)).toEqual(expect.arrayContaining([mine.id, alsoMine.id]))
    expect(listed.every((o) => o.name && o.slug)).toBe(true)

    // Asking for somebody else's Offices by their id answers with nothing: the policy is
    // on the row, not on the filter, so naming an owner you are not gets you no rows.
    expect(await listOwnOffices(stranger, ownerId)).toEqual([])
    expect(await listOwnOffices(visitor, ownerId)).toEqual([])
  })

  it("refuses to remove the row, so deleting an Office can only ever mark it deleted", async () => {
    // The row is what keeps the slug spent, so the Owner does not get to take it away
    // either. No policy names DELETE, so the statement matches no rows rather than failing —
    // the same answer a stranger's delete has always been given.
    const office = await anOffice("Stubborn")

    const { error } = await owner.from("offices").delete().eq("id", office.id)
    expect(error).toBeNull()

    expect(await readOwnOffice(owner, office.slug)).not.toBeNull()
  })

  it("keeps a removed-then-recreated slug out of reach even after a hard delete attempt", async () => {
    const office = await anOffice("Doomed")
    await owner.from("offices").delete().eq("id", office.id)
    await deleteOffice(asServer(), office.id)

    await expect(
      createOffice(asServer(), {
        ownerId,
        slug: office.slug,
        name: "Squatter",
        layout: EXAMPLE_LAYOUT,
      }),
    ).rejects.toThrow(/duplicate key|offices_slug_key/)
  })

  it("drops an Office out of its Owner's list once they delete it", async () => {
    const office = await anOffice("Doomed")
    expect((await listOwnOffices(owner, ownerId)).map((o) => o.id)).toContain(office.id)

    await deleteOffice(asServer(), office.id)

    expect((await listOwnOffices(owner, ownerId)).map((o) => o.id)).not.toContain(office.id)
  })

  it("renames an Office without moving it, so a shared link still opens it", async () => {
    const office = await anOffice("Old name")
    await publishDraft(asServer(), office.id, EXAMPLE_LAYOUT)

    const renamed = await renameOffice(asServer(), office.id, "New name")
    expect(renamed.slug).toBe(office.slug)

    const seen = await readPublishedOffice(visitor, office.slug)
    expect(seen?.name).toBe("New name")
  })

  it("refuses to rename or delete an Office belonging to somebody else", async () => {
    const office = await anOffice("Not yours")

    await expect(
      renameOffice(supabaseOfficeRows(stranger), office.id, "Mine now"),
    ).rejects.toThrow()
    await expect(deleteOffice(supabaseOfficeRows(stranger), office.id)).rejects.toThrow()

    const stored = await readOwnOffice(owner, office.slug)
    expect(stored?.name).toBe("Not yours")
  })
})

describe.skipIf(!configured)("naming an Office into existence", () => {
  let admin: SupabaseClient
  let visitor: SupabaseClient
  let visitorId: string
  let ownerId: string
  const createdUsers: string[] = []

  /** A name no other run has used, so the bare slug is genuinely free the first time. */
  const uniqueName = () => `Acme ${crypto.randomUUID().slice(0, 8)}`

  /** The row store the token server holds — the only one with anything left to write with. */
  const asServer = () => supabaseOfficeRows(admin)

  beforeAll(async () => {
    admin = asAdmin()
    const created = await account(admin)
    ownerId = created.id
    createdUsers.push(created.id)

    const walkedIn = await anonymousVisitor()
    visitor = walkedIn.client
    visitorId = walkedIn.id
  }, 30_000)

  afterAll(async () => {
    for (const id of createdUsers) await admin?.auth.admin.deleteUser(id)
  })

  it("gives the creator an Office reachable at the slug its name asked for", async () => {
    const name = uniqueName()
    const office = await createOfficeFromName(asServer(), { ownerId, name })

    expect(office.slug).toBe(slugFrom(name))
    expect(office.layout_version).toBe(1)
    expect(await readPublishedOffice(visitor, office.slug)).toMatchObject({
      slug: office.slug,
      name,
      published_layout: newOfficeLayout(),
    })
  })

  it("starts it as an empty Floor with one Spawn Zone", async () => {
    const office = await createOfficeFromName(asServer(), {
      ownerId,
      name: uniqueName(),
    })
    const seen = await readPublishedOffice(visitor, office.slug)
    expect(seen?.published_layout.zones.map((z) => z.kind)).toEqual(["spawn"])
    expect(seen?.floor_width).toBe(newOfficeLayout().floor.width)
    expect(seen?.floor_height).toBe(newOfficeLayout().floor.height)
  })

  it("finds a second address when the name is already taken", async () => {
    const name = uniqueName()
    const first = await createOfficeFromName(asServer(), { ownerId, name })
    const second = await createOfficeFromName(asServer(), { ownerId, name })

    expect(first.slug).toBe(slugFrom(name))
    expect(second.slug).not.toBe(first.slug)
    expect(second.slug.startsWith(`${first.slug}-`)).toBe(true)
    expect(await readPublishedOffice(visitor, second.slug)).toMatchObject({ slug: second.slug })
  })

  it("never gives an Office an address the server owns, and the database agrees", async () => {
    const office = await createOfficeFromName(asServer(), { ownerId, name: "API" })
    expect(office.slug).not.toBe("api")
    expect(office.slug.startsWith("api-")).toBe(true)

    // The client picks another address; this is the copy that cannot be bypassed.
    const { error } = await admin.from("offices").insert({
      owner_id: ownerId,
      slug: "api",
      name: "API",
      floor_width: newOfficeLayout().floor.width,
      floor_height: newOfficeLayout().floor.height,
      draft_layout: newOfficeLayout(),
      published_layout: null,
    })
    expect(error?.message ?? "").toContain("offices_slug_not_reserved")
  })

  it("refuses a browser outright, rather than trying another slug", async () => {
    // A refusal that is not a taken slug ends the search rather than restarting it — and
    // "you may not write here at all" is now the refusal every browser gets, whoever is
    // holding it. That an anonymous Visitor may not own an Office is still true and still
    // enforced; it moved to `server/officeWrites.database.test.mjs`, where the account
    // making the request is known (ADR-0003, ADR-0011).
    await expect(
      createOfficeFromName(supabaseOfficeRows(visitor), { ownerId: visitorId, name: uniqueName() }),
    ).rejects.toThrow(/permission denied/)
  })
})
