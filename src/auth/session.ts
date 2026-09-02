/**
 * The two ways into the product, as plain functions over an auth gateway.
 *
 * A Visitor is signed in anonymously the moment they load a page, without being asked;
 * an Owner signs in with a magic link because an Office outlives the browser storage an
 * anonymous identity lives in (ADR-0003). Both paths exist at once, and a Visitor may
 * cross from one to the other, so neither is the "real" one.
 */

/** The parts of a session this app reads. `supabase.auth`'s Session satisfies it. */
export interface AuthSession {
  user: { id: string; is_anonymous?: boolean }
}

/** The parts of `supabase.auth` this module needs, so it can be faked in a test. */
export interface VisitorAuth {
  getSession(): Promise<{ data: { session: AuthSession | null } }>
  signInAnonymously(): Promise<{
    data: { session: AuthSession | null }
    error: { message: string } | null
  }>
  signInWithOtp(credentials: {
    email: string
    options?: { emailRedirectTo?: string; shouldCreateUser?: boolean }
  }): Promise<{ error: { message: string } | null }>
}

/**
 * In-flight sign-ins, one per gateway. Two callers arriving in the same tick — a React
 * effect running twice, a page mounting two trees — must end up as one Visitor, not two
 * anonymous accounts of which one is immediately orphaned.
 */
const pending = new WeakMap<VisitorAuth, Promise<AuthSession>>()

/**
 * The session a Visitor walks around with: whichever one is already stored, or a fresh
 * anonymous identity. Storing it is the gateway's job, which is what makes a Visitor the
 * same person after a refresh.
 */
export function ensureAnonymousSession(auth: VisitorAuth): Promise<AuthSession> {
  const inFlight = pending.get(auth)
  if (inFlight) return inFlight

  const run = (async () => {
    const existing = await auth.getSession()
    if (existing.data.session) return existing.data.session

    const { data, error } = await auth.signInAnonymously()
    if (error) throw new Error(error.message)
    if (!data.session) throw new Error("Anonymous sign-in returned no session")
    return data.session
  })().finally(() => pending.delete(auth))

  pending.set(auth, run)
  return run
}

/** Rough shape check only — the real proof an address exists is the link arriving. */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * Email someone a magic link to a real account, the thing owning an Office requires
 * (ADR-0003). `redirectTo` is where the link lands them — where they were standing when
 * they asked, so signing in doesn't lose their place.
 *
 * Opening the link produces a session for that account, replacing whatever anonymous
 * session was in the browser. Carrying an anonymous Visitor's identity *across* into
 * their new account is the transition ADR-0003 says to handle deliberately, and it needs
 * more than this: an anonymous session that could attach an address to itself without
 * anyone confirming the address could claim any address that has no account yet.
 */
export async function sendMagicLink(
  auth: VisitorAuth,
  email: string,
  redirectTo: string,
): Promise<void> {
  const address = email.trim().toLowerCase()
  if (!EMAIL.test(address)) throw new Error("Enter an email address")

  const { error } = await auth.signInWithOtp({
    email: address,
    options: { emailRedirectTo: redirectTo, shouldCreateUser: true },
  })
  if (error) throw new Error(error.message)
}

/** Whether this session is an anonymous Visitor rather than an account that may own an Office. */
export function isAnonymous(session: AuthSession | null): boolean {
  return session?.user.is_anonymous === true
}
