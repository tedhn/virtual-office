import { useCallback, useEffect, useState } from "react"
import { supabase } from "@/lib/supabase"
import {
  createAccount,
  ensureAnonymousSession,
  replacePassword,
  sendMagicLink,
  sendPasswordReset,
  signInWithPassword,
  type AuthSession,
} from "./session"

/**
 * Everything a screen needs from the signed-in identity: who they are, why they are
 * nobody if they are, how to insist on an identity before acting, and every way to trade
 * up to a real account.
 *
 * Named because these travel together everywhere they go — App hands the whole thing to
 * whichever screen the URL asks for, rather than a prop per method at every stop.
 */
export interface AuthGateway {
  /** The identity in the browser — anonymous for a Visitor, an account for an Owner. */
  session: AuthSession | null
  /** Why there is no identity, when there is none to be had. */
  error: string | null
  /**
   * Whether this session came from a reset link rather than from someone typing a
   * password. Such a person is signed in but has no password they know, so the only
   * thing to show them is a field to choose one.
   */
  recovering: boolean
  /** The identity to act as, waited for rather than assumed. */
  ensureIdentity: () => Promise<AuthSession | null>
  /** Email a magic link back to where the person is standing now. */
  requestMagicLink: (email: string) => Promise<void>
  /** Make a real account. Null means it exists but needs its address confirmed first. */
  createAccount: (email: string, password: string) => Promise<AuthSession | null>
  /** Return to an account that already exists, in one step. */
  signIn: (email: string, password: string) => Promise<void>
  /** Email a link back into an account whose password has been forgotten. */
  requestPasswordReset: (email: string) => Promise<void>
  /** Choose a new password for whoever is signed in — how a reset link ends. */
  replacePassword: (password: string) => Promise<void>
}

/**
 * The signed-in identity, for the UI.
 *
 * A Visitor is signed in anonymously as the app loads, without being asked and without a
 * screen of their own — the first thing they should see is the office, not a form. If
 * Supabase is not configured, this reports that and stops: the rest of the app still
 * runs, it just has no identity to hang an Office off.
 */
export function useAuthSession(): AuthGateway {
  const [session, setSession] = useState<AuthSession | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [recovering, setRecovering] = useState(false)

  useEffect(() => {
    let live = true
    let unsubscribe = () => {}

    try {
      const auth = supabase().auth
      const { data } = auth.onAuthStateChange((event, next) => {
        if (!live) return
        setSession(next)
        // Supabase reports a session minted by a reset link as its own event, and it is
        // the only way to tell one from an ordinary sign-in — the session looks the same.
        if (event === "PASSWORD_RECOVERY") setRecovering(true)
      })
      unsubscribe = () => data.subscription.unsubscribe()

      ensureAnonymousSession(auth)
        .then((next) => live && setSession(next))
        .catch((err: unknown) => live && setError(messageOf(err)))
    } catch (err) {
      setError(messageOf(err))
    }

    return () => {
      live = false
      unsubscribe()
    }
  }, [])

  /**
   * The identity to act as, waited for rather than assumed. Joining an Office a moment
   * after the page loads must still use the stored identity, or the same person gets a
   * different id every refresh. Null means there is no Supabase to have one with.
   */
  const ensureIdentity = useCallback(async (): Promise<AuthSession | null> => {
    try {
      const next = await ensureAnonymousSession(supabase().auth)
      setSession(next)
      return next
    } catch (err) {
      setError(messageOf(err))
      return null
    }
  }, [])

  /** Email a link back to where the visitor is standing now. */
  const requestMagicLink = useCallback(
    (email: string) => sendMagicLink(supabase().auth, email, window.location.href),
    [],
  )

  const create = useCallback(
    (email: string, password: string) =>
      createAccount(supabase().auth, email, password, window.location.href),
    [],
  )

  const signIn = useCallback(async (email: string, password: string) => {
    await signInWithPassword(supabase().auth, email, password)
  }, [])

  const requestPasswordReset = useCallback(
    (email: string) => sendPasswordReset(supabase().auth, email, window.location.href),
    [],
  )

  /** Once a new password is chosen, the session stops being a recovery and is just theirs. */
  const choosePassword = useCallback(async (password: string) => {
    await replacePassword(supabase().auth, password)
    setRecovering(false)
  }, [])

  return {
    session,
    error,
    recovering,
    ensureIdentity,
    requestMagicLink,
    createAccount: create,
    signIn,
    requestPasswordReset,
    replacePassword: choosePassword,
  }
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
