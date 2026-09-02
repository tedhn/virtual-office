import "dotenv/config"
import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { sendMagicLink } from "@/auth/session"
import { createOffice } from "@/lib/offices"
import { supabaseOfficeRows } from "@/lib/officeRows"
import { DEFAULT_LAYOUT } from "@/office/defaultLayout"

/**
 * Magic-link sign-in, end to end: the app asks for a link, an email actually arrives,
 * and using it produces a real account — the thing owning an Office requires (ADR-0003).
 *
 * Reading the email needs the mail catcher a local Supabase runs (Mailpit, :54324), so
 * this suite is local-only and skips when nothing answers there.
 */
const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL
const anonKey = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const inbox = process.env.SUPABASE_INBUCKET_URL ?? "http://127.0.0.1:54324"

const reachable = async (): Promise<boolean> => {
  if (!url || !anonKey || !serviceRoleKey) return false
  try {
    const res = await fetch(`${inbox}/api/v1/messages`, { signal: AbortSignal.timeout(2000) })
    return res.ok
  } catch {
    return false
  }
}

const runnable = await reachable()
if (!runnable) {
  console.warn(
    "[magicLink] skipped: needs a local Supabase with its mail catcher on :54324 (npm run db:start)",
  )
}

/**
 * The credential out of the email that actually arrived: the link's token where the
 * template sends a link, the six-digit code where it sends a code.
 */
async function magicLinkCredential(
  email: string,
): Promise<{ token_hash: string } | { code: string }> {
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

describe.skipIf(!runnable)("magic-link sign-in", () => {
  let admin: SupabaseClient
  let signingIn: SupabaseClient
  const email = `owner-to-be-${crypto.randomUUID().slice(0, 8)}@example.com`
  let userId: string | null = null

  beforeAll(() => {
    admin = createClient(url!, serviceRoleKey!, { auth: { persistSession: false } })
    signingIn = createClient(url!, anonKey!, { auth: { persistSession: false } })
  })

  afterAll(async () => {
    if (userId) await admin.auth.admin.deleteUser(userId)
  })

  it("emails a link that signs someone into a real account", async () => {
    await sendMagicLink(signingIn.auth, email, "http://127.0.0.1:5173/")

    const credential = await magicLinkCredential(email)
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
      layout: DEFAULT_LAYOUT,
    })
    expect(office.owner_id).toBe(userId)
  })
})
