import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { sendMagicLink } from "@/auth/session"
import { createOffice } from "@/lib/offices"
import { supabaseOfficeRows } from "@/lib/officeRows"
import { EXAMPLE_LAYOUT } from "@/office/exampleLayout"
import { configured, missingConfigWarning, publishableKey, secretKey, supabaseUrl } from "./testEnv"

/**
 * Magic-link sign-in end to end: the app asks for a link, and the credential in that
 * link produces a real account — the thing owning an Office requires (ADR-0003).
 *
 * Where the credential is read from depends on which Supabase this is pointed at. A
 * local stack catches its own mail (Mailpit, :54324), so the whole path is exercised,
 * the delivered email included. A hosted project sends real email nobody here can read,
 * so the link is minted through the admin API instead — the same token the email would
 * have carried, without a message anyone has to open.
 *
 * Hosted projects also rate-limit their built-in mailer hard (a couple of messages an
 * hour on the free tier). The request to send is still made, because that is the call
 * the app makes; being turned away by the rate limiter is not a failure of this suite.
 */
const inbox = process.env.SUPABASE_INBUCKET_URL ?? "http://127.0.0.1:54324"
if (!configured) console.warn(`[magicLink] skipped: ${missingConfigWarning}`)

/** Whether a mail catcher is answering, i.e. whether the delivered email is readable. */
async function mailCatcherAnswers(): Promise<boolean> {
  if (!configured) return false
  try {
    const res = await fetch(`${inbox}/api/v1/messages`, { signal: AbortSignal.timeout(2000) })
    return res.ok
  } catch {
    return false
  }
}

const readsMail = await mailCatcherAnswers()

/** Supabase's way of saying the mailer is out of quota, whichever wording it uses. */
const RATE_LIMITED = /rate limit|too many requests|over_email_send_rate_limit/i

/**
 * The credential out of the email that arrived: the link's token where the template
 * sends a link, the six-digit code where it sends a code.
 */
async function credentialFromMail(email: string): Promise<{ token_hash: string } | { code: string }> {
  for (let attempt = 0; attempt < 40; attempt++) {
    const list = await fetch(`${inbox}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`)
    const { messages } = (await list.json()) as { messages?: { ID: string }[] }
    if (messages?.length) {
      const body = await fetch(`${inbox}/api/v1/message/${messages[0].ID}`)
      const { Text, HTML } = (await body.json()) as { Text?: string; HTML?: string }
      const email_body = `${Text ?? ""}\n${HTML ?? ""}`
      const linked = /[?&]token=([A-Za-z0-9_-]+)/.exec(email_body)
      if (linked) return { token_hash: linked[1] }
      const code = /\b(\d{6})\b/.exec(email_body)
      if (code) return { code: code[1] }
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(`no magic-link email arrived for ${email}`)
}

/** The same credential, minted directly, for a project whose mail nobody here can read. */
async function credentialFromAdmin(
  admin: SupabaseClient,
  email: string,
): Promise<{ token_hash: string }> {
  const { data, error } = await admin.auth.admin.generateLink({ type: "magiclink", email })
  if (error) throw new Error(error.message)
  return { token_hash: data.properties.hashed_token }
}

describe.skipIf(!configured)("magic-link sign-in", () => {
  let admin: SupabaseClient
  let signingIn: SupabaseClient
  const email = `owner-to-be-${crypto.randomUUID().slice(0, 8)}@example.com`
  let userId: string | null = null

  beforeAll(() => {
    admin = createClient(supabaseUrl!, secretKey!, { auth: { persistSession: false } })
    signingIn = createClient(supabaseUrl!, publishableKey!, { auth: { persistSession: false } })
  })

  afterAll(async () => {
    if (userId) await admin.auth.admin.deleteUser(userId)
  })

  it("turns a link request into a real account", async () => {
    try {
      await sendMagicLink(signingIn.auth, email, "http://127.0.0.1:5173/")
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (!RATE_LIMITED.test(message)) throw err
      console.warn(`[magicLink] the project's mailer is rate-limited: ${message}`)
    }

    const credential = readsMail
      ? await credentialFromMail(email)
      : await credentialFromAdmin(admin, email)

    const { data, error } =
      "token_hash" in credential
        ? await signingIn.auth.verifyOtp({ token_hash: credential.token_hash, type: "email" })
        : await signingIn.auth.verifyOtp({ email, token: credential.code, type: "email" })
    expect(error).toBeNull()
    expect(data.session).not.toBeNull()
    expect(data.user?.email).toBe(email)
    expect(data.user?.is_anonymous ?? false).toBe(false)
    userId = data.user!.id
  }, 30_000)

  it("gives them an account that may own an Office", async () => {
    const office = await createOffice(supabaseOfficeRows(signingIn), {
      ownerId: userId!,
      slug: `magic-${crypto.randomUUID().slice(0, 8)}`,
      name: "Magic HQ",
      layout: EXAMPLE_LAYOUT,
    })
    expect(office.owner_id).toBe(userId)
  })
})
