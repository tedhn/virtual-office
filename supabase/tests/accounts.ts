import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import { publishableKey, secretKey, supabaseUrl } from "./testEnv"

/**
 * The identities the database suites test with, and the clients that hold them.
 *
 * Shared because every suite that touches an Office needs the same three: a browser holding
 * the publishable key, an account that may own an Office, and an anonymous Visitor who may
 * not. `server/officeWrites.database.test.mjs` reaches for these too — the token server's
 * suite needs exactly the same cast, and a second copy of it drifts.
 *
 * Every account made here is a throwaway. Delete it in `afterAll`: `offices.owner_id`
 * cascades from `auth.users`, so removing the account removes the Offices it created.
 */

/** A signed-out browser: the publishable key and nothing else, exactly as the app starts. */
export const asAnon = (): SupabaseClient =>
  createClient(supabaseUrl!, publishableKey!, { auth: { persistSession: false } })

/**
 * The secret key, which bypasses row-level security. Suites hold it for two reasons and no
 * others: to make and unmake throwaway accounts, and to stand in for the token server, which
 * is the only thing that may write an Office any more (ADR-0011).
 */
export const asAdmin = (): SupabaseClient =>
  createClient(supabaseUrl!, secretKey!, { auth: { persistSession: false } })

/** A signed-in identity, and the access token its browser would put on a request. */
export interface TestIdentity {
  client: SupabaseClient
  id: string
  token: string
}

/**
 * A confirmed account, signed in — the "real, recoverable account" of ADR-0003. Created
 * through the admin API rather than by signing up, so the suites behave the same whether or
 * not the project asks for an address to be confirmed.
 */
export async function account(admin: SupabaseClient): Promise<TestIdentity> {
  const email = `${crypto.randomUUID()}@example.com`
  const password = crypto.randomUUID()
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true })
  if (created.error) throw new Error(created.error.message)

  const client = asAnon()
  const signedIn = await client.auth.signInWithPassword({ email, password })
  if (signedIn.error) throw new Error(signedIn.error.message)
  return { client, id: created.data.user.id, token: signedIn.data.session!.access_token }
}

/** An anonymous identity, the one a Visitor is given without being asked. */
export async function anonymousVisitor(): Promise<TestIdentity> {
  const client = asAnon()
  const { data, error } = await client.auth.signInAnonymously()
  if (error) {
    throw new Error(`anonymous sign-in failed (${error.message}) — enable it for this project`)
  }
  return { client, id: data.user!.id, token: data.session!.access_token }
}
