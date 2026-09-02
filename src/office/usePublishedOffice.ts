import { useEffect, useState } from "react"
import { readPublishedOffice } from "@/lib/officeRows"
import type { PublishedOffice } from "@/lib/offices"
import { supabase } from "@/lib/supabase"
import { validateLayout } from "./layoutSchema"

/**
 * What is at an address: an Office, nothing, or a database we could not ask.
 *
 * `missing` is the answer for a slug nobody ever had, for one whose Office has never been
 * published, and for one whose Office has been deleted — deliberately the same answer to
 * all three, since the difference is nobody else's business.
 */
export type OfficeLookup =
  | { status: "loading" }
  | { status: "found"; office: PublishedOffice }
  | { status: "missing" }
  | { status: "error"; message: string }

/**
 * Load the published Office at `slug`, if there is one.
 *
 * The Layout is checked on the way in rather than trusted. It is a JSON document written
 * by a client holding a public key, so "the database returned it" is not the same as "it
 * is a Layout" — and the renderer, which indexes into rects, is the wrong place to find
 * that out.
 */
export function usePublishedOffice(slug: string): OfficeLookup {
  const [lookup, setLookup] = useState<OfficeLookup>({ status: "loading" })

  useEffect(() => {
    let live = true
    setLookup({ status: "loading" })

    const fail = (err: unknown) => {
      if (live) setLookup({ status: "error", message: err instanceof Error ? err.message : String(err) })
    }

    try {
      readPublishedOffice(supabase(), slug)
        .then((office) => {
          if (!live) return
          if (!office) return setLookup({ status: "missing" })

          const layout = validateLayout(office.published_layout)
          if (!layout.ok) {
            return setLookup({
              status: "error",
              message: `This office's layout could not be read: ${layout.errors.join("; ")}`,
            })
          }
          setLookup({ status: "found", office: { ...office, published_layout: layout.layout } })
        })
        .catch(fail)
    } catch (err) {
      // `supabase()` throws when the app has no project configured at all.
      fail(err)
    }

    return () => {
      live = false
    }
  }, [slug])

  return lookup
}
