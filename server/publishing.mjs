// The slug shape, imported straight from TypeScript source the way the token route
// imports it — Node strips the types at load, hence the explicit `.ts` extension. See
// ADR-0004.
import { directoryUnreachable, noSuchOffice, officeStillPublished } from "./officeReplies.mjs"
import { isSlug } from "../src/lib/slug.ts"

/**
 * What an Owner's browser asks this server when it changes an Office.
 *
 * Publishing and deleting are database writes and happen without this server's help. What
 * they cannot do from the browser is reach the Office's live sockets: who is standing in it
 * right now, how to hand them the Layout they are now standing on, and how to turn them out
 * of an Office that has stopped existing. All three are questions about the relay, which is
 * why they are answered here rather than in Supabase.
 *
 * No route here is an identity check, and none pretends to be. `POST .../published` and
 * `POST .../deleted` are nudges, not writes: they tell the server to stop believing a Layout
 * it read earlier and to read the Office's published Layout again — the same one
 * `offices_public` hands to anyone with the link. A stranger calling them repeatedly costs
 * one small read of a public view per call, which is strictly less than the token endpoint
 * that sits beside them already costs, and neither can make the server say anything the
 * database did not. What each one then does follows from that reread and not from what the
 * caller claimed, which is why asserting an Office has been deleted cannot empty one that
 * has not been (ADR-0010). Verifying the caller's session is worth doing, as identity work
 * across every endpoint at once (ADR-0006), not as a gate bolted onto these.
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

/**
 * An Office has just been deleted: forget the Layout read before it, and turn out everyone
 * still standing inside, since the place they are standing in no longer exists.
 *
 * The Owner's delete is a database write, and no database write can reach a WebSocket —
 * so without this, the people inside would go on walking around an Office nobody can
 * reach, until their next reconnect turned them away at the door. Their chat already stops
 * (the relay fails closed on an Office with no Layout), which is a silence nobody has been
 * given a reason for.
 *
 * Whether the Office is really gone is the database's to say, not the caller's. This route
 * rereads it and closes sockets only when the answer is that no published Office answers
 * to the address — which is what makes it safe for anyone to call, exactly like the
 * republish nudge beside it: a stranger asserting an Office has been deleted gets told it
 * has not, and everyone inside stays where they are. Anything less certain — a directory
 * that cannot be reached — leaves them standing too.
 *
 * Forgetting comes first and happens either way, for the reason it does in `republished`:
 * a Layout that may have been superseded must not go on being enforced.
 */
export function deletedRoute({ forget, layoutFor, closeOffice }) {
  return async function handleDeleted(req, res) {
    const slug = officeSlug(req, res)
    if (slug === null) return

    forget(slug)

    let layout
    try {
      layout = await layoutFor(slug)
    } catch (err) {
      console.error(`delete lookup failed for "${slug}":`, err)
      // The people inside stay where they are: not being able to ask is not being told no.
      return directoryUnreachable(res)
    }

    if (layout) return officeStillPublished(res)

    // How many people were turned out — the same shape of answer the other two routes give.
    return res.json({ visitors: closeOffice(slug) })
  }
}
