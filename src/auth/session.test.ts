import { describe, expect, it, vi } from "vitest"
import { ensureAnonymousSession, isAnonymous, sendMagicLink, type VisitorAuth } from "./session"

const session = (id: string, anonymous: boolean) => ({
  user: { id, is_anonymous: anonymous },
})

/** A stand-in for `supabase.auth`, remembering what it was asked to do. */
function fakeAuth(stored: ReturnType<typeof session> | null = null): VisitorAuth & {
  signInCount: () => number
} {
  let current = stored
  let signIns = 0
  return {
    getSession: async () => ({ data: { session: current } }),
    signInAnonymously: async () => {
      signIns++
      current = session(`anon-${signIns}`, true)
      return { data: { session: current }, error: null }
    },
    signInWithOtp: async () => ({ error: null }),
    signInCount: () => signIns,
  }
}

describe("Signing a Visitor in without asking", () => {
  it("signs a first-time Visitor in anonymously", async () => {
    const auth = fakeAuth()
    const result = await ensureAnonymousSession(auth)
    expect(result.user.id).toBe("anon-1")
    expect(auth.signInCount()).toBe(1)
  })

  it("reuses the stored session, so a Visitor is the same person after a refresh", async () => {
    const auth = fakeAuth(session("visitor-7", true))
    const result = await ensureAnonymousSession(auth)
    expect(result.user.id).toBe("visitor-7")
    expect(auth.signInCount()).toBe(0)
  })

  it("creates one identity when two callers ask at once", async () => {
    const auth = fakeAuth()
    const [a, b] = await Promise.all([ensureAnonymousSession(auth), ensureAnonymousSession(auth)])
    expect(a.user.id).toBe(b.user.id)
    expect(auth.signInCount()).toBe(1)
  })

  it("reports why anonymous sign-in failed", async () => {
    const auth: VisitorAuth = {
      getSession: async () => ({ data: { session: null } }),
      signInAnonymously: async () => ({
        data: { session: null },
        error: { message: "Anonymous sign-ins are disabled" },
      }),
      signInWithOtp: async () => ({ error: null }),
    }
    await expect(ensureAnonymousSession(auth)).rejects.toThrow("Anonymous sign-ins are disabled")
  })
})

describe("A magic link to a real account", () => {
  it("asks for a link back to where the creator started", async () => {
    const signInWithOtp = vi.fn(async () => ({ error: null }))
    const auth: VisitorAuth = {
      getSession: async () => ({ data: { session: null } }),
      signInAnonymously: async () => ({ data: { session: null }, error: null }),
      signInWithOtp,
    }
    await sendMagicLink(auth, " Creator@Example.com ", "http://localhost:5173/")
    expect(signInWithOtp).toHaveBeenCalledWith({
      email: "creator@example.com",
      options: { emailRedirectTo: "http://localhost:5173/", shouldCreateUser: true },
    })
  })

  it("refuses an address that is not one, without asking the server", async () => {
    const auth = fakeAuth()
    const signInWithOtp = vi.spyOn(auth, "signInWithOtp")
    await expect(sendMagicLink(auth, "not-an-email", "http://localhost:5173/")).rejects.toThrow(
      "Enter an email address",
    )
    expect(signInWithOtp).not.toHaveBeenCalled()
  })

  it("reports why the link could not be sent", async () => {
    const auth: VisitorAuth = {
      getSession: async () => ({ data: { session: null } }),
      signInAnonymously: async () => ({ data: { session: null }, error: null }),
      signInWithOtp: async () => ({ error: { message: "Email rate limit exceeded" } }),
    }
    await expect(sendMagicLink(auth, "creator@example.com", "http://x/")).rejects.toThrow(
      "Email rate limit exceeded",
    )
  })
})

describe("Telling a Visitor from an account", () => {
  it("tells a Visitor apart from an account that can own an Office", () => {
    expect(isAnonymous(session("a", true))).toBe(true)
    expect(isAnonymous(session("b", false))).toBe(false)
    expect(isAnonymous(null)).toBe(false)
  })
})
