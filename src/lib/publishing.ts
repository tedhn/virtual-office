import { apiUrl } from "./api"

/**
 * What an Owner's browser asks the token server when it publishes.
 *
 * Publishing itself is a write to the Office row and needs nothing from this module. What
 * the database cannot answer is anything about the Office as a live place: who is standing
 * in it at this moment, and how to reach them once the floor under them has changed. Both
 * are facts about the relay's sockets, so both are asked of the server holding them (see
 * `server/publishing.mjs`).
 *
 * Neither call is load-bearing for the publish. The Office is published the moment the row
 * is written; these surround that write with the courtesy of asking first and the courtesy
 * of telling afterwards, and a caller that cannot reach the server should carry on rather
 * than pretend the publish did not happen.
 */

/** Both endpoints answer with a count of Visitors in the Office, and nothing else. */
async function askAboutOffice(path: string, init?: RequestInit): Promise<number> {
  const res = await fetch(apiUrl(path), init)
  if (!res.ok) {
    const detail = await res.text().catch(() => "")
    throw new Error(`${path} failed (${res.status}): ${detail}`)
  }
  const body = (await res.json()) as { visitors?: number }
  return body.visitors ?? 0
}

/** How many Visitors are standing in this Office right now. */
export function visitorsInside(slug: string): Promise<number> {
  return askAboutOffice(`/api/offices/${encodeURIComponent(slug)}/visitors`)
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
