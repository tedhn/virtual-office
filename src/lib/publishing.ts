import { apiUrl } from "./api"

/**
 * What an Owner's browser asks the token server when it publishes or deletes an Office.
 *
 * Both of those are writes to the Office row and need nothing from this module. What the
 * database cannot answer is anything about the Office as a live place: who is standing in
 * it at this moment, how to reach them once the floor under them has changed, and how to
 * turn them out once the Office has stopped existing. All three are facts about the relay's
 * sockets, so all three are asked of the server holding them (see `server/publishing.mjs`).
 *
 * No call here is load-bearing for the write it follows. The Office is published, or
 * deleted, the moment the row is written; these surround that write with the courtesy of
 * asking first and the courtesy of telling afterwards, and a caller that cannot reach the
 * server should carry on rather than pretend the write did not happen.
 */

/**
 * Every endpoint here answers with a count of people in the Office — standing in it, or
 * just turned out of it — and nothing else.
 */
async function askAboutOffice(path: string, init?: RequestInit): Promise<number> {
  const res = await fetch(apiUrl(path), init)
  if (!res.ok) {
    const detail = await res.text().catch(() => "")
    throw new Error(`${path} failed (${res.status}): ${detail}`)
  }
  const body = (await res.json()) as { visitors?: number }
  return body.visitors ?? 0
}

/**
 * How many Visitors are standing in this Office right now, or null when the server could
 * not be asked.
 *
 * The three-valued answer is the point, and why not knowing is not an exception here: this
 * is asked before doing something to a room full of people, and both callers have to be
 * able to tell "nobody is in there" from "we could not find out". An unanswered question is
 * not a no.
 */
export async function visitorsInside(slug: string): Promise<number | null> {
  try {
    return await askAboutOffice(`/api/offices/${encodeURIComponent(slug)}/visitors`)
  } catch (err) {
    console.error(err)
    return null
  }
}

/**
 * Tell the server this Office has just been republished, so it stops enforcing privacy
 * against the Layout it read before and hands the new one to everyone standing inside.
 * Answers with how many Visitors it handed it to.
 *
 * Failing here does not un-publish anything. The server stops believing the old Layout
 * within half a minute either way, and the people inside are handed the current one the
 * next time their socket reconnects — so the cost of this call not landing is that they
 * go on seeing the old floorplan until then.
 */
export function announcePublished(slug: string): Promise<number> {
  return askAboutOffice(`/api/offices/${encodeURIComponent(slug)}/published`, { method: "POST" })
}

/**
 * Tell the server this Office has been deleted, so it stops enforcing a Layout it read
 * before and turns out anybody still standing inside. Answers with how many people it
 * disconnected.
 *
 * Failing here does not un-delete anything, and it does not leave the people inside there
 * for ever: the next thing anybody says in the Office turns everyone out of it, because the
 * relay asks the database in order to judge that message and is told there is no Office
 * (`server/relay.mjs`), and a socket that drops is refused when it tries to come back. What
 * this call buys is that they are told now rather than whenever one of those happens — and
 * a room where nobody speaks and nobody's connection blinks would otherwise go on looking
 * like an Office.
 *
 * The server checks the claim against the database before acting on it, so this is a
 * request and not an instruction — see ADR-0010.
 */
export function announceDeleted(slug: string): Promise<number> {
  return askAboutOffice(`/api/offices/${encodeURIComponent(slug)}/deleted`, { method: "POST" })
}
