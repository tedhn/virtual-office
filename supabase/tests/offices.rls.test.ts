import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { createOffice, publishDraft, type Office } from "@/lib/offices"
import { readPublishedOffice, supabaseOfficeRows } from "@/lib/officeRows"
import { DEFAULT_LAYOUT } from "@/office/defaultLayout"
import type { Layout } from "@/office/layout"
import { configured, missingConfigWarning, publishableKey, secretKey, supabaseUrl } from "./testEnv"

/**
 * Row-level security, proven against a real Supabase rather than argued about.
 *
 * These are the rules the product cannot be wrong about: an Owner authors their own
 * Office and nobody else's, a shared link shows a published Layout and never a draft,
 * and an anonymous Visitor cannot create an Office at all (ADR-0003).
 *
 * Point them at a database with `supabase/migrations` applied — `npx supabase start` for
 * a local stack, or a linked project — via .env. They skip when none is configured, so
 * `npm test` still runs on a machine with no database.
 */
if (!configured) console.warn(`[offices.rls] skipped: ${missingConfigWarning}`)

/** A slug is permanent and unique, so every run needs its own. */
const uniqueSlug = (prefix: string) => `${prefix}-${crypto.randomUUID().slice(0, 8)}`

const asAnon = () => createClient(supabaseUrl!, publishableKey!, { auth: { persistSession: false } })

describe.skipIf(!configured)("offices row-level security", () => {
  let admin: SupabaseClient
  let owner: SupabaseClient
  let stranger: SupabaseClient
  let visitor: SupabaseClient
  let ownerId: string
  const createdUsers: string[] = []

  /** A confirmed account, signed in — the "real, recoverable account" of ADR-0003. */
  async function account(): Promise<{ client: SupabaseClient; id: string }> {
    const email = `${crypto.randomUUID()}@example.com`
    const password = crypto.randomUUID()
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true })
    if (created.error) throw new Error(created.error.message)
    createdUsers.push(created.data.user.id)

    const client = asAnon()
    const signedIn = await client.auth.signInWithPassword({ email, password })
    if (signedIn.error) throw new Error(signedIn.error.message)
    return { client, id: created.data.user.id }
  }

  /** An Office owned by `owner`, left unpublished. */
  async function anOffice(name = "Acme HQ", layout: Layout = DEFAULT_LAYOUT): Promise<Office> {
    return createOffice(supabaseOfficeRows(owner), {
      ownerId,
      slug: uniqueSlug("acme"),
      name,
      layout,
    })
  }

  beforeAll(async () => {
    admin = createClient(supabaseUrl!, secretKey!, { auth: { persistSession: false } })
    const first = await account()
    owner = first.client
    ownerId = first.id
    stranger = (await account()).client

    visitor = asAnon()
    const anonymous = await visitor.auth.signInAnonymously()
    if (anonymous.error) {
      throw new Error(
        `anonymous sign-in failed (${anonymous.error.message}) — enable it for this project`,
      )
    }
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
    expect(data?.draft_layout).toEqual(DEFAULT_LAYOUT)
  })

  it("hides an Office from everyone but its Owner", async () => {
    const office = await anOffice()
    const { data, error } = await stranger.from("offices").select("*").eq("id", office.id)
    expect(error).toBeNull()
    expect(data).toEqual([])
  })

  it("refuses a write by anyone but the Owner", async () => {
    const office = await anOffice()
    await expect(
      supabaseOfficeRows(stranger).update(office.id, { name: "Stolen" }),
    ).rejects.toThrow()

    const { data } = await owner.from("offices").select("name").eq("id", office.id).single()
    expect(data?.name).toBe("Acme HQ")
  })

  it("refuses a delete by anyone but the Owner", async () => {
    const office = await anOffice()
    const { error } = await stranger.from("offices").delete().eq("id", office.id)
    expect(error).toBeNull() // row-level security filters the delete rather than failing it

    const { data } = await owner.from("offices").select("id").eq("id", office.id)
    expect(data).toHaveLength(1)
  })

  it("refuses to create an Office owned by someone else", async () => {
    await expect(
      createOffice(supabaseOfficeRows(stranger), {
        ownerId,
        slug: uniqueSlug("forged"),
        name: "Forged",
        layout: DEFAULT_LAYOUT,
      }),
    ).rejects.toThrow()
  })

  it("refuses to let an anonymous Visitor create an Office", async () => {
    await expect(
      createOffice(supabaseOfficeRows(visitor), {
        ownerId: (await visitor.auth.getUser()).data.user!.id,
        slug: uniqueSlug("transient"),
        name: "Transient",
        layout: DEFAULT_LAYOUT,
      }),
    ).rejects.toThrow()
  })

  it("shows a Visitor a published Layout, and no unpublished Office at all", async () => {
    const draftOnly = await anOffice("Unpublished")
    const published = await anOffice("Published")
    await publishDraft(supabaseOfficeRows(owner), published.id, DEFAULT_LAYOUT)

    expect(await readPublishedOffice(visitor, published.slug)).toMatchObject({
      slug: published.slug,
      name: "Published",
      published_layout: DEFAULT_LAYOUT,
    })
    expect(await readPublishedOffice(visitor, draftOnly.slug)).toBeNull()
  })

  it("never hands a draft Layout to a Visitor", async () => {
    const office = await anOffice("Published")
    await publishDraft(supabaseOfficeRows(owner), office.id, DEFAULT_LAYOUT)

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
      supabaseOfficeRows(owner).update(office.id, { slug: uniqueSlug("renamed") }),
    ).rejects.toThrow(/permanent/)
  })

  it("counts every publish of a Layout", async () => {
    const office = await anOffice()
    expect(office.layout_version).toBe(0)

    const first = await publishDraft(supabaseOfficeRows(owner), office.id, DEFAULT_LAYOUT)
    expect(first.layout_version).toBe(1)

    const moved: Layout = {
      ...DEFAULT_LAYOUT,
      zones: DEFAULT_LAYOUT.zones.filter((z) => z.kind !== "wall"),
    }
    const second = await publishDraft(supabaseOfficeRows(owner), office.id, moved)
    expect(second.layout_version).toBe(2)
  })

  it("refuses a document that is not a Layout, even from its Owner", async () => {
    const office = await anOffice()
    // Straight past the write path in `offices.ts`, which is what a caller holding the
    // public anon key can do: the database has to refuse this on its own.
    const { error } = await owner
      .from("offices")
      .update({ published_layout: { not: "a layout" } })
      .eq("id", office.id)
    expect(error?.message ?? "").toMatch(/violates check constraint/)

    const { data } = await owner.from("offices").select("published_layout").eq("id", office.id)
    expect(data?.[0]?.published_layout).toBeNull()
  })

  it("refuses an empty document as a draft Layout", async () => {
    const office = await anOffice()
    const { error } = await owner.from("offices").update({ draft_layout: {} }).eq("id", office.id)
    expect(error?.message ?? "").toMatch(/violates check constraint/)
  })

  it("refuses floor columns that disagree with the Layout they came from", async () => {
    const { error } = await owner.from("offices").insert({
      owner_id: ownerId,
      slug: uniqueSlug("mismatched"),
      name: "Mismatched",
      floor_width: 640,
      floor_height: 480,
      draft_layout: DEFAULT_LAYOUT,
      published_layout: null,
    })
    expect(error?.message ?? "").toContain("offices_draft_floor_matches")
  })

  it("stops a malformed Layout before it reaches the database", async () => {
    const slug = uniqueSlug("never")
    const broken = { floor: { width: 0, height: 2000 }, zones: [] } as unknown as Layout
    await expect(
      createOffice(supabaseOfficeRows(owner), { ownerId, slug, name: "Never", layout: broken }),
    ).rejects.toThrow("floor.width")

    const { data } = await admin.from("offices").select("id").eq("slug", slug)
    expect(data).toEqual([])
  })
})
