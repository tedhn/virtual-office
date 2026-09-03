import { useCallback, useEffect, useState } from "react"
import { supabase } from "@/lib/supabase"
import { ensureAnonymousSession, sendMagicLink, type AuthSession } from "./session"

/**
 * Everything a screen needs from the signed-in identity: who they are, why they are
 * nobody if they are, how to insist on an identity before acting, and how to trade up to
 * a real account.
 *
 * Named because these four travel together everywhere they go — App hands the whole thing
 * to whichever screen the URL asks for, rather than four props at every stop.
 */
export interface AuthGateway {
  /** The identity in the browser — anonymous for a Visitor, an account for an Owner. */
  session: AuthSession | null
  /** Why there is no identity, when there is none to be had. */
  error: string | null
  /** The identity to act as, waited for rather than assumed. */
  ensureIdentity: () => Promise<AuthSession | null>
  /** Email a magic link back to where the person is standing now. */
  requestMagicLink: (email: string) => Promise<void>
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

  useEffect(() => {
    let live = true
    let unsubscribe = () => {}

    try {
      const auth = supabase().auth
      const { data } = auth.onAuthStateChange((_event, next) => {
        if (live) setSession(next)
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

  return { session, error, ensureIdentity, requestMagicLink }
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
