import type { Layout } from "@/office/layout"
import { validateLayout, validatePublishableLayout } from "@/office/layoutSchema"

/**
 * Writing and reading Offices.
 *
 * Everything a Layout write has to be right about happens here, above the database: a
 * malformed Layout is refused before a request is issued (ADR-0001), and a draft is only
 * held to being well-formed while publishing is held to describing an Office that works.
 * The database is left to enforce what only it can — ownership, slug permanence, and the
 * published-Layout version counter.
 */

/** The offices columns a client writes. Named as the columns are, so the adapter stays dumb. */
export interface OfficeFields {
  owner_id: string
  slug: string
  name: string
  floor_width: number
  floor_height: number
  draft_layout: Layout
  published_layout: Layout | null
}

/** A stored Office, as its Owner sees it. */
export interface Office extends OfficeFields {
  id: string
  layout_version: number
}

/**
 * An Office as everyone else sees it: what `offices_public` exposes. There is no draft
 * here, and there is no null published Layout — an unpublished Office is not visible.
 */
export interface PublishedOffice {
  id: string
  owner_id: string
  slug: string
  name: string
  floor_width: number
  floor_height: number
  published_layout: Layout
  layout_version: number
}

/** The row operations this module needs. `supabaseOfficeRows` is the real implementation. */
export interface OfficeRows {
  insert(fields: OfficeFields): Promise<Office>
  update(id: string, patch: Partial<OfficeFields>): Promise<Office>
}

/** Slugs are permanent and shared in links, so they are held to a shape the database also checks. */
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/

function checkSlug(slug: string): void {
  if (!SLUG.test(slug) || slug.length < 3 || slug.length > 63) {
    throw new Error(
      `slug: expected 3-63 characters of lowercase letters, digits and single hyphens (got "${slug}")`,
    )
  }
}

/** A Layout's own Floor dimensions are the Office's — the two are never stored apart. */
function floorOf(layout: Layout) {
  return { floor_width: layout.floor.width, floor_height: layout.floor.height }
}

function wellFormed(layout: Layout): Layout {
  const result = validateLayout(layout)
  if (!result.ok) throw new Error(result.errors.join("; "))
  return result.layout
}

function publishable(layout: Layout): Layout {
  const result = validatePublishableLayout(layout)
  if (!result.ok) throw new Error(result.errors.join("; "))
  return result.layout
}

/**
 * Create an Office, unpublished: the Layout handed in becomes its draft, and nobody but
 * the Owner can see it until they publish. The database refuses this outright for an
 * anonymous identity (ADR-0003).
 */
export async function createOffice(
  rows: OfficeRows,
  office: { ownerId: string; slug: string; name: string; layout: Layout },
): Promise<Office> {
  checkSlug(office.slug)
  const draft = wellFormed(office.layout)
  return rows.insert({
    owner_id: office.ownerId,
    slug: office.slug,
    name: office.name,
    ...floorOf(draft),
    draft_layout: draft,
    published_layout: null,
  })
}

/**
 * Save the Owner's work in progress. Held only to being a Layout: a draft is free to be
 * an Office nobody could use yet, which is what makes it a draft.
 */
export async function saveDraft(rows: OfficeRows, officeId: string, layout: Layout): Promise<Office> {
  const draft = wellFormed(layout)
  return rows.update(officeId, { draft_layout: draft, ...floorOf(draft) })
}

/**
 * Publish: promote a draft to the Layout Visitors enter and the server enforces privacy
 * against. This is the moment a Layout stops being allowed to be nonsense, so it is
 * checked harder than a draft save. The version counter is the database's to bump.
 */
export async function publishDraft(
  rows: OfficeRows,
  officeId: string,
  layout: Layout,
): Promise<Office> {
  const published = publishable(layout)
  return rows.update(officeId, {
    published_layout: published,
    draft_layout: published,
    ...floorOf(published),
  })
}
