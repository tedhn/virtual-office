import { describe, expect, it, vi } from "vitest"
import {
  createAccount,
  ensureAnonymousSession,
  isAnonymous,
  MIN_PASSWORD_LENGTH,
  replacePassword,
  sendMagicLink,
  sendPasswordReset,
  signInWithPassword,
  type AccountAuth,
  type VisitorAuth,
} from "./session"

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

/** A stand-in for the password half of `supabase.auth`, remembering what it was asked. */
function fakeAccount(overrides: Partial<AccountAuth> = {}): AccountAuth {
  return {
    signUp: async () => ({ data: { session: session("owner-1", false) }, error: null }),
    signInWithPassword: async () => ({
      data: { session: session("owner-1", false) },
      error: null,
    }),
    resetPasswordForEmail: async () => ({ error: null }),
    updateUser: async () => ({ error: null }),
    ...overrides,
  }
}

describe("An account reached with a password", () => {
  it("makes an account from a normalised address", async () => {
    const signUp = vi.fn(async () => ({
      data: { session: session("owner-1", false) },
      error: null,
    }))
    const result = await createAccount(
      fakeAccount({ signUp }),
      " Creator@Example.com ",
      "hunter2!",
      "http://localhost:5173/",
    )
    expect(signUp).toHaveBeenCalledWith({
      email: "creator@example.com",
      password: "hunter2!",
      options: { emailRedirectTo: "http://localhost:5173/" },
    })
    expect(result?.user.id).toBe("owner-1")
  })

  it("reports no session when the address has to be confirmed first", async () => {
    const auth = fakeAccount({ signUp: async () => ({ data: { session: null }, error: null }) })
    await expect(
      createAccount(auth, "creator@example.com", "hunter2!", "http://x/"),
    ).resolves.toBeNull()
  })

  it("refuses a password too short for the project, without asking the server", async () => {
    const signUp = vi.fn(async () => ({ data: { session: null }, error: null }))
    await expect(
      createAccount(fakeAccount({ signUp }), "creator@example.com", "abc", "http://x/"),
    ).rejects.toThrow(`Use at least ${MIN_PASSWORD_LENGTH} characters`)
    expect(signUp).not.toHaveBeenCalled()
  })

  it("returns an Owner to the account they already have", async () => {
    const signIn = vi.fn(async () => ({
      data: { session: session("owner-9", false) },
      error: null,
    }))
    const result = await signInWithPassword(
      fakeAccount({ signInWithPassword: signIn }),
      " Owner@Example.com ",
      "hunter2!",
    )
    expect(signIn).toHaveBeenCalledWith({ email: "owner@example.com", password: "hunter2!" })
    expect(result.user.id).toBe("owner-9")
    expect(isAnonymous(result)).toBe(false)
  })

  it("passes Supabase's refusal through rather than guessing which half was wrong", async () => {
    const auth = fakeAccount({
      signInWithPassword: async () => ({
        data: { session: null },
        error: { message: "Invalid login credentials" },
      }),
    })
    await expect(signInWithPassword(auth, "owner@example.com", "nope")).rejects.toThrow(
      "Invalid login credentials",
    )
  })

  it("does not ask the server about an empty password", async () => {
    const signIn = vi.fn(async () => ({ data: { session: null }, error: null }))
    await expect(
      signInWithPassword(fakeAccount({ signInWithPassword: signIn }), "owner@example.com", ""),
    ).rejects.toThrow("Enter your password")
    expect(signIn).not.toHaveBeenCalled()
  })
})

describe("Getting back in without the password", () => {
  it("asks for a reset link back to where the Owner started", async () => {
    const resetPasswordForEmail = vi.fn(async () => ({ error: null }))
    await sendPasswordReset(
      fakeAccount({ resetPasswordForEmail }),
      " Owner@Example.com ",
      "http://localhost:5173/",
    )
    expect(resetPasswordForEmail).toHaveBeenCalledWith("owner@example.com", {
      redirectTo: "http://localhost:5173/",
    })
  })

  it("reports why the reset link could not be sent", async () => {
    const auth = fakeAccount({
      resetPasswordForEmail: async () => ({ error: { message: "Email rate limit exceeded" } }),
    })
    await expect(sendPasswordReset(auth, "owner@example.com", "http://x/")).rejects.toThrow(
      "Email rate limit exceeded",
    )
  })

  it("sets the new password of whoever the link signed in", async () => {
    const updateUser = vi.fn(async () => ({ error: null }))
    await replacePassword(fakeAccount({ updateUser }), "a-longer-secret")
    expect(updateUser).toHaveBeenCalledWith({ password: "a-longer-secret" })
  })

  it("refuses a new password too short for the project", async () => {
    const updateUser = vi.fn(async () => ({ error: null }))
    await expect(replacePassword(fakeAccount({ updateUser }), "abc")).rejects.toThrow(
      `Use at least ${MIN_PASSWORD_LENGTH} characters`,
    )
    expect(updateUser).not.toHaveBeenCalled()
  })
})
