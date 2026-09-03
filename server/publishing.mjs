// The slug shape, imported straight from TypeScript source the way the token route
// imports it — Node strips the types at load, hence the explicit `.ts` extension. See
// ADR-0004.
import { directoryUnreachable, noSuchOffice } from "./officeReplies.mjs"
import { isSlug } from "../src/lib/slug.ts"

/**
 * The two things a publishing Owner's browser asks this server.
 *
 * Publishing itself is a database write and happens without this server's help. What it
 * cannot do from the browser is see the Office's live sockets: who is standing in it right
 * now, and how to reach them with the Layout they are now standing on. Both are questions
 * about the relay, which is why they are answered here rather than in Supabase.
 *
 * Neither route is an identity check, and neither pretends to be. `POST .../published` is
 * a nudge, not a write: it tells the server to stop believing a Layout it read earlier and
 * to read the Office's published Layout again — the same one `offices_public` hands to
 * anyone with the link. A stranger calling it repeatedly costs one small read of a public
 * view per call, which is strictly less than the token endpoint that sits beside it
 * already costs, and it cannot make the server say anything the database did not.
 * Verifying the caller's session is worth doing, as identity work across every endpoint at
 * once (ADR-0006), not as a gate bolted onto this one.
 */

/**
 * The Office this request names, or null once the refusal has been sent. Not slug-shaped
 * means no Office can ever have answered to it, so nothing is looked up.
 */
function officeSlug(req, res) {
  const slug = String(req.params.slug ?? "")
  if (isSlug(slug)) return slug
  noSuchOffice(res)
  return null
}

/**
 * How many Visitors are standing in an Office. The Owner is shown this before they
 * publish, because publishing moves the floor under everybody on it and that is worth
 * being asked about first.
 *
 * It tells a caller nothing they could not already have: a published Office's link is
 * public, anyone holding it may walk in (ADR-0006), and the roster inside names everybody.
 */
export function visitorCountRoute({ visitorCount }) {
  return function handleVisitorCount(req, res) {
    const slug = officeSlug(req, res)
    if (slug === null) return
    return res.json({ visitors: visitorCount(slug) })
  }
}

/**
 * An Office has just been republished: forget the Layout read before it, and hand the new
 * one to everyone standing in the Office so nobody is left walking around a floorplan that
 * no longer exists.
 *
 * The order matters. Forgetting comes first and happens whatever else does, because a
 * Layout known to be superseded must not go on being enforced — even if the Layout that
 * replaced it cannot be read. Reading comes second, and only when there is somebody to
 * tell: an empty Office has no one to hand a Layout to, and the next person through the
 * door reads it for themselves.
 */
export function republishedRoute({ visitorCount, forget, layoutFor, announceLayout }) {
  return async function handleRepublished(req, res) {
    const slug = officeSlug(req, res)
    if (slug === null) return

    forget(slug)

    const visitors = visitorCount(slug)
    if (visitors === 0) return res.json({ visitors })

    let layout
    try {
      layout = await layoutFor(slug)
    } catch (err) {
      console.error(`republish lookup failed for "${slug}":`, err)
      // The people inside keep the Layout they have until the relay can read the new one.
      return directoryUnreachable(res)
    }

    // Published and then immediately unpublished, or deleted. There is no Layout to hand
    // out; the relay refuses these sockets' next chat on its own, and their next reconnect
    // is turned away at the door.
    if (!layout) return noSuchOffice(res)

    announceLayout(slug, layout)
    return res.json({ visitors })
  }
}
