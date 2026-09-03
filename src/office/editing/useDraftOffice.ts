import type { Office } from "@/lib/offices"
import { readOwnOffice } from "@/lib/officeRows"
import { useSupabaseLookup, type Lookup } from "@/lib/useSupabaseLookup"
import type { Layout } from "../layout"
import { validateLayout } from "../layoutSchema"

/** An Office and the draft Layout to author, which is what the editor loads. */
export interface DraftOffice {
  office: Office
  draft: Layout
}

/**
 * The Office an Owner is about to author, with its draft Layout.
 *
 * `missing` is the answer both for an address no Office answers to and for somebody else's
 * Office — deliberately the same answer, because they are the same answer. The database
 * returns no row in either case (every policy on `offices` names the Owner, ADR-0005), so
 * there is no ownership check in this code to be wrong about, and none to bypass.
 */
export type DraftLookup = Lookup<DraftOffice>

/**
 * Load the Owner's own Office at `slug`, and the draft Layout to edit.
 *
 * The draft is checked on the way in rather than trusted, for the same reason the
 * published one is: it is a JSON document, and the editor indexes into rects. A draft is
 * allowed to be a useless Office — that is what a draft is for — but it is not allowed to
 * be something other than a Layout, and if the stored document has become one, saying so
 * beats dragging a rectangle that isn't there.
 *
 * `identity` is not used to decide anything; it is here so the lookup runs again when the
 * signed-in account changes. Opening the editor before the magic-link session has loaded
 * would otherwise answer "missing" and stay there.
 */
export function useDraftOffice(slug: string, identity: string | null): DraftLookup {
  return useSupabaseLookup<DraftOffice>(async (client) => {
    const office = await readOwnOffice(client, slug)
    if (!office) return null

    const draft = validateLayout(office.draft_layout)
    if (!draft.ok) {
      throw new Error(`This office's draft layout could not be read: ${draft.errors.join("; ")}`)
    }
    return { office, draft: draft.layout }
    // Keyed on both: a newline cannot appear in a slug, so the two halves can never run
    // together into a key that means something else.
  }, `${slug}\n${identity ?? ""}`)
}
