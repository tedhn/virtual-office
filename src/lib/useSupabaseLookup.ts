import { useEffect, useRef, useState } from "react"
import type { SupabaseClient } from "@supabase/supabase-js"
import { supabase } from "./supabase"

/**
 * What is at an address: the thing, nothing, or a database we could not ask.
 *
 * Three answers rather than two, because "there is no such Office" and "we could not find
 * out" are different things and telling them apart is the difference between a 404 and a
 * lie. A read that finds a row but cannot make sense of it belongs in `error` too — the
 * caller decides that by throwing.
 */
export type Lookup<T> =
  | { status: "loading" }
  | { status: "found"; value: T }
  | { status: "missing" }
  | { status: "error"; message: string }

/**
 * Read something out of Supabase, as a value a screen can render.
 *
 * The bookkeeping this exists to hold in one place: a request that is still in flight when
 * the screen moves on must not write its answer into a component that has gone, a client
 * that cannot be built at all (no project configured) is an error rather than a crash, and
 * `null` from the read means missing rather than broken.
 *
 * `key` says which thing is being looked up — a slug, or a slug and whose session is
 * asking. The read runs again when it changes and not otherwise, which is why `read`
 * itself is held in a ref: callers write it inline, so its identity changes every render
 * and depending on it would mean a request every render.
 */
export function useSupabaseLookup<T>(
  read: (client: SupabaseClient) => Promise<T | null>,
  key: string,
): Lookup<T> {
  const [lookup, setLookup] = useState<Lookup<T>>({ status: "loading" })
  const readRef = useRef(read)
  useEffect(() => {
    readRef.current = read
  })

  useEffect(() => {
    let live = true
    setLookup({ status: "loading" })

    const fail = (err: unknown) => {
      if (live) {
        setLookup({ status: "error", message: err instanceof Error ? err.message : String(err) })
      }
    }

    try {
      readRef.current(supabase())
        .then((value) => {
          if (!live) return
          setLookup(value === null ? { status: "missing" } : { status: "found", value })
        })
        .catch(fail)
    } catch (err) {
      // `supabase()` throws when the app has no project configured at all.
      fail(err)
    }

    return () => {
      live = false
    }
  }, [key])

  return lookup
}
