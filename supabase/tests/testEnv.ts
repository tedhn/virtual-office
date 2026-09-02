import "dotenv/config"

/**
 * Which Supabase the database suites run against, and the keys to reach it with.
 *
 * Supabase renamed its API keys: the **publishable** key (`sb_publishable_…`) is the
 * browser-safe one that used to be called the anon key, and the **secret** key
 * (`sb_secret_…`) is the one that used to be called the service role key. Both namings
 * are accepted here, because a project created before the rename still shows the old
 * pair and a project created after shows the new one.
 *
 * The suites skip rather than fail when nothing is configured, so `npm test` still runs
 * on a machine with no database in reach.
 */
export const supabaseUrl =
  process.env.SUPABASE_URL ??
  process.env.VITE_SUPABASE_URL ??
  process.env.NEXT_PUBLIC_SUPABASE_URL

export const publishableKey =
  process.env.SUPABASE_PUBLISHABLE_KEY ??
  process.env.SUPABASE_ANON_KEY ??
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY ??
  process.env.VITE_SUPABASE_ANON_KEY

/**
 * The key that bypasses row-level security. Only the database suites ever hold it, and
 * only to create and delete the throwaway accounts they test the rules with.
 */
export const secretKey =
  process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY

export const configured = Boolean(supabaseUrl && publishableKey && secretKey)

/** What to tell someone whose suite just skipped. */
export const missingConfigWarning =
  "set SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY (or the VITE_ pair) and SUPABASE_SECRET_KEY in .env to run the database suites"
