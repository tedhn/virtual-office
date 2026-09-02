-- Addresses the server already answers to, kept out of the pool of slugs.
--
-- An Office lives at the root of the site, so `/api` as a slug is an Office whose link
-- reaches the token server instead of the app — and a slug is permanent, which makes that
-- an Office nobody can ever open and whose address can never be recovered. The client says
-- so first, in `src/lib/slug.ts`, so a creator never sees the error; this is the copy that
-- cannot be bypassed, which is the same division of labour as the slug's shape.
--
-- Adding a route the server owns means adding it in both places. There is no way around
-- the pair: the database cannot read the Express app, and the Express app is not what
-- writes get past.

alter table public.offices
  add constraint offices_slug_not_reserved check (slug not in ('api', 'ws', 'assets'));
