-- Deleting an Office, without the slug becoming available again.
--
-- A slug is permanent: it belongs to the Office it first named and is never reassigned,
-- so a link that has been shared never quietly resolves somewhere else (CONTEXT.md,
-- Slug). A row that is deleted outright takes its slug with it and hands the address to
-- whoever asks for it next, which is exactly the thing that must not happen. So an Office
-- is deleted by being marked deleted: the row stays, the slug stays spent, and every
-- public surface stops showing it.
--
-- The Owner-facing half of this — listing, renaming and actually pressing delete — is its
-- own ticket. What is here is the column and the one place it has to be honoured.

alter table public.offices add column deleted_at timestamptz;

-- The public read surface, narrowed. Its `where` clause is the privacy boundary rather
-- than a convenience (ADR-0005), and it now carries two conditions instead of one: an
-- Office is reachable if it has been published AND has not been deleted. Both are
-- load-bearing; widening either changes who can read what.
--
-- The column list is unchanged, and deliberately still has no `deleted_at` in it: when an
-- Office is gone, "gone" is the whole of what a Visitor is told.
create or replace view public.offices_public
with (security_invoker = false) as
  select
    id,
    owner_id,
    slug,
    name,
    floor_width,
    floor_height,
    published_layout,
    layout_version,
    created_at,
    updated_at
  from public.offices
  where published_layout is not null
    and deleted_at is null;
