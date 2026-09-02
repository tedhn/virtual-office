import { describe, expect, it } from "vitest"
import { DEFAULT_LAYOUT } from "@/office/defaultLayout"
import type { Layout } from "@/office/layout"
import { createOffice, publishDraft, saveDraft, type OfficeRows } from "./offices"

const OWNER = "11111111-1111-1111-1111-111111111111"

/** A Layout with no Spawn Zone: well-formed, but not an Office anyone can arrive in. */
const NO_SPAWN: Layout = {
  floor: { width: 800, height: 600 },
  zones: [{ id: "w", kind: "wall", rect: { x: 0, y: 0, w: 0.1, h: 1 } }],
}

/** An in-memory stand-in for the offices table, minus its row-level security. */
function fakeRows() {
  const calls: { op: string; args: unknown }[] = []
  const rows: OfficeRows = {
    insert: async (fields) => {
      calls.push({ op: "insert", args: fields })
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
        draft_layout: DEFAULT_LAYOUT,
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
      layout: DEFAULT_LAYOUT,
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
          draft_layout: DEFAULT_LAYOUT,
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
      layout: DEFAULT_LAYOUT,
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
      createOffice(rows, { ownerId: OWNER, slug: "Acme HQ!", name: "Acme", layout: DEFAULT_LAYOUT }),
    ).rejects.toThrow("slug")
    expect(calls).toEqual([])
  })
})

describe("Saving a draft Layout", () => {
  it("stores a draft that is not yet a working Office", async () => {
    const { rows, calls } = fakeRows()
    await saveDraft(rows, "office-1", NO_SPAWN)
    expect(calls).toEqual([
      {
        op: "update",
        args: {
          id: "office-1",
          patch: { draft_layout: NO_SPAWN, floor_width: 800, floor_height: 600 },
        },
      },
    ])
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
    const office = await publishDraft(rows, "office-1", DEFAULT_LAYOUT)
    expect(calls).toEqual([
      {
        op: "update",
        args: {
          id: "office-1",
          patch: {
            published_layout: DEFAULT_LAYOUT,
            draft_layout: DEFAULT_LAYOUT,
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
