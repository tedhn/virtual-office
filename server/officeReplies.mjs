/**
 * The two things this server says when a request names an Office and it cannot hand one
 * over. Shared rather than written out per route, because they are one decision each and
 * two endpoints already have to agree on them.
 *
 * The distinction is the whole reason this file exists rather than a single `catch`: "no
 * Office answers to that address" and "we could not ask" are different answers, and a
 * caller told the first when the second is true has been lied to about something
 * permanent. Every route here fails closed on the second, and says 503 rather than 404.
 */

/**
 * No published Office answers to that address — it never existed, was never published, or
 * has been deleted. Deliberately one answer for all three: which it is, is nobody's
 * business but the Owner's.
 */
export function noSuchOffice(res) {
  return res.status(404).json({ error: "no office is published at that address" })
}

/**
 * The office directory could not be reached, so we do not know whether there is an Office
 * there. Not knowing is not the same answer as no, and 503 is the one a caller may retry.
 */
export function directoryUnreachable(res) {
  return res.status(503).json({ error: "could not reach the office directory" })
}
