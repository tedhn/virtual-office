import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { createAccount, sendPasswordReset, signInWithPassword } from "@/auth/session"
import { createOffice } from "@/lib/offices"
import { supabaseOfficeRows } from "@/lib/officeRows"
import { EXAMPLE_LAYOUT } from "@/office/exampleLayout"
import { configured, missingConfigWarning, publishableKey, secretKey, supabaseUrl } from "./testEnv"

/**
 * Password sign-in end to end: the half of an Owner's account that needs no email at all.
 *
 * This is the returning-Owner path, which the magic-link suite next door never covers —
 * every run there uses a fresh address, so it only ever exercises making an account.
 * An Office outlives one session (ADR-0003), so coming *back* to the account that owns it
 * is the path that gets walked repeatedly and the one worth pinning down.
 *
 * Whether making an account also signs you in depends on `enable_confirmations` in
 * `supabase/config.toml`, so the account under test is created and confirmed through the
 * admin API. That keeps the sign-in assertions the same against either setting, and
 * needs no email anybody has to read.
 */
if (!configured) console.warn(`[passwordAccount] skipped: ${missingConfigWarning}`)

/** Supabase's way of saying the mailer is out of quota, whichever wording it uses. */
const RATE_LIMITED = /rate limit|too many requests|over_email_send_rate_limit/i

describe.skipIf(!configured)("password sign-in", () => {
  let admin: SupabaseClient
  let signingIn: SupabaseClient
  const email = `owner-${crypto.randomUUID().slice(0, 8)}@example.com`
  const password = `pw-${crypto.randomUUID().slice(0, 12)}`
  const newcomer = `newcomer-${crypto.randomUUID().slice(0, 8)}@example.com`
  const ids: string[] = []
  let userId: string | null = null

  beforeAll(async () => {
    admin = createClient(supabaseUrl!, secretKey!, { auth: { persistSession: false } })
    signingIn = createClient(supabaseUrl!, publishableKey!, { auth: { persistSession: false } })

    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    })
    if (error) throw new Error(error.message)
    ids.push(data.user!.id)
  })

  afterAll(async () => {
    for (const id of ids) await admin.auth.admin.deleteUser(id)
  })

  it("returns an Owner to the account they already have", async () => {
    const session = await signInWithPassword(signingIn.auth, email, password)
    expect(session.user.is_anonymous ?? false).toBe(false)
    userId = session.user.id
    expect(userId).toBe(ids[0])
  })

  it("gives them an account that may own an Office", async () => {
    const office = await createOffice(supabaseOfficeRows(signingIn), {
      ownerId: userId!,
      slug: `password-${crypto.randomUUID().slice(0, 8)}`,
      name: "Password HQ",
      layout: EXAMPLE_LAYOUT,
    })
    expect(office.owner_id).toBe(userId)
  })

  it("refuses the wrong password without saying which half was wrong", async () => {
    await expect(signInWithPassword(signingIn.auth, email, `${password}-nope`)).rejects.toThrow(
      /invalid login credentials/i,
    )
  })

  /**
   * The other direction: an address nobody has used yet becomes an account. Whether a
   * session comes back depends on the project's confirmation setting, so both answers
   * are accepted — what matters is that the user now exists and can be signed in to.
   */
  it("makes a real account from an address and a password", async () => {
    const session = await createAccount(signingIn.auth, newcomer, password, "http://127.0.0.1:5173/")
    if (session) {
      expect(session.user.is_anonymous ?? false).toBe(false)
      ids.push(session.user.id)
      return
    }

    // Confirmations are on: nobody is signed in yet, so confirm as the admin would and
    // then check the password that was just chosen actually works.
    const { data } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 })
    const created = data.users.find((user) => user.email === newcomer)
    expect(created).toBeDefined()
    ids.push(created!.id)
    await admin.auth.admin.updateUserById(created!.id, { email_confirm: true })
    const after = await signInWithPassword(signingIn.auth, newcomer, password)
    expect(after.user.id).toBe(created!.id)
  }, 30_000)

  /**
   * Asking for a reset link is a real email, and a hosted project's built-in mailer is
   * rate-limited hard (a couple of messages an hour). The request is still made, because
   * that is the call the app makes; being turned away by the rate limiter is not a
   * failure of this suite.
   */
  it("asks for a link back in when the password is forgotten", async () => {
    try {
      await sendPasswordReset(signingIn.auth, email, "http://127.0.0.1:5173/")
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (!RATE_LIMITED.test(message)) throw err
      console.warn(`[passwordAccount] the project's mailer is rate-limited: ${message}`)
    }
  }, 30_000)
})
