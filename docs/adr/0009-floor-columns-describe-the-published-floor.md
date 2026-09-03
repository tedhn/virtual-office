# The floor columns describe an Office's published Floor, not its draft's

`offices.floor_width` and `offices.floor_height` are the dimensions of the Floor an Office
is currently published with. A draft Layout may carry a Floor of any other size; those
columns follow it only when it is published. The database holds the published document and
the columns to agreeing (`offices_published_floor_matches`); the draft is held to having a
positive Floor of its own and nothing more.

Before this, both documents were held to matching the columns, which was free: nothing
could change a Floor, so every Layout an Office had was created with the same one. Letting
an Owner type Floor dimensions made the two constraints contradictory — a draft whose Floor
differs from the published one cannot be stored at all while both stand — and a draft that
cannot be saved is the one thing the editor promises will always work.

## Considered options

**Keeping the columns matched to the draft** was the smaller change, since `saveDraft`
already wrote them. It puts a draft's Floor on `offices_public`, which every Visitor reads:
they would be handed the dimensions of an Office nobody has published yet, beside the
published Layout those dimensions do not measure. That is both wrong and a leak of the
Owner's unfinished work, which is precisely what ADR-0005 exists to prevent.

**Dropping the columns entirely** is the tidier end state, and tempting: the Floor already
travels inside the document (ADR-0001), and nothing in this codebase reads the columns for
behaviour. It also throws away the one check that cannot be bypassed by a caller holding
the publishable key — that a published Layout's Floor is a positive whole number of pixels
— and rewrites the public view for a feature that only needed the Floor to be editable. It
stays available if a reason to normalize the other direction ever turns up.

## Consequences

An unpublished Office's floor columns describe a Floor nobody shares: whatever it was
created with, until its first publish. Nothing reads them in that state, but a query that
one day does — an admin view, an export — has to ask whether the Office is published before
believing them.

The columns are now denormalized from a *different* document than the draft the Owner is
editing, so the two legitimately disagree while work is in progress. A migration that ever
needs to rewrite Floor dimensions has to touch the published document and the columns
together, and leave the draft alone.
