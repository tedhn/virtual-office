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

/**
 * What an update to an Office may set: any column a client writes, plus the mark that
 * deletes it.
 *
 * `deleted_at` is in the patch but not in `OfficeFields`, because it is not part of what
 * an Office *is* — no Office is created deleted, and nothing reads the column back (see
 * `officeRows.ts`). It is written once, and after that every surface filters on it.
 */
export type OfficePatch = Partial<OfficeFields> & { deleted_at?: string }

/**
 * An Office as it appears in its Owner's list of them: enough to open it, share it, rename
 * it or delete it, and nothing else. No Layout — a list of Offices has no floors to draw,
 * and reading two whole documents per row to render a line of text is a read nobody asked
 * for.
 */
export interface OfficeSummary {
  id: string
  slug: string
  name: string
}

/** The row operations this module needs. `supabaseOfficeRows` is the real implementation. */
export interface OfficeRows {
  insert(fields: OfficeFields): Promise<Office>
  update(id: string, patch: OfficePatch): Promise<Office>
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

/**
 * An Office's name, as it will be stored. Trimmed, because a trailing space is not part of
 * what somebody called their Office, and refused when there is nothing left — the database
 * says the same thing, less helpfully.
 */
function checkName(name: string): string {
  const trimmed = name.trim()
  if (!trimmed) throw new Error("name: an Office needs a name")
  return trimmed
}

/**
 * The floor columns for a Layout becoming the Office's own. They describe the Office's
 * published Floor — the one every client of it shares — so they travel with a Layout at
 * creation and at publish, and the database refuses a row where the published document and
 * these columns disagree about how big the Floor is.
 */
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
  const name = checkName(office.name)
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
 *
 * The floor columns are deliberately left as they are. A draft's Floor is a proposal — an
 * Owner may type a wider one and go on working for a week, while the people standing in the
 * Office are on the Floor that was published to them — so the columns follow the published
 * Layout, and this write is the one that must not touch them.
 */
export async function saveDraft(rows: OfficeRows, officeId: string, layout: Layout): Promise<Office> {
  const draft = wellFormed(layout)
  return rows.update(officeId, { draft_layout: draft })
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

/**
 * Rename an Office. The name is the only thing that changes: the slug it is addressed by
 * is permanent, so every link anybody has already shared goes on reaching it (CONTEXT.md,
 * Slug). The database refuses a slug change outright, which is what makes that a fact
 * rather than a promise this function keeps.
 */
export async function renameOffice(
  rows: OfficeRows,
  officeId: string,
  name: string,
): Promise<Office> {
  return rows.update(officeId, { name: checkName(name) })
}

/**
 * Delete an Office: mark the row deleted, and leave it there.
 *
 * A row removed outright takes its slug with it and hands that address to whoever asks for
 * it next — which would silently drop somebody's bookmark into a stranger's Office. So the
 * row stays, its slug stays spent for good, and every public surface stops showing it: the
 * `offices_public` view filters on this column, so the Office stops rendering, stops
 * minting Stream tokens, and stops being a channel on the relay.
 *
 * What "deleted" means is the mark being there, not the moment it names — nothing reads the
 * timestamp back, and no surface compares it to the clock. It is a record of when, which is
 * why the clock is a parameter: a test should not have to know today's date.
 *
 * The people standing in the Office at the time are not disconnected by this write. Their
 * sockets belong to the relay, which no database write can reach; telling it is
 * `announceDeleted`'s job (see `lib/publishing.ts`).
 */
export async function deleteOffice(
  rows: OfficeRows,
  officeId: string,
  now: () => string = () => new Date().toISOString(),
): Promise<Office> {
  return rows.update(officeId, { deleted_at: now() })
}
