import type { PostgrestSingleResponse, SupabaseClient } from "@supabase/supabase-js"
import type { Office, OfficeFields, OfficeRows, PublishedOffice } from "./offices"

/**
 * The Supabase side of the office store: the thinnest possible translation of the row
 * operations in `offices.ts` into PostgREST calls. Nothing decides anything here — the
 * rules live above (validation, in `offices.ts`) and below (ownership and versioning, in
 * the database), so this layer stays a place where nothing can go subtly wrong.
 */

function rowOrThrow<T>(response: PostgrestSingleResponse<T>): T {
  if (response.error) throw new Error(response.error.message)
  return response.data
}

export function supabaseOfficeRows(client: SupabaseClient): OfficeRows {
  const offices = () => client.from("offices")
  return {
    insert: async (fields: OfficeFields) =>
      rowOrThrow(await offices().insert(fields).select().single()) as Office,
    update: async (id: string, patch: Partial<OfficeFields>) =>
      rowOrThrow(await offices().update(patch).eq("id", id).select().single()) as Office,
  }
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
