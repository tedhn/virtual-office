# A publish tells the relay, and the relay hands the new Layout to the people inside

Publishing writes the Office row and then posts `/api/offices/:slug/published`. The server
drops the Layout it had cached for that Office, reads the published one again, and sends
that document down every socket in the Office. The relay hands the same document to anyone
joining, so a reconnect brings a current Layout too. Each client swaps the Layout it is
standing on for the one that arrives, and any Avatar the new Layout has left somewhere they
may not be is moved to the nearest spot they may.

This is the publish-time invalidation ADR-0002's second amendment said was owed. The clock
it describes stays as the backstop underneath.

## Considered options

**Telling the clients to go and read it themselves** — the relay says "your Office has been
republished" and every browser fetches `offices_public` — was the first shape. It costs one
database read per person in the Office for a document the server has just read, and it
makes an unauthenticated nudge into a way to point a room full of browsers at the database.
Sending the document the server already holds is one read, fanned out.

**Sending the Layout the publishing browser holds**, in the body of the request, would have
been one read fewer still. It is also the client telling the server what the floorplan is,
which is exactly what ADR-0002 exists to refuse. The database is what says what an Office's
published Layout is; the endpoint carries a slug and nothing else.

**Verifying the caller's session** before accepting the nudge is the gate this endpoint
most obviously lacks. It answers a question the endpoint does not raise: a nudge cannot
make the server say anything the database did not, and its cost — one read of a view that
is public to anyone holding the Office's link — is below what `/api/token` next door
already costs unauthenticated. ADR-0006 took the same line and for the same reason:
identity checking is worth doing across every endpoint at once, not bolted onto one.

**Leaving it to the clock** was the status quo, and means a Visitor walks around a
floorplan that no longer exists for up to half a minute — through walls that are now
elsewhere, in a Room whose privacy has moved. Publishing is rare and being wrong about the
Floor is not a small kind of wrong.

## Consequences

The relay gained two things that are not fan-out: `occupancy(slug)`, so an Owner can be
warned before they disrupt people, and `announceLayout(slug, layout)`. Neither remembers a
Layout — the relay still asks `officeLayouts` for one per message it judges, so ADR-0002's
"the cache is the only cache" still holds and the announcement is a message rather than a
second copy.

A Layout arriving over a socket is checked before it is used, the same way one loaded from
the database is. The server having validated it is not a reason for the client to skip it;
the check is cheap and the renderer indexes into rects.

An Avatar can now be moved without its person doing anything. That happens only when the
Layout they are standing on is replaced under them, and there are two ways that leaves them
somewhere they may not be. Inside a Table or a Wall they are not stuck — `resolveMove` lets
you walk out of a solid Zone you are already inside — but collision is switched off for
them until they do, so they walk through everything else on the Floor meanwhile. Inside a
Room they never entered they *are* stuck: Room-boundary crossing has no such escape hatch,
so only the Leave button gets them out, and if it is private they are in its Room-context
without having joined — which is the order-dependent privacy this repo keeps refusing.
`legalSpot` in the geometry module is where "somewhere they may stand" is decided; it takes
the Room the Avatar walked into so that resizing a Room does not evict its occupants, and
falls back to the Spawn Zone when a Layout has left nowhere nearby to be.

## What this does not fix

The nudge is best-effort by design, and two things are left leaning on the reconnect.

If the browser that published cannot reach the server, the publish has still happened.
Enforcement corrects itself within `officeLayouts`' TTL; the people inside keep the old
floorplan on screen until their socket next reconnects, and the Owner is told so in those
words rather than being promised a number of seconds. Nothing in the publish path may be
made to depend on this call landing.

More than one relay process is the same gap, permanently: the nudge reaches one of them,
and sockets held by the others hear nothing until they reconnect. This deployment runs a
single process, so it does not bite today. Anything that scales the relay out has to
replace this endpoint with a channel every process listens on — Postgres `NOTIFY` or
Supabase Realtime — and should read this paragraph as the reason rather than discovering it
from a room full of people standing in walls.
