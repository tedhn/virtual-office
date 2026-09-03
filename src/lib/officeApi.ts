import type { Layout } from "@/office/layout"
import { apiUrl } from "./api"
import type { Office } from "./offices"
import { supabase } from "./supabase"

/**
 * How the browser changes an Office: by asking the server to, never by writing the row.
 *
 * The anon key this app holds is public by design, so a rule the browser enforces on itself
 * is a rule anyone can decline to follow. `insert` and `update` on `offices` are revoked
 * from it entirely, and every write goes through the token server, which runs the same
 * Layout schema this app runs and holds a key that may actually write. See ADR-0011 and
 * `server/officeWrites.mjs`.
 *
 * Unlike `publishing.ts` next door, nothing here is a courtesy: these calls *are* the write.
 * A failure means the Office is unchanged, and the caller has something to tell the Owner.
 *
 * The rules themselves are not restated here. Whether a Layout is one, whether a name is a
 * name, which Layout a publish is held to — all of that lives in `lib/offices.ts`, where the
 * server runs it, and comes back as the message for this app to show. Checking it twice
 * would be two implementations of the same answer, and the one the browser reached would
 * be the one that does not count.
 */

/**
 * One write, with the caller's session on it.
 *
 * These routes are keyed on an Office's slug rather than its id, because the slug is the
 * thing a caller always has — it is what they navigated to — and the thing the address bar
 * already says.
 */
async function officeRequest(path: string, method: string, body?: unknown): Promise<Office> {
  const { data } = await supabase().auth.getSession()
  const token = data.session?.access_token
  // The routes answer 401 for this too. Saying it here spares a round trip and says
  // something the person can act on, rather than a status code.
  if (!token) throw new Error("Sign in to change an office")

  const res = await fetch(apiUrl(path), {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })

  const answer = (await res.json().catch(() => null)) as { office?: Office; error?: string } | null
  if (!res.ok) throw new Error(answer?.error ?? `That office could not be changed (${res.status})`)
  if (!answer?.office) throw new Error("The office server answered without an office")
  return answer.office
}

/**
 * Name an Office into existence. The Owner is whoever the request's session belongs to —
 * the server takes it from the token rather than from anything this app sends, so there is
 * no owner for a browser to name.
 */
export function createOffice(name: string): Promise<Office> {
  return officeRequest("/api/offices", "POST", { name })
}

/** Save the Owner's work in progress. A draft is free to be an Office nobody could use yet. */
export function saveDraft(slug: string, layout: Layout): Promise<Office> {
  return officeRequest(`/api/offices/${encodeURIComponent(slug)}/draft-layout`, "PUT", { layout })
}

/**
 * Publish: promote this Layout to the one Visitors enter and the relay enforces privacy
 * against. Telling the relay it has changed is a separate call — see `announcePublished`
 * in `publishing.ts` — because the Office is published the moment this returns.
 */
export function publishDraft(slug: string, layout: Layout): Promise<Office> {
  return officeRequest(
    `/api/offices/${encodeURIComponent(slug)}/published-layout`,
    "PUT",
    { layout },
  )
}

/** Rename an Office. Its address is permanent, so every link already shared still reaches it. */
export function renameOffice(slug: string, name: string): Promise<Office> {
  return officeRequest(`/api/offices/${encodeURIComponent(slug)}`, "PATCH", { name })
}

/**
 * Delete an Office. The row survives, marked — a removed row would release its slug to
 * whoever asked for it next — and every public surface stops showing it.
 */
export function deleteOffice(slug: string): Promise<Office> {
  return officeRequest(`/api/offices/${encodeURIComponent(slug)}`, "DELETE")
}
