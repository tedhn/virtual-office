const TAIL_LENGTH = 4
const TAIL_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789"

/**
 * A short random tail, for telling apart two Offices that asked for the same slug.
 *
 * It lives here rather than in `slug.ts` because `slug.ts` is loaded from source by the
 * token server, and ADR-0004 keeps that graph free of DOM types — `crypto.getRandomValues`
 * type-checks only through the DOM lib. Nothing on the server needs to invent a slug
 * anyway: it only needs to recognise one.
 *
 * Drawn from the platform's crypto rather than `Math.random`, so two people naming an
 * Office the same thing in the same second are not handed the same candidates in the same
 * order.
 */
export function randomTail(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(TAIL_LENGTH))
  return Array.from(bytes, (b) => TAIL_ALPHABET[b % TAIL_ALPHABET.length]).join("")
}
