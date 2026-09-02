# Draft Layouts are kept private by a view, not by a row policy

The `offices` table is owner-only for every operation: read, insert, update, delete.
Everyone else reaches an Office through `offices_public`, a view that selects only
published Offices and does not select the draft column at all.

Row-level security decides which *rows* a caller sees. A draft is a *column* on the same
row as the published Layout it will replace, so a policy generous enough to let a
Visitor read a published Office ("published_layout is not null or you own it") also hands
them `draft_layout` on that row — an Owner's unfinished work, readable by anyone holding
the link. Column privileges can take that column away, but only per role, and every
signed-in caller in this product is the same role (`authenticated`): revoking the draft
column from `authenticated` revokes it from the Owner too.

A view has no such problem, because the columns are chosen when the view is written.

## Considered options

Keeping drafts in a separate `office_drafts` table with its own owner-only policy gives
the same privacy with no view, and was rejected for splitting one Office across two
tables: publishing becomes a write to two places, and the pair can disagree.

The view is deliberately **not** `security_invoker`, so it runs as its owner and is not
subject to the owner-only policies on the table underneath. That is what makes it a
public read surface at all — and it is safe here only because the view's own definition
is the whole boundary: it filters to `published_layout is not null` and it lists the
columns a Visitor may see.

## Consequences

Any column added to `offices` is private until someone adds it to `offices_public` —
which is the right default, but means the view is a second place to edit when the Office
grows a field that is meant to be public.

The view's `where` clause is now load-bearing security rather than convenience. Widening
it, or switching it to `security_invoker`, changes who can read what; treat an edit to
`offices_public` as a change to the privacy model, not a query tweak.
