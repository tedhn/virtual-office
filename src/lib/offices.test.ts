import { describe, expect, it } from "vitest"
import { EXAMPLE_LAYOUT } from "@/office/exampleLayout"
import type { Layout } from "@/office/layout"
import { newOfficeLayout } from "@/office/newOfficeLayout"
import {
  createOffice,
  createOfficeFromName,
  deleteOffice,
  OfficeWriteError,
  publishDraft,
  renameOffice,
  saveDraft,
  type OfficeRows,
} from "./offices"

const OWNER = "11111111-1111-1111-1111-111111111111"

/** A Layout with no Spawn Zone: well-formed, but not an Office anyone can arrive in. */
const NO_SPAWN: Layout = {
  floor: { width: 800, height: 600 },
  zones: [{ id: "w", kind: "wall", rect: { x: 0, y: 0, w: 0.1, h: 1 } }],
}

/** The SQLSTATE Postgres raises when a slug is already spoken for. */
const UNIQUE_VIOLATION = "23505"

/**
 * An in-memory stand-in for the offices table, minus its row-level security. `taken`
 * names slugs an earlier Office already answers to, which the database refuses the way
 * the real one does.
 */
function fakeRows(taken: string[] = []) {
  const calls: { op: string; args: unknown }[] = []
  const rows: OfficeRows = {
    insert: async (fields) => {
      calls.push({ op: "insert", args: fields })
      if (taken.includes(fields.slug)) {
        throw new OfficeWriteError(
          'duplicate key value violates unique constraint "offices_slug_key"',
          UNIQUE_VIOLATION,
        )
      }
      return { id: "office-1", layout_version: fields.published_layout ? 1 : 0, ...fields }
    },
    update: async (id, patch) => {
      calls.push({ op: "update", args: { id, patch } })
      return {
        id,
        owner_id: OWNER,
        slug: "acme",
        name: "Acme",
        floor_width: 900,
        floor_height: 2000,
        draft_layout: EXAMPLE_LAYOUT,
        published_layout: null,
        layout_version: 3,
        ...patch,
      }
    },
  }
  return { rows, calls }
}

describe("Creating an Office", () => {
  it("takes the Floor dimensions from the Layout it is given", async () => {
    const { rows, calls } = fakeRows()
    const office = await createOffice(rows, {
      ownerId: OWNER,
      slug: "acme",
      name: "Acme HQ",
      layout: EXAMPLE_LAYOUT,
    })
    expect(calls).toEqual([
      {
        op: "insert",
        args: {
          owner_id: OWNER,
          slug: "acme",
          name: "Acme HQ",
          floor_width: 900,
          floor_height: 2000,
          draft_layout: EXAMPLE_LAYOUT,
          published_layout: null,
        },
      },
    ])
    expect(office.layout_version).toBe(0)
  })

  it("starts an Office unpublished, so nobody can walk in before the Owner says so", async () => {
    const { rows } = fakeRows()
    const office = await createOffice(rows, {
      ownerId: OWNER,
      slug: "acme",
      name: "Acme HQ",
      layout: EXAMPLE_LAYOUT,
    })
    expect(office.published_layout).toBe(null)
  })

  it("rejects a Layout that is not one, without touching the database", async () => {
    const { rows, calls } = fakeRows()
    await expect(
      createOffice(rows, { ownerId: OWNER, slug: "acme", name: "Acme", layout: {} as Layout }),
    ).rejects.toThrow("floor: expected an object")
    expect(calls).toEqual([])
  })

  it("rejects a slug that could not survive being a URL", async () => {
    const { rows, calls } = fakeRows()
    await expect(
      createOffice(rows, { ownerId: OWNER, slug: "Acme HQ!", name: "Acme", layout: EXAMPLE_LAYOUT }),
    ).rejects.toThrow("slug")
    expect(calls).toEqual([])
  })
})

describe("Saving a draft Layout", () => {
  it("stores a draft that is not yet a working Office", async () => {
    const { rows, calls } = fakeRows()
    await saveDraft(rows, "office-1", NO_SPAWN)
    expect(calls).toEqual([
      { op: "update", args: { id: "office-1", patch: { draft_layout: NO_SPAWN } } },
    ])
  })

  it("leaves the floor columns to the published Layout, whatever Floor the draft has", async () => {
    // The columns say how big the Office's Floor is for everyone standing in it, so a draft
    // proposing another size must not touch them — and writing them here would be refused
    // outright, since the published document would then disagree with them.
    const wider: Layout = {
      ...EXAMPLE_LAYOUT,
      floor: { width: EXAMPLE_LAYOUT.floor.width + 400, height: EXAMPLE_LAYOUT.floor.height },
    }
    const { rows, calls } = fakeRows()
    const office = await saveDraft(rows, "office-1", wider)

    expect(calls[0].args).toEqual({ id: "office-1", patch: { draft_layout: wider } })
    // The row the database hands back still reports the Floor it was published with.
    expect(office.floor_width).toBe(900)
    expect(office.draft_layout.floor.width).toBe(wider.floor.width)
  })

  it("rejects a malformed draft before it reaches the database", async () => {
    const { rows, calls } = fakeRows()
    const broken = { floor: { width: 900, height: 2000 }, zones: [{ id: "z", kind: "toilet" }] }
    await expect(saveDraft(rows, "office-1", broken as unknown as Layout)).rejects.toThrow(
      "zones[0].kind",
    )
    expect(calls).toEqual([])
  })
})

describe("Publishing a draft Layout", () => {
  it("promotes the draft to published and leaves the version to the database", async () => {
    const { rows, calls } = fakeRows()
    const office = await publishDraft(rows, "office-1", EXAMPLE_LAYOUT)
    expect(calls).toEqual([
      {
        op: "update",
        args: {
          id: "office-1",
          patch: {
            published_layout: EXAMPLE_LAYOUT,
            draft_layout: EXAMPLE_LAYOUT,
            floor_width: 900,
            floor_height: 2000,
          },
        },
      },
    ])
    expect(office.layout_version).toBe(3)
  })

  it("refuses to publish an Office nobody can arrive in", async () => {
    const { rows, calls } = fakeRows()
    await expect(publishDraft(rows, "office-1", NO_SPAWN)).rejects.toThrow(
      "an Office needs exactly one spawn Zone",
    )
    expect(calls).toEqual([])
  })
})

describe("Naming an Office into existence", () => {
  /** Predictable tails, so a collision can be made to happen on purpose. */
  const tails = () => {
    let n = 0
    return () => `t${n++}`
  }

  it("addresses the Office by the slug its name asks for", async () => {
    const { rows } = fakeRows()
    const office = await createOfficeFromName(rows, { ownerId: OWNER, name: "Acme HQ" }, tails())
    expect(office).toMatchObject({ owner_id: OWNER, slug: "acme-hq", name: "Acme HQ" })
  })

  it("starts it as an empty Floor with one Spawn, published, so its URL renders at once", async () => {
    const { rows, calls } = fakeRows()
    const office = await createOfficeFromName(rows, { ownerId: OWNER, name: "Acme HQ" }, tails())
    expect(calls).toHaveLength(1)
    expect(office.published_layout).toEqual(newOfficeLayout())
    expect(office.draft_layout).toEqual(newOfficeLayout())
    expect(office.floor_width).toBe(newOfficeLayout().floor.width)
    expect(office.floor_height).toBe(newOfficeLayout().floor.height)
  })

  it("trims the name it stores, so a trailing space is not part of the Office", async () => {
    const { rows } = fakeRows()
    const office = await createOfficeFromName(rows, { ownerId: OWNER, name: "  Acme HQ " }, tails())
    expect(office.name).toBe("Acme HQ")
  })

  it("takes the next slug when the one the name asks for is spoken for", async () => {
    const { rows, calls } = fakeRows(["acme-hq"])
    const office = await createOfficeFromName(rows, { ownerId: OWNER, name: "Acme HQ" }, tails())
    expect(office.slug).toBe("acme-hq-t0")
    expect(calls).toHaveLength(2)
  })

  it("gives up rather than asking the database forever", async () => {
    const { rows, calls } = fakeRows([
      "acme-hq",
      "acme-hq-t0",
      "acme-hq-t1",
      "acme-hq-t2",
      "acme-hq-t3",
    ])
    await expect(
      createOfficeFromName(rows, { ownerId: OWNER, name: "Acme HQ" }, tails()),
    ).rejects.toThrow(/duplicate key/)
    expect(calls).toHaveLength(5)
  })

  it("passes on a refusal that is not a collision, without trying another slug", async () => {
    const calls: { op: string; args: unknown }[] = []
    const rows: OfficeRows = {
      insert: async (fields) => {
        calls.push({ op: "insert", args: fields })
        throw new OfficeWriteError("new row violates row-level security policy", "42501")
      },
      update: async () => {
        throw new Error("not called")
      },
    }
    await expect(
      createOfficeFromName(rows, { ownerId: OWNER, name: "Acme HQ" }, tails()),
    ).rejects.toThrow(/row-level security/)
    expect(calls).toHaveLength(1)
  })

  it("refuses an Office with no name at all", async () => {
    const { rows, calls } = fakeRows()
    await expect(
      createOfficeFromName(rows, { ownerId: OWNER, name: "   " }, tails()),
    ).rejects.toThrow("name")
    expect(calls).toEqual([])
  })

  it("still finds a slug for a name with nothing slug-shaped in it", async () => {
    const { rows } = fakeRows()
    const office = await createOfficeFromName(rows, { ownerId: OWNER, name: "🏢" }, tails())
    expect(office.slug).toBe("office")
    expect(office.name).toBe("🏢")
  })
})

describe("Renaming an Office", () => {
  it("changes the name and nothing else, so the link people hold goes on working", async () => {
    const { rows, calls } = fakeRows()
    const office = await renameOffice(rows, "office-1", "Acme Global")
    expect(calls).toEqual([
      { op: "update", args: { id: "office-1", patch: { name: "Acme Global" } } },
    ])
    expect(office.slug).toBe("acme")
  })

  it("trims the name, so a trailing space is not part of the Office", async () => {
    const { rows, calls } = fakeRows()
    await renameOffice(rows, "office-1", "  Acme Global  ")
    expect(calls[0].args).toEqual({ id: "office-1", patch: { name: "Acme Global" } })
  })

  it("refuses to leave an Office with no name at all", async () => {
    const { rows, calls } = fakeRows()
    await expect(renameOffice(rows, "office-1", "   ")).rejects.toThrow("name")
    expect(calls).toEqual([])
  })
})

describe("Deleting an Office", () => {
  it("marks the row deleted rather than removing it, so the slug stays spent", async () => {
    const { rows, calls } = fakeRows()
    await deleteOffice(rows, "office-1", () => "2026-09-03T12:00:00.000Z")
    expect(calls).toEqual([
      {
        op: "update",
        args: { id: "office-1", patch: { deleted_at: "2026-09-03T12:00:00.000Z" } },
      },
    ])
  })

  it("touches neither the Layouts nor the name, because a deleted Office is not an edited one", async () => {
    const { rows, calls } = fakeRows()
    await deleteOffice(rows, "office-1")
    expect(Object.keys((calls[0].args as { patch: object }).patch)).toEqual(["deleted_at"])
  })
})
