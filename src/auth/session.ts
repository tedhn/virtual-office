/**
 * The two ways into the product, as plain functions over an auth gateway.
 *
 * A Visitor is signed in anonymously the moment they load a page, without being asked;
 * an Owner signs in to a real account because an Office outlives the browser storage an
 * anonymous identity lives in (ADR-0003). Both paths exist at once, and a Visitor may
 * cross from one to the other, so neither is the "real" one.
 *
 * An Owner has two ways to reach their account: a password, which returns them to it in
 * one step, and a magic link, which needs no password to remember. Both end at the same
 * account for the same address — the password paths call the same Supabase user the link
 * paths do — so someone who signed up one way can come back the other way.
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
 * The parts of `supabase.auth` the password paths need. Separate from `VisitorAuth`
 * because entering an Office never touches these — only owning one does.
 */
export interface AccountAuth {
  signUp(credentials: {
    email: string
    password: string
    options?: { emailRedirectTo?: string }
  }): Promise<{
    data: { session: AuthSession | null }
    error: { message: string } | null
  }>
  signInWithPassword(credentials: { email: string; password: string }): Promise<{
    data: { session: AuthSession | null }
    error: { message: string } | null
  }>
  resetPasswordForEmail(
    email: string,
    options?: { redirectTo?: string },
  ): Promise<{ error: { message: string } | null }>
  updateUser(attributes: { password: string }): Promise<{ error: { message: string } | null }>
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
 * The shortest password the project accepts, mirroring `minimum_password_length` in
 * `supabase/config.toml`. Checked here as well so someone typing four characters is told
 * so as they type, rather than after a round trip.
 */
export const MIN_PASSWORD_LENGTH = 6

/** The address as the server will see it, or a refusal that costs no round trip. */
function addressOf(email: string): string {
  const address = email.trim().toLowerCase()
  if (!EMAIL.test(address)) throw new Error("Enter an email address")
  return address
}

/** The password as the server will see it, or a refusal that costs no round trip. */
function passwordOf(password: string): string {
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`Use at least ${MIN_PASSWORD_LENGTH} characters`)
  }
  return password
}

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
  const address = addressOf(email)

  const { error } = await auth.signInWithOtp({
    email: address,
    options: { emailRedirectTo: redirectTo, shouldCreateUser: true },
  })
  if (error) throw new Error(error.message)
}

/**
 * Make a real account from an address and a password.
 *
 * Returns the session when there is one, and null when the project asks for the address
 * to be confirmed first (`enable_confirmations` in `supabase/config.toml`) — in that case
 * nobody is signed in yet and a confirmation email is on its way, which is a different
 * thing to tell the person than "you're in". `redirectTo` is where that confirmation
 * lands them, so confirming doesn't lose their place.
 *
 * As with a magic link, the new session replaces whatever anonymous session was in the
 * browser; the anonymous Visitor's identity is not carried across (ADR-0003).
 */
export async function createAccount(
  auth: AccountAuth,
  email: string,
  password: string,
  redirectTo: string,
): Promise<AuthSession | null> {
  const address = addressOf(email)
  const secret = passwordOf(password)

  const { data, error } = await auth.signUp({
    email: address,
    password: secret,
    options: { emailRedirectTo: redirectTo },
  })
  if (error) throw new Error(error.message)
  return data.session
}

/**
 * Return an Owner to the account they already have, in one step and with no email.
 *
 * Supabase answers a wrong address and a wrong password identically ("Invalid login
 * credentials"), on purpose: telling them apart would say which addresses have accounts.
 * That message is passed through rather than reworded into a guess about which it was.
 */
export async function signInWithPassword(
  auth: AccountAuth,
  email: string,
  password: string,
): Promise<AuthSession> {
  const address = addressOf(email)
  if (!password) throw new Error("Enter your password")

  const { data, error } = await auth.signInWithPassword({ email: address, password })
  if (error) throw new Error(error.message)
  if (!data.session) throw new Error("Sign-in returned no session")
  return data.session
}

/**
 * Email someone a link back into their account so they can choose a new password, for the
 * case a password login otherwise dead-ends in: the password is forgotten.
 *
 * Opening that link signs them in with a session Supabase marks as a recovery, which is
 * what `replacePassword` then acts on. `redirectTo` is where the link lands them.
 */
export async function sendPasswordReset(
  auth: AccountAuth,
  email: string,
  redirectTo: string,
): Promise<void> {
  const address = addressOf(email)

  const { error } = await auth.resetPasswordForEmail(address, { redirectTo })
  if (error) throw new Error(error.message)
}

/**
 * Set the password of whoever is signed in, which is how a recovery link ends: the person
 * arrived holding a session they did not type a password for, and chooses one now.
 */
export async function replacePassword(auth: AccountAuth, password: string): Promise<void> {
  const secret = passwordOf(password)

  const { error } = await auth.updateUser({ password: secret })
  if (error) throw new Error(error.message)
}

/** Whether this session is an anonymous Visitor rather than an account that may own an Office. */
export function isAnonymous(session: AuthSession | null): boolean {
  return session?.user.is_anonymous === true
}
