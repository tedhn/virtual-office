// The Layout schema, imported straight from TypeScript source the way the relay imports
// the geometry — Node strips the types at load, hence the explicit `.ts` extension. See
// ADR-0004.
import { validateLayout } from "../src/office/layoutSchema.ts"

/**
 * The relay's supply of Layouts: one per Office, fetched from the database and remembered
 * for a while.
 *
 * ADR-0002 puts chat isolation on the server's own reading of the Office's published
 * Layout, never on what a client says about itself. This is the part that supplies that
 * Layout, and the reason it is a module of its own: the relay should be a fan-out with a
 * privacy rule in it, not a thing that also knows about caches and database round trips.
 *
 * Three answers are possible and all three are different. A Layout means there is a
 * published Office at that address. `null` means there is not, and a Visitor is refused.
 * A rejection means we could not ask — which is not the same as no, so it is neither
 * cached nor turned into a refusal by this module.
 */

/**
 * How long a fetched Layout is believed. Publishing replaces the Layout privacy is
 * enforced against, so a cached copy has to expire — but publishing happens rarely and
 * messages arrive constantly, so the window is generous rather than tight.
 *
 * This is the whole of how stale enforcement can get, because nothing downstream keeps a
 * copy: the relay asks again for every message it judges. Which is also why the cache
 * matters — without it that would be a database round trip per chat line.
 *
 * Publishing now says so directly — `forget` below, reached from the publish endpoint —
 * which is what ADR-0002 asks for and is the usual way a Layout stops being current. This
 * clock is the backstop under it: a browser that published and then lost its network, or
 * a second server process that was not the one told, still stops believing an old Layout
 * within this window.
 */
const DEFAULT_TTL_MS = 30_000

/**
 * Cap on remembered Offices. An address nobody published still costs an entry, and
 * anybody can ask about any address, so the cache is not allowed to be a place a stranger
 * can put things indefinitely.
 */
const MAX_REMEMBERED = 256

export function officeLayouts({
  fetchLayout,
  ttlMs = DEFAULT_TTL_MS,
  now = Date.now,
  onInvalid = (slug, errors) =>
    console.error(`office "${slug}" has a published layout that is not a Layout:`, errors),
}) {
  /** slug -> { layout: Layout | null, at: number } */
  const remembered = new Map()
  /** slug -> Promise, so simultaneous arrivals at one Office share a single fetch. */
  const inFlight = new Map()

  async function load(slug) {
    const stored = await fetchLayout(slug)
    if (stored === null || stored === undefined) return null

    // A Layout the relay cannot read is a Layout it cannot enforce privacy against, so it
    // is treated as no Office rather than as an Office with unusual rectangles. The Owner
    // sees the same refusal in the browser, which validates the same document.
    const checked = validateLayout(stored)
    if (!checked.ok) {
      onInvalid(slug, checked.errors)
      return null
    }
    return checked.layout
  }

  /** Drop entries nobody would believe any more, so the map stays bounded. */
  function forgetStale() {
    const cutoff = now() - ttlMs
    for (const [slug, entry] of remembered) {
      if (entry.at <= cutoff) remembered.delete(slug)
    }
  }

  function remember(slug, layout) {
    if (remembered.size >= MAX_REMEMBERED) forgetStale()
    // Still full of entries that are all current: the newest arrival is the one worth
    // keeping, so make room by dropping the oldest (Map iterates in insertion order).
    if (remembered.size >= MAX_REMEMBERED) {
      const oldest = remembered.keys().next()
      if (!oldest.done) remembered.delete(oldest.value)
    }
    remembered.set(slug, { layout, at: now() })
  }

  return {
    /**
     * The published Layout of the Office at `slug`, or null if no published Office
     * answers to it. Rejects when the directory could not be reached at all.
     */
    layoutFor(slug) {
      const entry = remembered.get(slug)
      if (entry && now() - entry.at < ttlMs) return Promise.resolve(entry.layout)

      const pending = inFlight.get(slug)
      if (pending) return pending

      // `run` reads itself, so that a fetch can tell whether it is still the current one:
      // a `forget` between starting and finishing takes it out of the map, and its answer
      // predates whatever caused the forget. The caller waiting on it still gets it — it
      // is the best answer that existed when they asked — but it is not remembered as
      // current, and it does not evict the fetch that replaced it.
      let run
      run = load(slug)
        .then((layout) => {
          if (inFlight.get(slug) === run) remember(slug, layout)
          return layout
        })
        .finally(() => {
          if (inFlight.get(slug) === run) inFlight.delete(slug)
        })
      inFlight.set(slug, run)
      return run
    },

    /**
     * Drop what is remembered about an Office, so the next question about it is asked of
     * the database. Publishing calls this: the Owner's browser knows the Layout has
     * changed the moment it changes, which is a better signal than the clock above and
     * the one ADR-0002 asks for. Forgetting an Office nobody has asked about is a no-op,
     * so an address that was never cached costs nothing to be told about.
     */
    forget(slug) {
      remembered.delete(slug)
      // A fetch already running was started before whatever caused this, so it is no
      // longer the current one either. See `layoutFor`.
      inFlight.delete(slug)
    },

    /** How many Offices are currently remembered — so a test can prove the bound above. */
    size: () => remembered.size,
  }
}
