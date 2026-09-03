import { createClient } from "@supabase/supabase-js"

/**
 * The server's read-only window onto the offices table.
 *
 * It reads `offices_public`, the same view a browser reads: published Offices only, and
 * no draft column to leak (ADR-0005). That means the publishable key is enough — the
 * server needs no privilege here that a Visitor does not already have, so it asks for
 * none. That applies to the published Layout the relay enforces privacy against as much
 * as to the token gate's existence check: both are things anyone holding the Office's
 * link may already read (see ADR-0002's amendment).
 */

/**
 * Which Supabase to ask, from the environment. Both namings are accepted: `sb_publishable_…`
 * is what Supabase used to call the anon key, and the browser-side `VITE_` pair is read as
 * a fallback so a project configured for the app needs nothing extra for the server.
 *
 * Returns null when nothing is configured, which the caller is expected to treat as fatal:
 * without it the token endpoint cannot tell a real Office from an invented one, and the
 * relay cannot tell which Rooms are private.
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
 * The two questions the server asks about an Office, over one Supabase client.
 *
 * They are kept apart rather than folded into one lookup because they are asked for
 * different reasons and want different amounts of the row: the token gate only needs to
 * know that an Office is there (ADR-0006), and reading a whole Layout to answer that
 * would be reading something that is none of the gate's business.
 *
 * Both throw when the database cannot be reached. A caller must not read that as "no such
 * Office": not knowing is not the same answer as no.
 */
export function officeDirectory({ url, key }) {
  const client = createClient(url, key, { auth: { persistSession: false } })

  const rowAt = (slug, columns) =>
    client.from("offices_public").select(columns).eq("slug", slug).maybeSingle()

  return {
    /**
     * Is there an Office at this address? "Published and not deleted" is what the view
     * selects, so there is nothing to check beyond whether a row came back.
     */
    async isOfficePublished(slug) {
      const { data, error } = await rowAt(slug, "id")
      if (error) throw new Error(error.message)
      return data !== null
    },

    /**
     * The Layout Visitors of this Office are standing on, or null if no published Office
     * answers to the address. What comes back is whatever JSON is in the column — the
     * caller is the one that decides whether it is a Layout.
     */
    async publishedLayout(slug) {
      const { data, error } = await rowAt(slug, "published_layout")
      if (error) throw new Error(error.message)
      return data ? data.published_layout : null
    },
  }
}
