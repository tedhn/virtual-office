# Context

Domain glossary for virtual-office. Terms only — no implementation detail. If a word
here is used loosely in code or conversation, that is a bug in the code or the
conversation, not in this file.

## Office

A single virtual workplace that people walk around in together. An Office is the unit a
user creates and owns. Each Office is its own world: the people inside one Office cannot
see, hear, or message the people inside another.

An Office is **reachable** when a Visitor can walk into it: it has a published Layout, and
it has not been deleted. Those are the only two ways to be unreachable, and from outside
they are deliberately indistinguishable — which of the two it is, is nobody's business but
the Owner's.

An Office may be **deleted** by its Owner, which is permanent and takes effect for
everyone: it stops being reachable, and anybody standing in it at the time is **turned
out** — disconnected, and told the place has gone. What survives a deletion is its Slug —
see below — so the address it answered to is spent rather than freed.

Formerly there was exactly one Office (`office-main`), hardcoded. It is now user-created
data.

## Floor

The walkable surface of an Office, and the coordinate space everything inside it is
positioned in. The Floor has a width and a height chosen by the Office's Owner, within a
permitted range: a Floor has to be big enough to walk about on and small enough to author
whole. Every client of the same Office shares identical Floor dimensions, so world
coordinates line up between peers.

## Zone

A rectangular region of a Floor with a behaviour attached. Zones are what an Owner places
when authoring an Office. There are five kinds:

- **Room** — an enclosed Zone, entered and left deliberately rather than by walking
  through its walls. A Room is either private or not. A private Room isolates the audio,
  video and chat of everyone inside it from the rest of the Floor. A non-private Room is
  enclosed but carries no isolation: its occupants remain part of the open Floor. (The
  old fixed floorplan called the non-private case a "toilet"; that was one building's
  furniture mistaken for a domain concept. A phone booth, a lobby and a toilet are all
  the same Zone kind with the privacy flag set differently.)
- **Table** — solid furniture, not walkable, surrounded by Seats. A Table may be styled
  as a dining table; the styling changes nothing about its behaviour.
- **Wall** — a solid, non-walkable bar. Divides space; carries no privacy of its own.
- **Spawn** — the region Visitors appear in when they enter an Office. Exactly one
  Spawn exists per Office; arrivals are scattered within it rather than stacked on one
  point. Walkable, and not otherwise special once you have arrived.
- **Exterior** — a region outside the Office's footprint. Non-walkable, visual only.

Note the deliberate narrowing: **Room means a private-capable Zone inside an Office, and
nothing else.** It never means the whole Office, and never means the transport channel
that carries an Office's traffic.

## Seat

An anchor point beside a Table where exactly one Avatar may sit. A Seat is taken when an
Avatar occupies it. Seats are derived from a Table's rectangle rather than authored
individually.

## Room-context

Where a person counts as being, for the purpose of privacy. Either the id of the Room they
are standing inside, or the open Floor. Two people share a Room-context when their chat
reaches each other and their voices carry. A non-private Room does not create a Room-context.

## Avatar

A person's visible presence on a Floor: their position, their name, and their presence
flags (deafened, watching a shared screen).

## Owner

The account that created an Office. The Owner is the only account that may change an
Office's Floor or Zones.

## Visitor

Anyone who enters an Office. A Visitor may walk, talk, chat and sit, but may not author
the Office. The Owner is also a Visitor whenever they are simply present in their Office
rather than editing it.

## Layout

The complete authored description of an Office: its Floor dimensions plus every Zone on
it. The Layout is durable and persisted. What happens *inside* an Office at runtime —
where Avatars stand, what is said in chat, who is present — is not part of the Layout and
is not persisted.

A Layout exists in two states. The **published** Layout is what Visitors enter and what
the server enforces privacy against. The **draft** Layout is the Owner's work in
progress, visible to nobody else, and may be incomplete or invalid. **Publishing**
promotes a draft to published, and is the moment a Layout is checked for validity — a
draft is free to be nonsense, a published Layout is not.

## Slug

The short, human-readable name an Office is addressed by. A slug is permanent: it belongs
to the Office it first named, survives renaming and deleting alike, and is never reassigned
to a different Office — a shared link must never quietly resolve to somewhere else. An
Office's name is the thing an Owner may change; its address is not.
