# The database decides who gets turned out of an Office

Deleting an Office is a write to its row, and the people standing in it at the time hold
WebSockets that no write can reach. So an Owner's browser tells the token server as well:
`POST /api/offices/:slug/deleted`, which closes every socket in that Office with the close
code that means "no Office answers to this address, do not knock again".

That endpoint takes no identity, exactly like the two beside it (ADR-0006 makes identity a
job for every endpoint at once, not a gate bolted onto one). What keeps it from being a way
for a stranger to empty a busy Office is that it does not act on what the caller says. It
drops what it remembered about the Office, rereads `offices_public` — the same view any
holder of the link may read — and closes sockets only when the answer is that no published
Office is there. A caller who is simply wrong, or lying, is told the Office is still
published and nobody moves. A directory that cannot be reached leaves everyone standing
too: not being able to ask is not the same as being told no.

## Considered options

**Authenticating the endpoint** — verify the caller's session and that they own the Office —
is the obvious answer, and is still worth doing as part of giving this server an identity
story. On its own it would have been a gate protecting a claim that does not need to be
believed: the reread is cheaper than a JWT verification, and it is what makes the endpoint
correct rather than merely restricted. An authenticated endpoint that trusted the claim
would still hang up on a live Office whenever an Owner's delete failed after the
announcement was sent.

**Letting the relay notice for itself** — poll, or subscribe to Postgres changes — needs no
endpoint at all and covers deletes this server never hears about. It is also a standing
subscription per Office and a second thing that decides when a Layout is stale, which is the
decision `officeLayouts.mjs` exists to hold alone. What the relay does instead is act on the
answers it already asks for: it reads the Office's Layout to judge every chat message, and
when that read comes back empty it turns the whole Office out on the spot. So the paths are
the endpoint (immediately), the first thing anybody says once the cache has lapsed, and a
socket's next reconnect. What none of them covers is an Office where nobody speaks and
nobody's connection blinks: those sockets stay open, and their Visitors go on walking around
an Office that is gone until one of the three happens. A sweep on a timer would close that
last gap, and is the thing to add if it ever matters.

**Saying nothing and letting the sockets rot** was the state before this. Chat already fails
closed on an Office with no published Layout, so the people inside get silence with no
reason for it, and go on walking around a Floor nobody can reach until something else
notices. A Visitor being disconnected is not the problem; being disconnected without being
told is.

## Consequences

The relay's `closeOffice` is only ever reached with a fresh answer from the database in
hand: from this endpoint, or from the relay's own Layout lookup while it judges a chat
message. Neither decides on a guess, and a future caller inherits that obligation — a socket
closed with `CLOSE_NO_OFFICE` is one the client deliberately will not reopen.

The 409 tells an unauthenticated caller that a published Office answers to a slug, which is
a distinction `noSuchOffice` refuses to draw. It costs nothing: that is exactly what
`offices_public` hands anybody who asks for the same slug, which is the same reason this
endpoint needs no identity in the first place. The answers that stay conflated are the ones
about an Office that is *not* there — never existed, never published, deleted — and this
reply is not one of them.

The same path covers an Office that has been unpublished rather than deleted, because the
view answers the same way for both. That is the answer the client already gives such a
Visitor (`NotFound` and the closed-Office screen both refuse to distinguish the two), so
there is nothing extra to decide. Nothing an Owner can do today unpublishes an Office, but
if that ever becomes one of their options it wants this endpoint rather than one of its own.
