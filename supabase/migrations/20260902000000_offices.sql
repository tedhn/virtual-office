-- The offices table: one row per Office, holding everything durable about it — who owns
-- it, how it is addressed, the size of its Floor, and its two Layouts.
--
-- A Layout is one JSON document rather than a zones table (ADR-0001), and it is checked
-- against the shared schema in `src/office/layoutSchema.ts` before a write is issued.
--
-- The checks below are a backstop, not that validation: they catch a document that is
-- not a Layout at all, and they stop the floor columns drifting from the document they
-- were taken from. They deliberately stop short of checking Zones, because a second
-- implementation of the Layout schema — in SQL, where the client cannot share it — is
-- exactly the duplication ADR-0004 exists to prevent. A caller holding the public anon
-- key can still write a well-shaped Layout full of nonsense Zones; closing that means
-- moving Layout writes behind the token server, which already loads the shared module.
--
-- The slug shape is spelled out here as well as in `src/lib/offices.ts`. That one is on
-- purpose: the client says so early enough to be a useful message, the database says so
-- because it is the only place that cannot be bypassed.

create table public.offices (
  id uuid primary key default gen_random_uuid(),

  -- The account that created this Office. Only it may author the Office (CONTEXT.md,
  -- Owner). Deleting the account takes the Office with it.
  owner_id uuid not null references auth.users (id) on delete cascade,

  -- Permanent, human-readable address. Never reassigned to a different Office, so a
  -- shared link cannot quietly resolve somewhere else — enforced by the trigger below.
  slug text not null unique,

  name text not null,

  -- Floor dimensions in world px. Zone rects are normalized against these, so the two
  -- travel together: a rect means nothing without the floor it is measured against.
  floor_width integer not null,
  floor_height integer not null,

  -- What Visitors enter and what the server enforces privacy against. Null until the
  -- Owner publishes for the first time — an unpublished Office is invisible to everyone
  -- but its Owner.
  published_layout jsonb,

  -- The Owner's work in progress. Visible to nobody else: no policy or view exposes this
  -- column to anyone but the Owner, which is why the public read surface is a view that
  -- omits it rather than a row policy over this table.
  draft_layout jsonb not null,

  -- Bumped by the database every time the published Layout changes, so a client can tell
  -- a stale Layout from a current one without diffing JSON. Note this is NOT the document
  -- schema version ADR-0001 asks for "alongside it for future migrations"; that is still
  -- owed, and wants its own column when the Layout schema first changes shape.
  layout_version integer not null default 0,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint offices_slug_shape check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) between 3 and 63),
  constraint offices_name_present check (length(btrim(name)) > 0),
  constraint offices_floor_positive check (floor_width > 0 and floor_height > 0),
  -- Every check below is wrapped in coalesce(..., false), because a missing key makes
  -- these expressions NULL rather than false, and a CHECK that evaluates to NULL PASSES.
  -- Without the wrapper, `{}` is a valid Layout as far as Postgres is concerned.
  constraint offices_draft_is_document check (
    coalesce(
      jsonb_typeof(draft_layout) = 'object'
      and jsonb_typeof(draft_layout -> 'zones') = 'array'
      and jsonb_typeof(draft_layout #> '{floor,width}') = 'number'
      and jsonb_typeof(draft_layout #> '{floor,height}') = 'number',
      false
    )
  ),
  constraint offices_published_is_document check (
    published_layout is null
    or coalesce(
      jsonb_typeof(published_layout) = 'object'
      and jsonb_typeof(published_layout -> 'zones') = 'array'
      and jsonb_typeof(published_layout #> '{floor,width}') = 'number'
      and jsonb_typeof(published_layout #> '{floor,height}') = 'number',
      false
    )
  ),

  -- A Zone rect means nothing without the Floor it is measured against, so the columns
  -- and the document are not allowed to disagree about how big the Floor is.
  constraint offices_draft_floor_matches check (
    coalesce(
      (draft_layout #>> '{floor,width}')::numeric = floor_width
      and (draft_layout #>> '{floor,height}')::numeric = floor_height,
      false
    )
  ),
  constraint offices_published_floor_matches check (
    published_layout is null
    or coalesce(
      (published_layout #>> '{floor,width}')::numeric = floor_width
      and (published_layout #>> '{floor,height}')::numeric = floor_height,
      false
    )
  )
);

create index offices_owner_id_idx on public.offices (owner_id);

-- Slug permanence, ownership permanence, and the published-Layout version counter, in
-- one trigger: all three are facts about a row that no client gets a say in.
create function public.offices_before_update()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.slug is distinct from old.slug then
    raise exception 'an Office slug is permanent (% cannot become %)', old.slug, new.slug
      using errcode = 'check_violation';
  end if;

  if new.owner_id is distinct from old.owner_id then
    raise exception 'an Office cannot change hands'
      using errcode = 'check_violation';
  end if;

  if new.published_layout is distinct from old.published_layout then
    new.layout_version := old.layout_version + 1;
  else
    new.layout_version := old.layout_version;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

create trigger offices_before_update
  before update on public.offices
  for each row execute function public.offices_before_update();

-- An Office created already published counts as version 1; one created as a draft only
-- is version 0 until its first publish.
create function public.offices_before_insert()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.layout_version := case when new.published_layout is null then 0 else 1 end;
  new.created_at := now();
  new.updated_at := now();
  return new;
end;
$$;

create trigger offices_before_insert
  before insert on public.offices
  for each row execute function public.offices_before_insert();

-- Row-level security: the offices table is the Owner's surface and nobody else's. Every
-- policy names `authenticated`, so a caller with no identity at all sees nothing here.
alter table public.offices enable row level security;

create policy "an Owner reads their own Offices"
  on public.offices for select to authenticated
  using ((select auth.uid()) = owner_id);

-- Creating an Office needs a real, recoverable account (ADR-0003): an anonymous identity
-- lives in browser storage, and an Office whose Owner cleared their storage is orphaned.
create policy "a signed-in account creates its own Office"
  on public.offices for insert to authenticated
  with check (
    (select auth.uid()) = owner_id
    and coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) = false
  );

create policy "an Owner changes their own Office"
  on public.offices for update to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

create policy "an Owner deletes their own Office"
  on public.offices for delete to authenticated
  using ((select auth.uid()) = owner_id);

-- The public read surface. Row-level security filters rows, and a draft Layout is a
-- column — so the way to keep drafts unreadable by everyone but their Owner is to expose
-- a surface that has no draft column at all.
--
-- Deliberately NOT security_invoker: the view runs as its owner and so is not subject to
-- the owner-only policies above. That is the point — it is the one door onto published
-- Layouts, and it can only ever hand back a published one.
create view public.offices_public
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
  where published_layout is not null;

revoke all on public.offices_public from anon, authenticated;
grant select on public.offices_public to anon, authenticated;
