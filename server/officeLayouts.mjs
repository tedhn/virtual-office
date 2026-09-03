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
 * A publish that told the relay directly would be better than a clock, and is what
 * ADR-0002 asks for. It needs a channel from the browser that publishes to whichever
 * server process is holding the socket, and there is no publishing UI to hang that off
 * yet; until there is, staleness is bounded by this instead.
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

      const run = load(slug)
        .then((layout) => {
          remember(slug, layout)
          return layout
        })
        .finally(() => inFlight.delete(slug))
      inFlight.set(slug, run)
      return run
    },

    /** How many Offices are currently remembered — so a test can prove the bound above. */
    size: () => remembered.size,
  }
}
