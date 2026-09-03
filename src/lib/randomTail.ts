const TAIL_LENGTH = 4
const TAIL_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789"

/**
 * A short random tail, for telling apart two Offices that asked for the same slug.
 *
 * It lives here rather than in `slug.ts` because `slug.ts` is loaded from source by the
 * token server under ADR-0004's rules, and `crypto.getRandomValues` type-checks only
 * through the DOM lib. This module is now in that graph too — `lib/offices.ts` reaches it
 * when it invents a slug — which is fine at runtime, since Node has the same Web Crypto
 * global the browser does, and fine at build time, since nothing type-checks this file
 * without the DOM lib. `slug.ts` stays clear of it all the same: recognising a slug is
 * what the token and relay routes need, and they should not have to carry this to get it.
 *
 * Drawn from the platform's crypto rather than `Math.random`, so two people naming an
 * Office the same thing in the same second are not handed the same candidates in the same
 * order.
 */
export function randomTail(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(TAIL_LENGTH))
  return Array.from(bytes, (b) => TAIL_ALPHABET[b % TAIL_ALPHABET.length]).join("")
}
