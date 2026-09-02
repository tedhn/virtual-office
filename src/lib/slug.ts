// This module is loaded from TypeScript source by the token server, which needs to
// recognise an Office's address (`server/token.mjs`). It therefore lives under ADR-0004's
// rules: no third-party imports, no DOM types, and any relative import must carry an
// explicit `.ts` extension. That is why inventing a slug — which needs a random source —
// lives in `randomTail.ts` instead: the server only ever recognises slugs, never makes one.

/**
 * Slugs: the short, human-readable name an Office is addressed by.
 *
 * A slug is permanent and never reassigned (CONTEXT.md, Slug), so the only moment it is
 * chosen is when an Office is created — and the choice has to succeed without asking the
 * creator to think about URLs. These functions turn a name into the slug it asks for,
 * and into the alternatives to try when that one is already someone else's.
 *
 * The shape is spelled out in three places on purpose: here, so a creator hears about it
 * before a request is issued; in the `offices` table, which is the only one that cannot
 * be bypassed; and in `routes.ts`, which has to tell an Office's URL from any other.
 */

export const SLUG_MIN_LENGTH = 3
export const SLUG_MAX_LENGTH = 63

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/

/**
 * Addresses the server already answers to. An Office is reached at the root of the site,
 * so a slug that collides with one of these names an Office nobody could ever open — and
 * a slug is permanent, which makes that mistake permanent too.
 */
const RESERVED = new Set(["api", "ws", "assets"])

/** Whether an Office could be reached at this address. */
export function isSlug(value: string): boolean {
  return (
    value.length >= SLUG_MIN_LENGTH &&
    value.length <= SLUG_MAX_LENGTH &&
    SLUG.test(value) &&
    !RESERVED.has(value)
  )
}

/** What a name with nothing slug-shaped in it — punctuation, emoji, another script — becomes. */
const FALLBACK = "office"

/** Combining marks left behind by NFKD, so an accented letter slugs as the letter it is. */
const COMBINING = /[\u0300-\u036f]/g

function stem(name: string): string {
  return name
    .normalize("NFKD")
    .replace(COMBINING, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

/** Cut to `max` characters without leaving the trailing hyphen a cut mid-word can produce. */
function clip(value: string, max: number): string {
  return value.slice(0, max).replace(/-+$/, "")
}

/**
 * The slug `name` asks for, optionally with `tail` appended to distinguish it from an
 * Office that already answers to the bare form.
 *
 * The result is not guaranteed to be a slug: a one- or two-letter name is under the
 * length the database accepts, and an Office called "API" asks for an address the server
 * has already spoken for. Neither is padded or renamed into something the creator never
 * typed — `slugCandidates` is what deals with both.
 */
export function slugFrom(name: string, tail?: string): string {
  const base = stem(name) || FALLBACK
  if (tail === undefined) return clip(base, SLUG_MAX_LENGTH)
  return `${clip(base, SLUG_MAX_LENGTH - tail.length - 1) || FALLBACK}-${tail}`
}

/** How many slugs one name may ask for. Past this, a collision is not what is happening. */
const CANDIDATE_COUNT = 5

/**
 * The slugs to try for `name`, best first: the bare name, then the same name with a
 * random tail. Only usable slugs are offered, so a name too short — or one that collides
 * with an address the server owns — is simply never tried bare.
 *
 * `tail` is a parameter rather than a call to `randomTail` so a test can make a
 * collision happen on purpose.
 */
export function slugCandidates(name: string, tail: () => string): string[] {
  const candidates = [slugFrom(name)]
  while (candidates.length < CANDIDATE_COUNT) candidates.push(slugFrom(name, tail()))
  return candidates.filter(isSlug)
}
