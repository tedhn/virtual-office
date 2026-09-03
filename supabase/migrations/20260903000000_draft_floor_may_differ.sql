-- A draft Layout is allowed a Floor of its own size.
--
-- The floor columns were held to matching both documents, which cost nothing while nothing
-- could change a Floor: every Layout an Office had was created with the same one. The
-- numeric inspector changes that. An Owner types a wider Floor, saves the draft, and goes
-- on working before publishing it — and with both match-constraints standing, that save was
-- refused outright, because `draft_layout` and `published_layout` cannot both match one
-- pair of columns while the two documents disagree about the Floor.
--
-- So the columns describe the Office's *published* Floor: the one every client of that
-- Office shares, and lines its world coordinates up against (CONTEXT.md, Floor). The
-- constraint on the published document stays, to keep them honest about it. `saveDraft` no
-- longer writes them and publishing does, which is the moment a draft's Floor becomes the
-- Office's. An Office not yet published has no Floor anybody shares, and its columns hold
-- the one it was created with until it does. See ADR-0009.
--
-- Dropping the draft's match takes away a check the draft document was getting for free.
-- The columns are `integer` and `offices_floor_positive` holds them above zero, so a draft
-- obliged to match them could not carry a Floor of 0, of -5, or of 900.5 either. The
-- positive half is worth keeping on its own account — a Floor of no width is a document the
-- editor divides by — so it is spelled out against the document below. Whole numbers are
-- left where they can still be insisted on at the moment they matter to anyone else: the
-- shared validator on the way in, and the published comparison against an integer column.

alter table public.offices drop constraint offices_draft_floor_matches;

-- Wrapped in coalesce(..., false) for the reason the constraints above it are: a missing
-- key makes the expression NULL, and a CHECK that evaluates to NULL passes.
alter table public.offices add constraint offices_draft_floor_positive check (
  coalesce(
    (draft_layout #>> '{floor,width}')::numeric > 0
    and (draft_layout #>> '{floor,height}')::numeric > 0,
    false
  )
);
