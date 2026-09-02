import type { Layout } from "@/office/layout"
import { validateLayout, validatePublishableLayout } from "@/office/layoutSchema"
import { newOfficeLayout } from "@/office/newOfficeLayout"
import { randomTail } from "./randomTail"
import { isSlug, slugCandidates, SLUG_MAX_LENGTH, SLUG_MIN_LENGTH } from "./slug"

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

/**
 * A write the database refused, carrying the SQLSTATE it refused with. The code is the
 * difference between "that slug is taken, try another" and "you may not do that at all",
 * and a message alone cannot be read for it.
 */
export class OfficeWriteError extends Error {
  code: string | undefined

  constructor(message: string, code?: string) {
    super(message)
    this.name = "OfficeWriteError"
    this.code = code
  }
}

/** The unique violation. `slug` is the only unique column an insert can trip over. */
const UNIQUE_VIOLATION = "23505"

/** Whether this failure is an Office already answering to the slug we asked for. */
export function isSlugTaken(error: unknown): boolean {
  return error instanceof OfficeWriteError && error.code === UNIQUE_VIOLATION
}

/** Slugs are permanent and shared in links, so they are held to a shape the database also checks. */
function checkSlug(slug: string): void {
  if (!isSlug(slug)) {
    throw new Error(
      `slug: expected ${SLUG_MIN_LENGTH}-${SLUG_MAX_LENGTH} characters of lowercase letters, digits and single hyphens (got "${slug}")`,
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
 * The creation an Owner actually performs: they name an Office, and get one.
 *
 * Everything else about it follows from the name. The slug comes from it, because a
 * creator should not have to think about URLs to get a link they can share; the Layout is
 * the starter Floor with its one Spawn Zone; and it is created already published, so the
 * link works the moment they are handed it. There is nothing on that Floor to keep
 * private yet, and an Office nobody can open is not one you can be told you have.
 *
 * A slug is permanent and unique, so the name may already be spoken for — by a stranger's
 * Office, invisibly, since Offices are not listable. The database is the only thing that
 * knows, so the answer is to ask it: try the name, then the name with a random tail, and
 * stop after a handful. `tail` is a parameter so a test can force a collision.
 *
 * Use `createOffice` instead when the caller has a slug and a Layout of its own to hand
 * over, and wants the Office to start unpublished.
 */
export async function createOfficeFromName(
  rows: OfficeRows,
  office: { ownerId: string; name: string },
  tail: () => string = randomTail,
): Promise<Office> {
  const name = office.name.trim()
  if (!name) throw new Error("name: an Office needs a name")

  const layout = publishable(newOfficeLayout())
  let refusal: unknown
  for (const slug of slugCandidates(name, tail)) {
    try {
      return await rows.insert({
        owner_id: office.ownerId,
        slug,
        name,
        ...floorOf(layout),
        draft_layout: layout,
        published_layout: layout,
      })
    } catch (error) {
      // Anything but a taken slug — an anonymous identity, a forged owner — is the
      // answer, not an invitation to try a different address.
      if (!isSlugTaken(error)) throw error
      refusal = error
    }
  }
  throw refusal ?? new Error(`slug: found no free address for "${name}"`)
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
