# Layout stored as a single JSON document, not a normalized zones table

An Office's Layout — its Floor dimensions and every Zone on it — is stored as one JSON
column on the Office row, validated on write against a schema shared by the client and
the server, with a version number alongside it for future migrations.

## Considered options

A `zones` table with a row per Zone was the obvious alternative, and would give
per-Zone queries, per-Zone row-level security, and per-Zone writes. We chose the JSON
document because nothing in the product asks a question that spans Zones: every read is
"give me this Office's whole Layout" and every write replaces it wholesale. Normalizing
buys query power we have no query for, and charges a schema migration every time a Zone
kind grows a field.

## Consequences

If a feature ever needs to search across Offices by their contents — "find every Office
with a dining table", an admin view, analytics over Zone usage — this decision is the
thing standing in the way, and unpicking it means migrating live data rather than
changing a few functions. Treat such a feature as a trigger to revisit this ADR, not as
something to hack around with JSON queries.
