import { createClient } from "@supabase/supabase-js"

/**
 * The server's read-only window onto the offices table.
 *
 * It reads `offices_public`, the same view a browser reads: published Offices only, and
 * no draft column to leak (ADR-0005). That means the publishable key is enough — the
 * server needs no privilege here that a Visitor does not already have, so it asks for
 * none. ADR-0002's service-role fetch is a separate errand, for the Layout the relay
 * enforces privacy against.
 */

/**
 * Which Supabase to ask, from the environment. Both namings are accepted: `sb_publishable_…`
 * is what Supabase used to call the anon key, and the browser-side `VITE_` pair is read as
 * a fallback so a project configured for the app needs nothing extra for the server.
 *
 * Returns null when nothing is configured, which the caller is expected to treat as fatal:
 * without it the token endpoint cannot tell a real Office from an invented one.
 */
export function supabaseConfig(env) {
  const url = env.SUPABASE_URL ?? env.VITE_SUPABASE_URL
  const key =
    env.SUPABASE_PUBLISHABLE_KEY ??
    env.SUPABASE_ANON_KEY ??
    env.VITE_SUPABASE_PUBLISHABLE_KEY ??
    env.VITE_SUPABASE_ANON_KEY
  return url && key ? { url, key } : null
}

/**
 * Answers the one question the token endpoint has: is there an Office at this address?
 *
 * "Published and not deleted" is what the view selects, so there is nothing to check here
 * beyond whether a row came back — and nothing else about the Office is read, because
 * nothing else is any of the gate's business.
 *
 * Throws when the database cannot be reached. A caller must not read that as "no such
 * Office": not knowing is not the same answer as no.
 */
export function publishedOfficeCheck({ url, key }) {
  const client = createClient(url, key, { auth: { persistSession: false } })

  return async function isOfficePublished(slug) {
    const { data, error } = await client
      .from("offices_public")
      .select("id")
      .eq("slug", slug)
      .maybeSingle()
    if (error) throw new Error(error.message)
    return data !== null
  }
}
