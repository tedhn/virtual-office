/**
 * Why the relay hung up, as close codes both ends agree on.
 *
 * The distinction these draw is the one a reconnect loop needs and cannot work out for
 * itself: whether the door might open on a second knock. A client that retries everything
 * hammers an address that is never going to answer; a client that retries nothing gives up
 * on a server that was merely restarting.
 *
 * Shared rather than written out twice, the way the slug shape and the geometry are —
 * `server/relay.mjs` loads this module from source, so it lives under ADR-0004's rules: no
 * runtime imports, no DOM types, nothing to resolve on the server side.
 */

/**
 * No published Office answers to that address — it never existed, was never published, or
 * has been deleted. Nothing about knocking again changes the answer.
 */
export const CLOSE_NO_OFFICE = 4404

/**
 * The office directory could not be reached, so the relay does not know whether there is
 * an Office there. Not knowing is not the same answer as no: knock again.
 */
export const CLOSE_TRY_LATER = 1013

/** Service Restart. Sent to every socket on shutdown so clients reconnect at once. */
export const CLOSE_RESTARTING = 1012
