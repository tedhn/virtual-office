# Chat isolation is enforced from a server-fetched Layout, never from client claims

A private Room isolates the chat of everyone inside it. The server decides who is inside
which Room by evaluating each connection's reported position against the Office's
published Layout, which it fetches from the database itself and caches per Office. A
client never tells the server which Room it is in.

## Considered options

Letting the client report its own Room-context is dramatically simpler, and it is the
shortcut a future maintainer will reach for when they see the server fetching Layouts
just to compare rectangles. It is also a straightforward privacy hole: a client that
claims to be in a Room receives that Room's private chat without ever going there. The
position a client reports can be lied about too, but a lie there puts a visible avatar
in the room for everyone to see, which is a different class of problem.

Moving chat onto the database's own realtime channels with row-level security was the
other candidate. Row-level security cannot readily express "inside this rectangle right
now", so the check would have had to move back to application code anyway.

## Consequences

The server needs a Layout fetch and a cache, which is real complexity for a chat feature.
That complexity is the point: it is what keeps a private conversation private. Any change
that makes the server trust a client's own account of where it is reintroduces the hole
this ADR exists to close.

## Amendment: the publishable key, not a service-role one

This ADR was first written expecting the server to read Layouts with a service-role key.
It does not, and should not. The published Layout is already public — `offices_public`
hands it to any browser holding the Office's link (ADR-0005) — so reading it needs no
privilege a Visitor lacks, and the server holds none. ADR-0006 took the same line for the
token gate, and this is the same reasoning applied to the same view.

What is load-bearing here is *who evaluates the position*, not which key was used to read
the rectangles. A service-role key would have added a credential that bypasses row-level
security to a process that has no row it is entitled to read and a Visitor is not.

## Amendment: the cache is invalidated on a publish, with the clock underneath it

The cache described above is `server/officeLayouts.mjs`. It was first written to forget a
Layout only after a fixed interval; a publish now tells it directly, over the channel from
the publishing browser this amendment used to say was owed (ADR-0007). The interval
remains, as the backstop for a publish that could not reach the server and for a process
that was not the one told — so the window in which the relay can be enforcing a superseded
Layout is still bounded by it, rather than depending on the announcement arriving.

For that bound to be real, that cache has to be the only one. The relay therefore keeps no
Layout of its own and asks for one per message it judges — a resolved promise on a cache
hit. A copy held on the connection, or on the Office's set of sockets, would expire only
when something happened to refresh it, which for a lone Visitor standing in their own
Office is never. Anyone tempted to hold onto a Layout to save a microtask should read this
paragraph as the reason not to.
