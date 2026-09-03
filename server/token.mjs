// The slug shape, imported straight from TypeScript source the way the relay imports the
// geometry — Node strips the types at load, hence the explicit `.ts` extension. See
// ADR-0004. One implementation of "what an Office's address looks like" for the client,
// the server and (spelled out separately, because it cannot be shared) the database.
import { directoryUnreachable, noSuchOffice } from "./officeReplies.mjs"
import { isSlug } from "../src/lib/slug.ts"

/**
 * The Stream token endpoint, and the gate in front of it.
 *
 * A token is what lets a browser join a call and start costing money, so it is minted
 * only for someone walking into an Office that actually exists and is published. Before
 * Offices were user-created this endpoint minted for any user id posted to it, which
 * with a public sign-up is an open door to the Stream bill.
 *
 * What the gate is not: it is not an identity check. Anyone can ask for a token as any
 * user id, exactly as they could before — a published Office's link is public by design,
 * and anyone holding it is entitled to walk in. What the gate stops is minting against
 * Offices that do not exist at all. See ADR-0006.
 *
 * Takes its collaborators rather than reaching for them, so the rules above can be tested
 * without a Stream account or a database (`token.test.mjs`).
 */
export function tokenRoute({ apiKey, mintToken, isOfficePublished }) {
  return async function handleToken(req, res) {
    const { userId, office } = req.body ?? {}

    if (!userId || typeof userId !== "string") {
      return res.status(400).json({ error: "userId is required" })
    }
    if (!office || typeof office !== "string") {
      return res.status(400).json({ error: "office is required" })
    }
    // A slug-shaped address is the only kind an Office can have, so anything else is
    // answered here rather than sent to the database to be told the same thing.
    if (!isSlug(office)) return noSuchOffice(res)

    let published
    try {
      published = await isOfficePublished(office)
    } catch (err) {
      console.error("office lookup failed:", err)
      // Not 404: we do not know that there is no such Office, only that we cannot ask.
      return directoryUnreachable(res)
    }

    if (!published) return noSuchOffice(res)

    try {
      return res.json({ apiKey, token: mintToken(userId) })
    } catch (err) {
      console.error("token error:", err)
      return res.status(500).json({ error: "failed to generate token" })
    }
  }
}
