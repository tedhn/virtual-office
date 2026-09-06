# The chrome has two themes; the Floor is one surface in both

The chrome — the front door, the join screen, the list of an Owner's Offices, the editor,
and the dialogs that open over any of them — follows the reader's system preference, light
or dark. The Floor does not, and neither does anything drawn on it: the in-Office HUD's
panels float on the Floor and take the Floor's colours, not the chrome's. It is a dark playfield in either theme, and its colours are declared once,
in `:root`, with no `.dark` counterpart.

That split is what `--floor-*` and `--zone-*` mean as a naming convention, and
`palette.test.ts` holds both halves of it: every chrome colour has to exist in both
blocks, and no Floor colour may appear in `.dark` at all.

The reason is what the Floor is. Everything drawn on it — an Avatar's circle, a peer's
live camera inside that circle, a Zone's tint, a speaking ring — is content being looked
at, not chrome arranged around content. Those read against dark and wash out against
light, and no palette makes one set of Zone tints work on both grounds. A Floor that
inverted with the reader's system preference would be two different products, only one of
which anyone had designed.

## Considered options

**Theming the Floor along with the chrome** is what the codebase appeared to intend:
`FloorLayout` and `FloorCanvas` carried a careful `dark:` variant for every colour on the
Floor. None of them had ever rendered — nothing set the `.dark` class — so what looked
like a shipped dark Floor was an untested guess, and the one bug visible in it without
running it (`FloorCanvas`'s grid was a hardcoded black with no dark counterpart, invisible
on the dark floor beneath it) suggests it would not have survived first contact. Keeping
it would have doubled every Zone token for a surface nobody has asked to see two ways.

**Deleting the dark variants and shipping light only** was the ticket's other honest
option, and the cheapest. It gives up a theme the palette was already three quarters
written for, and it is the wrong trade for a product whose main surface wants to be dark
regardless: we would be deleting the half we want to keep.

## Consequences

A `dark:` utility in this codebase is now a live thing that renders, which it was not
before. Anything drawn on the Floor must not use one — it would be a colour only some
readers ever see, on a surface that never changes. The Floor's own set of tokens is the
place to add to instead, and it is deliberately complete enough to have no gaps: panels,
scrims, status badges, chat names and the editor's selection marks are all in it.

The Floor sits on the chrome as a dark rectangle in the light theme — on the join screen's
preview, in the editor's canvas. That is intended, and is the strongest visual statement
the product makes: bright white around a dark room.

Two colour sets means one more question when adding a colour: is this thing chrome, or is
it on the Floor? The naming answers it, and the test enforces the answer.
