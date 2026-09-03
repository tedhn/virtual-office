# Every write to an Office goes through the token server, not straight to PostgREST

`insert` and `update` on `public.offices` are revoked from `anon` and `authenticated`. The
browser asks the token server to change an Office instead, and the server verifies the
caller's JWT, refuses a write to an Office they do not own, runs the shared Layout schema,
and writes with the secret key.

The key the browser holds is public by design — it is in the bundle, and anybody who opens
an Office can read it. So every rule the browser applied to a Layout before writing it was a
rule the same key could decline to apply. The database's own checks stop deliberately short
of the Zones: `offices_draft_is_document` and its siblings ask for an object with a `zones`
array and a numeric Floor, and nothing more, because a second implementation of the Layout
schema written in SQL is precisely the duplication ADR-0004 exists to prevent. Between the
two, a caller holding the anon key could store a well-shaped Layout full of nonsense Zones
straight onto a published Office — and the relay, which enforces private Rooms against that
document, would refuse to read it and fail closed on an Office nobody could fix.

The server is where the shared schema already runs. `server/officeLayouts.mjs` loads
`src/office/layoutSchema.ts` from source to decide what the relay may enforce privacy
against; `server/officeWrites.mjs` now loads `src/lib/offices.ts` the same way, which is the
whole of what a write has to be right about. One implementation, running where a caller
cannot get past it.

## Considered options

**Spelling the Layout schema out in SQL** — a check constraint that knows what a Zone is —
keeps writes where they were and needs no server. It is the option ADR-0004 already
rejected in the other direction: two implementations of what a Layout is, one of them in a
language the client cannot share, drifting apart the first time a Zone kind grows a field.
The relay's copy of the floorplan was removed for exactly this reason and should not come
back as a constraint.

**A Postgres function with the validation inside it**, called instead of a table write,
moves the check into the database without a second schema *language* — but it is still a
second implementation, in PL/pgSQL, of a module that already exists in TypeScript and is
already loaded by the process that needs it.

**Leaving it as it was** was defensible while it was written down: the database refuses a
document that is not a Layout at all, an Owner can only reach their own row, and the damage
from nonsense Zones is limited to the Owner's own Office. What makes it not good enough is
that "limited to the Owner's own Office" is not the same as limited to the Owner: the people
standing in that Office are the ones whose privacy the relay stops being able to enforce.

**Revoking only the Layout columns** with column-level privileges, leaving rename and delete
in the browser, is a smaller change and was rejected for being a smaller change in the wrong
shape: the boundary would be per-column rather than per-operation, and the next column added
to `offices` would be writable by the browser until somebody remembered. Revoking the
operations makes the boundary one a reader can state without a list of exceptions.

`delete` is deliberately not in the revoke, and needs no defending here: no policy has named
DELETE since the soft delete landed, so the statement already matches no rows for anybody,
and revoking the grant would change the answer a caller gets from "nothing was removed" to
an error — which is precisely what that migration chose against.

## Consequences

**The server needs the secret key**, and refuses to start without it. That key bypasses
row-level security, so the ownership check in front of the writes stops being a convenience
and becomes the boundary — the same shift `offices_public` made when it was declared
`security_invoker = false` (ADR-0005). A deployment that has the publishable pair but not
the secret key now fails at boot rather than at somebody's first save.

**The rules exist in two places on purpose.** The owner-only policies on `offices` stay,
unreachable, because Postgres needs both a privilege and a passing policy and a future
`grant` should reopen an owner-only door rather than an open one. And ADR-0003's rule — an
Office needs a real account, not an anonymous identity — is now said in
`server/officeWrites.mjs` as well as in the insert policy, because the key the server writes
with is not subject to the policy.

**Reads are untouched, and that boundary is now the only thing row-level security is
load-bearing for on this table.** An edit that widens a read policy or the `offices_public`
view is still a change to the privacy model (ADR-0005); an edit that grants writes back is
now one too.

**Renaming and deleting moved as well**, though neither is a Layout write, because the
revoke is per-operation. They are ordinary `update`s and had nowhere else to go.

**A save is now two hops rather than one**, and the editor's error messages come back over
HTTP instead of being thrown locally. They are the same messages: the server returns what
`src/lib/offices.ts` threw, and `src/lib/officeApi.ts` deliberately re-checks nothing, since
the copy the browser reached would be the copy that does not count.
