import type { PostgrestSingleResponse, SupabaseClient } from "@supabase/supabase-js"
import { OfficeWriteError } from "./offices"
import type {
  Office,
  OfficeFields,
  OfficePatch,
  OfficeRows,
  OfficeSummary,
  PublishedOffice,
} from "./offices"

/**
 * The Supabase side of the office store: the thinnest possible translation of the row
 * operations in `offices.ts` into PostgREST calls. Nothing decides anything here — the
 * rules live above (validation, in `offices.ts`) and below (ownership and versioning, in
 * the database), so this layer stays a place where nothing can go subtly wrong.
 */

/**
 * The row, or the refusal — carrying the database's SQLSTATE, which is the only reliable
 * way to tell a slug that is already taken from a write that was not allowed at all.
 */
function rowOrThrow<T>(response: PostgrestSingleResponse<T>): T {
  if (response.error) throw new OfficeWriteError(response.error.message, response.error.code)
  return response.data
}

export function supabaseOfficeRows(client: SupabaseClient): OfficeRows {
  const offices = () => client.from("offices")
  return {
    insert: async (fields: OfficeFields) =>
      rowOrThrow(await offices().insert(fields).select().single()) as Office,
    update: async (id: string, patch: OfficePatch) =>
      rowOrThrow(await offices().update(patch).eq("id", id).select().single()) as Office,
  }
}

/** The columns an Owner reads back. Deliberately not `deleted_at`: it is filtered on, not read. */
const OWN_OFFICE_COLUMNS =
  "id, owner_id, slug, name, floor_width, floor_height, draft_layout, published_layout, layout_version"

/**
 * The Office as its Owner sees it, draft and all.
 *
 * This reads the `offices` table rather than the public view, which is the whole of how
 * the editor is Owner-only: every policy on that table names the Owner, so a request from
 * anybody else comes back empty (ADR-0005). There is no permission check in this codebase
 * to go looking for — the answer is that a stranger's query returns no rows, and a
 * stranger cannot get past that by reading the client's source.
 *
 * A deleted Office is filtered out here rather than by a policy, because the row is still
 * the Owner's; "deleted" is a thing it is, not a thing they may not see.
 */
export async function readOwnOffice(
  client: SupabaseClient,
  slug: string,
): Promise<Office | null> {
  const { data, error } = await client
    .from("offices")
    .select(OWN_OFFICE_COLUMNS)
    .eq("slug", slug)
    .is("deleted_at", null)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return (data as Office | null) ?? null
}

/**
 * Every Office this account owns, newest first.
 *
 * `owner_id` is filtered on even though the policy on the table already restricts the
 * answer to the caller's own rows — the filter says what the query means, and the database
 * is what makes it true (ADR-0005). It is also the only thing this read is keyed on, so
 * the list reloads when a different account signs in and not otherwise.
 *
 * A deleted Office is left out here for the same reason it is left out of `readOwnOffice`:
 * the row is still the Owner's, but "deleted" is a thing it is, and an Office they have
 * deleted is not one of theirs to open any more.
 */
export async function listOwnOffices(
  client: SupabaseClient,
  ownerId: string,
): Promise<OfficeSummary[]> {
  const { data, error } = await client
    .from("offices")
    .select("id, slug, name")
    .eq("owner_id", ownerId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
  if (error) throw new Error(error.message)
  return (data as OfficeSummary[] | null) ?? []
}

/**
 * The Office behind a shared link, as a Visitor sees it: published Layout only, and only
 * if it has been published. Reads the `offices_public` view, the one surface that has no
 * draft column to leak.
 */
export async function readPublishedOffice(
  client: SupabaseClient,
  slug: string,
): Promise<PublishedOffice | null> {
  const { data, error } = await client
    .from("offices_public")
    .select("*")
    .eq("slug", slug)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return (data as PublishedOffice | null) ?? null
}
