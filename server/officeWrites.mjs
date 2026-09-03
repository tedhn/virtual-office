import { createClient } from "@supabase/supabase-js"
// The Office write rules, imported straight from TypeScript source the way the relay
// imports the geometry and the Layout cache imports the schema — Node strips the types at
// load, hence the explicit `.ts` extensions. See ADR-0004. This is the whole reason the
// writes moved here: one implementation of what a Layout is, running where it cannot be
// walked around.
import {
  createOfficeFromName,
  deleteOffice,
  publishDraft,
  renameOffice,
  saveDraft,
  OfficeInputError,
} from "../src/lib/offices.ts"
import { supabaseOfficeRows } from "../src/lib/officeRows.ts"
import { isSlug } from "../src/lib/slug.ts"
import { directoryUnreachable, noSuchOffice } from "./officeReplies.mjs"

/**
 * Every write to an Office, and the gate in front of them.
 *
 * The anon key is public by design, so anything the browser is allowed to write straight
 * to PostgREST is something anyone holding that key may write — including a Layout that is
 * well shaped and describes nothing, since the database's own checks stop at the shape of
 * the document (a second implementation of the Layout schema in SQL is the duplication
 * ADR-0004 exists to prevent). So `insert` and `update` on `public.offices` are revoked
 * from `anon` and `authenticated`, and this module is the only way in: it verifies who is
 * asking, refuses a write to an Office they do not own, runs the same `validateLayout` the
 * browser runs, and writes with the secret key. See ADR-0011.
 *
 * Reads are untouched. Row-level security still decides who sees which Office, and
 * `offices_public` is still the one surface a Visitor reads (ADR-0005) — nothing here
 * hands anything back that the caller could not already read as the Owner of the row.
 *
 * Takes its collaborators rather than reaching for them, so the gate can be tested without
 * a database or an auth server (`officeWrites.test.mjs`).
 */

/**
 * The key this server writes with, from the environment.
 *
 * Supabase renamed it: the **secret** key (`sb_secret_…`) is what used to be called the
 * service role key, and both names are read so a project from either side of the rename
 * works. It bypasses row-level security, which is the whole reason the routes below check
 * ownership themselves — and the reason it must never reach the browser bundle, so it
 * deliberately carries no `VITE_` fallback the way the publishable pair does.
 *
 * Returns null when nothing is configured, which the caller is expected to treat as fatal:
 * without it nobody can create an Office or save a Layout at all.
 */
export function supabaseSecret(env) {
  return env.SUPABASE_SECRET_KEY ?? env.SUPABASE_SERVICE_ROLE_KEY ?? null
}

/** Nobody is asking: there is no token to identify a caller by. */
function notSignedIn(res) {
  return res.status(401).json({ error: "sign in to change an office" })
}

/** An anonymous identity, which may visit an Office but never own one (ADR-0003). */
function accountRequired(res) {
  return res.status(403).json({ error: "creating an office needs a real account" })
}

/**
 * The auth server could not be reached, so we do not know who is asking. Not knowing is
 * not the same as nobody, for the reason `directoryUnreachable` exists beside it.
 */
function identityUnreachable(res) {
  return res.status(503).json({ error: "could not check who is signed in" })
}

/** The bearer token on this request, or null when there is not one to read. */
function bearerToken(req) {
  const header = req.headers?.authorization ?? ""
  const [scheme, token] = String(header).split(" ")
  return scheme?.toLowerCase() === "bearer" && token ? token : null
}

/**
 * Who this request is from, as Supabase's auth server answers it.
 *
 * The publishable key is enough: verifying a token is something the token's own holder
 * could do, and this asks nothing else of the project. Returns null for a token the auth
 * server does not accept, and throws when it could not be asked at all — a distinction the
 * routes turn into 401 against 503, because a caller told "sign in" when the truth is "we
 * could not check" has been told to fix something that is not broken.
 */
export function supabaseCallers({ url, key }) {
  const { auth } = createClient(url, key, { auth: { persistSession: false } })

  return async function callerOf(token) {
    const { data, error } = await auth.getUser(token)
    if (error) {
      // A 4xx is the auth server saying it does not accept this token. Anything else —
      // a 5xx, a timeout, a DNS failure — is the auth server not answering the question.
      if (error.status >= 400 && error.status < 500) return null
      throw new Error(error.message)
    }
    const user = data?.user
    return user ? { id: user.id, anonymous: user.is_anonymous === true } : null
  }
}

/**
 * The privileged half: the row writes themselves, and the ownership lookup they are gated
 * on. Both run with the secret key, which bypasses row-level security — which is why the
 * ownership check above them is the boundary and not a convenience.
 *
 * `supabaseOfficeRows` is the same adapter the browser used to write through, loaded from
 * source. Only the key it holds has changed.
 */
export function officeStore({ url, secretKey }) {
  const client = createClient(url, secretKey, { auth: { persistSession: false } })

  return {
    rows: supabaseOfficeRows(client),

    /**
     * The Office at this address and who owns it, or null when none does. A deleted Office
     * is none: its row survives to keep the slug spent, but there is nothing left to
     * author. Throws when the database could not be asked.
     */
    async officeAt(slug) {
      const { data, error } = await client
        .from("offices")
        .select("id, owner_id")
        .eq("slug", slug)
        .is("deleted_at", null)
        .maybeSingle()
      if (error) throw new Error(error.message)
      return data ?? null
    },
  }
}

/**
 * The five writes an Owner performs, as Express handlers.
 *
 * Four of them share a shape — find out who is asking, find the Office, refuse unless the
 * two match, write — so that shape is written once, in `ownedWrite`, and each of the four
 * is the one line that differs. Creating is the odd one out because there is no Office to
 * own yet; what it checks instead is that the caller has an account to own one with.
 */
export function officeWriteRoutes({ callerOf, officeAt, rows, now }) {
  /**
   * The caller, or null once the refusal has been sent. `anonymous` is passed through
   * rather than judged here: an anonymous Visitor may not create an Office, but they may
   * not own one either, so every other route refuses them by way of ownership.
   */
  async function caller(req, res) {
    const token = bearerToken(req)
    if (!token) {
      notSignedIn(res)
      return null
    }
    try {
      const who = await callerOf(token)
      if (who) return who
      notSignedIn(res)
      return null
    } catch (err) {
      console.error("identity lookup failed:", err)
      identityUnreachable(res)
      return null
    }
  }

  /**
   * The Office this request names, once the caller has been shown to own it — or null once
   * the refusal has been sent.
   *
   * A stranger's Office and an address no Office answers to get the same 404, deliberately:
   * telling them apart would let anyone holding the anon key enumerate which addresses are
   * taken by whom, which is nobody's business but the Owner's (CONTEXT.md, Office).
   */
  async function ownedOffice(req, res, who) {
    const slug = String(req.params?.slug ?? "")
    // Not slug-shaped means no Office can ever have answered to it, so nothing is looked up.
    if (!isSlug(slug)) {
      noSuchOffice(res)
      return null
    }

    let office
    try {
      office = await officeAt(slug)
    } catch (err) {
      console.error(`office lookup failed for "${slug}":`, err)
      directoryUnreachable(res)
      return null
    }

    if (!office || office.owner_id !== who.id) {
      noSuchOffice(res)
      return null
    }
    return office
  }

  /**
   * Perform a write, and answer with the row or with the reason there is not one.
   *
   * Three outcomes, told apart by type rather than by reading a message. An
   * `OfficeInputError` is the caller's Layout or name being wrong, and its message was
   * written to be shown to them — that is the one the editor puts on screen. Anything else
   * is ours: a database that refused, or a bug in this process, neither of which the caller
   * can act on and neither of which should be quoted back to them as though their Layout
   * were at fault.
   */
  async function write(res, run) {
    try {
      return res.json({ office: await run() })
    } catch (err) {
      if (err instanceof OfficeInputError) return res.status(400).json({ error: err.message })
      console.error("office write failed:", err)
      return res.status(500).json({ error: "that office could not be written" })
    }
  }

  /**
   * A write to an Office the caller owns: everything that has to happen before the write,
   * done once, with `run` as the write itself.
   *
   * `run` is called inside `write`'s `try`, so anything it refuses — including the body
   * checks below it — comes back as one answer rather than as a route that returns having
   * sent nothing.
   */
  function ownedWrite(run) {
    return async function handleOwnedWrite(req, res) {
      const who = await caller(req, res)
      if (!who) return
      const office = await ownedOffice(req, res, who)
      if (!office) return
      return write(res, () => run(office, req))
    }
  }

  /**
   * The Layout in this request's body. Absent is refused; every other value is handed
   * on to the schema, which is the thing that knows what a Layout is — a body of `0` or
   * `false` is not a missing Layout, it is a bad one, and saying so is `validateLayout`'s
   * job rather than this line's.
   */
  function layoutIn(req) {
    const layout = req.body?.layout
    if (layout === undefined) throw new OfficeInputError("layout: expected a Layout to write")
    return layout
  }

  /** The name in this request's body, as a string. Empty is the shared rules' to refuse. */
  const nameIn = (req) => String(req.body?.name ?? "")

  return {
    /**
     * Name an Office into existence. The Owner is the account the token names and nothing
     * else in the request is consulted for it, so there is no owner to forge.
     */
    async create(req, res) {
      const who = await caller(req, res)
      if (!who) return
      // ADR-0003: an anonymous identity lives in browser storage, and an Office whose Owner
      // cleared their storage is orphaned. The database used to say this in a policy; with
      // insert revoked from `authenticated` that policy is unreachable, so it is said here.
      if (who.anonymous) return accountRequired(res)

      return write(res, () => createOfficeFromName(rows, { ownerId: who.id, name: nameIn(req) }))
    },

    /** Save the Owner's work in progress. Held only to being a Layout. */
    saveDraft: ownedWrite((office, req) => saveDraft(rows, office.id, layoutIn(req))),

    /** Promote a Layout to the one Visitors enter, held to describing an Office that works. */
    publish: ownedWrite((office, req) => publishDraft(rows, office.id, layoutIn(req))),

    /** Change what an Office is called. Its address is permanent and is not touched. */
    rename: ownedWrite((office, req) => renameOffice(rows, office.id, nameIn(req))),

    /** Delete an Office: mark the row, and leave it there so its slug stays spent. */
    remove: ownedWrite((office) => deleteOffice(rows, office.id, now)),
  }
}
