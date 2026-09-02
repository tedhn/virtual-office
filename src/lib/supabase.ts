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

  const url = import.meta.env.VITE_SUPABASE_URL
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY
  if (!url || !anonKey) {
    throw new Error(
      "Supabase is not configured: set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env",
    )
  }

  client = createClient(url, anonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  })
  return client
}
