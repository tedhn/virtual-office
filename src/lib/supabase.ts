import { createClient, type SupabaseClient } from "@supabase/supabase-js"

/**
 * The browser's Supabase client, created once and reused: every part of the app must
 * share one, or a Visitor ends up with one anonymous identity per client.
 *
 * The session is persisted and refreshed by the client itself, which is what makes an
 * anonymous Visitor the same person after a page refresh.
 */
let client: SupabaseClient | null = null

export function supabase(): SupabaseClient {
  if (client) return client

  // Supabase renamed the browser-safe key: `sb_publishable_…` is what used to be the
  // anon key. Both names are read, so a project from either side of the rename works.
  // Vite only exposes `VITE_`-prefixed vars to the bundle — a key pasted from the
  // dashboard's Next.js snippet as `NEXT_PUBLIC_…` never reaches this code.
  const url = import.meta.env.VITE_SUPABASE_URL
  const publishableKey =
    import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? import.meta.env.VITE_SUPABASE_ANON_KEY
  if (!url || !publishableKey) {
    throw new Error(
      "Supabase is not configured: set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY in .env",
    )
  }

  client = createClient(url, publishableKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  })
  return client
}
