# Stream tokens are minted only for an Office that exists and is published

`POST /api/token` takes the slug of the Office being walked into as well as the user id,
and mints nothing unless that slug names a published, undeleted Office. The server answers
that question itself, by reading `offices_public` — the same view a browser reads, with the
publishable key, so the endpoint holds no privilege a Visitor does not already have. A
server started without Supabase credentials exits rather than running with the gate open.

Until Offices were user-created, the endpoint minted a Stream token for any user id posted
to it. That was survivable while the only Office was one hardcoded floorplan; with sign-up
open and Offices created by anyone, an unauthenticated endpoint that mints call credentials
is a stranger's route to our Stream bill, reachable with `curl` and no account.

## Considered options

Verifying the caller's Supabase session instead — checking the JWT and minting for the id
inside it — is the check this one is most likely to be mistaken for, so it is worth being
clear that they answer different questions. It would stop someone minting under a made-up
identity, but not the traffic that costs money: a published Office's link is public, anyone
holding it is entitled to walk in, and an anonymous identity is one silent request away. It
also puts a network round trip in front of every token. Worth doing, but as identity work
rather than as this gate, and it does not replace it.

Gating in Stream instead — permissions on the call rather than on minting — moves the rule
into a third party's model of who may do what, where the answer to "is this Office
published?" does not live. The database is the only thing that knows.

Leaving it ungated and watching the Stream dashboard was the status quo, and is a decision
to find out from an invoice.

## Consequences

The token server now depends on Supabase to start, which is a new failure mode for a
deployment that has Stream credentials and nothing else: it exits at boot with the missing
variables named. That is deliberate — a server that starts and mints for anything is worse
than one that does not start.

The gate is not an identity check, and it is not one by design (see above). Anyone with a
published Office's slug can still ask for a token under any user id they like. Closing that
means verifying the caller's session, and whoever does it should read the paragraph above
before assuming this ADR already covers it.

`server/token.mjs` imports `src/lib/slug.ts` straight from TypeScript source, so that
module now lives under ADR-0004's rules along with the geometry: no third-party imports, no
DOM types, explicit `.ts` extensions on anything it imports. Recognising an Office's address
is worth sharing — the alternative is a second copy of the slug shape on the server, which
is the duplication ADR-0004 exists to prevent. Inventing a slug is not shared, and lives in
`src/lib/randomTail.ts` instead, because it needs a random source the rule does not allow.

`offices_public` is now load-bearing for the token endpoint as well as for the browser, so
its `where` clause decides who can be minted a token as well as who can read a Layout
(ADR-0005). Unpublishing an Office therefore locks people out of it, which is what
unpublishing should mean.
