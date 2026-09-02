import "dotenv/config"
import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { ensureAnonymousSession, isAnonymous } from "@/auth/session"

/**
 * The Visitor half of ADR-0003, against a real Supabase: an identity appears without
 * anybody being asked for anything, and it is still the same identity after a refresh.
 *
 * "After a refresh" is modelled the way a browser does it — a second client reading the
 * session the first one stored — because that is the whole mechanism: the storage
 * outlives the page, and `ensureAnonymousSession` signs in only when it finds nothing.
 */
const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL
const anonKey = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const configured = Boolean(url && anonKey && serviceRoleKey)

if (!configured) {
  console.warn(
    "[anonymousVisitor] skipped: set SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY in .env",
  )
}

/** Stands in for the browser storage a session survives a page load in. */
function browserStorage() {
  const kept = new Map<string, string>()
  return {
    getItem: (key: string) => kept.get(key) ?? null,
    setItem: (key: string, value: string) => void kept.set(key, value),
    removeItem: (key: string) => void kept.delete(key),
  }
}

describe.skipIf(!configured)("an anonymous Visitor", () => {
  let admin: SupabaseClient
  const visitors: string[] = []

  /** A fresh page load sharing `storage` with any earlier one. */
  const pageLoad = (storage: ReturnType<typeof browserStorage>) =>
    createClient(url!, anonKey!, {
      auth: { persistSession: true, autoRefreshToken: false, storage },
    })

  beforeAll(() => {
    admin = createClient(url!, serviceRoleKey!, { auth: { persistSession: false } })
  })

  afterAll(async () => {
    for (const id of visitors) await admin?.auth.admin.deleteUser(id)
  })

  it("is signed in without being asked, and is the same person after a refresh", async () => {
    const storage = browserStorage()

    const first = await ensureAnonymousSession(pageLoad(storage).auth)
    visitors.push(first.user.id)
    expect(isAnonymous(first)).toBe(true)

    const afterRefresh = await ensureAnonymousSession(pageLoad(storage).auth)
    expect(afterRefresh.user.id).toBe(first.user.id)
  }, 20_000)

  it("is a different person in a different browser", async () => {
    const elsewhere = await ensureAnonymousSession(pageLoad(browserStorage()).auth)
    visitors.push(elsewhere.user.id)
    expect(elsewhere.user.id).not.toBe(visitors[0])
  }, 20_000)
})
