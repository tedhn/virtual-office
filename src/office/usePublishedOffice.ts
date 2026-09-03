import { readPublishedOffice } from "@/lib/officeRows"
import type { PublishedOffice } from "@/lib/offices"
import { useSupabaseLookup, type Lookup } from "@/lib/useSupabaseLookup"
import { validateLayout } from "./layoutSchema"

/**
 * What is at an address: an Office, nothing, or a database we could not ask.
 *
 * `missing` is the answer for a slug nobody ever had, for one whose Office has never been
 * published, and for one whose Office has been deleted — deliberately the same answer to
 * all three, since the difference is nobody else's business.
 */
export type OfficeLookup = Lookup<PublishedOffice>

/**
 * Load the published Office at `slug`, if there is one.
 *
 * The Layout is checked on the way in rather than trusted. It is a JSON document written
 * by a client holding a public key, so "the database returned it" is not the same as "it
 * is a Layout" — and the renderer, which indexes into rects, is the wrong place to find
 * that out. A document that is not a Layout is thrown rather than returned, because to a
 * Visitor "this office would not open" is what it is: not a missing Office, and not one
 * they can do anything about.
 */
export function usePublishedOffice(slug: string): OfficeLookup {
  return useSupabaseLookup<PublishedOffice>(async (client) => {
    const office = await readPublishedOffice(client, slug)
    if (!office) return null

    const layout = validateLayout(office.published_layout)
    if (!layout.ok) {
      throw new Error(`This office's layout could not be read: ${layout.errors.join("; ")}`)
    }
    return { ...office, published_layout: layout.layout }
  }, slug)
}
