# Chat isolation is enforced from a server-fetched Layout, never from client claims

A private Room isolates the chat of everyone inside it. The server decides who is inside
which Room by evaluating each connection's reported position against the Office's
published Layout, which it fetches from the database itself with a service-role key and
caches per Office. A client never tells the server which Room it is in.

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

The server needs privileged database access and a cache invalidated on publish, which is
real complexity for a chat feature. That complexity is the point: it is what keeps a
private conversation private. Any change that makes the server trust a client's own
account of where it is reintroduces the hole this ADR exists to close.
