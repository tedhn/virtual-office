# virtual-office

A browser **virtual office**: movable avatars on a shared 2D floor with
**proximity audio** — voices fade in as you walk closer, out as you walk away.
Built on the **GetStream Video SDK**.

## Setup

1. Create an app at [dashboard.getstream.io](https://dashboard.getstream.io) and copy
   its **API key** + **secret**.
2. `cp .env.example .env` and fill in `STREAM_API_KEY`, `STREAM_API_SECRET`, and
   `VITE_STREAM_API_KEY` (same value as the API key).
3. `npm install`
4. `npm run dev` — starts the Vite app **and** the token server together.

Point the app at a Supabase project (see **Identity and offices** below):
`VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` go in `.env` (the `VITE_` prefix is
what reaches the browser — a `NEXT_PUBLIC_…` key pasted from the dashboard does not), and
`npm run db:push` applies `supabase/migrations` to it. The token server reads that same
pair, and refuses to start without it: it has to be able to tell a real office from an
invented one before it mints anything (ADR-0006).

Sign in with an email link, name an office, and you land on it at its own URL — an empty
floor with a single spawn zone, and a link you can share. Author it at `/<slug>/edit`, and
publish when it holds together: publishing is what visitors walk into, and what the server
enforces privacy against.

### How it works

- **An office is its URL.** `/` creates one and lists the ones you own, `/<slug>` renders
  one, `/<slug>/edit` authors one, and anything else is a 404 — the whole route table is
  `src/lib/routes.ts`, a pure function over the path, with `useRoute.ts` as the twenty
  lines that touch the browser. A slug is permanent: it comes from the office's name, is
  never reassigned, and is checked in the same shape by the client (`src/lib/slug.ts`), the
  token server and the database.
- `server/index.mjs` — Express token server (:3001). Mints Stream JWTs; the API secret
  never reaches the browser. It mints only for an office that exists and is published
  (`server/token.mjs`, ADR-0006), which is why it needs Supabase credentials to start.
- `server/relay.mjs` — the WebSocket fan-out for positions and chat, and the one place
  chat isolation is enforced: a message reaches only sockets whose reported position
  shares the sender's room-context. It computes that from `src/office/layout.ts`, loaded
  straight from TypeScript source (see ADR-0004), so privacy has a single implementation.
  A socket is scoped to one office by its slug, and a slug no published office answers to
  is refused, so peers never cross from one office to another — and an office that stops
  answering while people are inside it has them turned out, with a close code that tells
  their reconnect loop not to knock again. `relay.test.mjs` drives a real socket server and
  covers the isolation rules.
- `server/officeLayouts.mjs` — where the relay gets those layouts: one per office, fetched
  from `offices_public` and remembered for 30 seconds. The relay keeps no copy of its own,
  so that interval is the whole of how stale enforcement can get (ADR-0002). Publishing
  cuts it short by saying so: `server/publishing.mjs` is the three endpoints an owner's
  browser calls around a publish or a delete — how many visitors are standing in the office
  (so it can warn them first), the nudge that drops the cached layout and pushes the new one
  down every socket in that office (ADR-0007), and the one that turns everybody out of an
  office that has been deleted. None is an identity check, for the reason ADR-0006 gives
  about the endpoint beside them, and the delete nudge does not need to be one: it rereads
  the database and closes sockets only if the office really is gone, so claiming an office
  has been deleted cannot empty one that has not (ADR-0010). `server/officeReplies.mjs` is
  the answers those routes share, so they cannot drift on what a 404 and a 503 mean.
  The relay also hands a layout to anyone joining, which is what makes its reconnect loop
  the backstop for a nudge that never arrived.
- `src/office/` — the world: `useMovement` (keyboard + broadcast over the relay),
  `usePositions` (interpolated remote positions), `useProximityAudio` (distance →
  `speaker.setParticipantVolume`), and the floor / avatars.
- `src/office/officeCall.ts` — an office's Stream call, created the first time somebody
  walks in and released when they walk out, so an empty office holds nothing open.
- `src/office/newOfficeLayout.ts` — what a new office starts as: an empty floor with one
  spawn zone, which is the least that can be published, since an office with nowhere to
  arrive is one nobody can enter.
- `src/office/layout.ts` — the geometry: room-context resolution, spawn scatter, seat
  derivation, collision, and `legalSpot` — where somebody ends up when the floor under them
  is republished with a wall through it. Every function takes the `Layout` (floor
  dimensions + zones) it operates on, so an office's floorplan is data rather than code.
  A zone is one of five kinds — room, table, wall, spawn, exterior — with privacy and
  table styling as flags on the zone. `layout.test.ts` covers the geometry, against
  `exampleLayout.ts` — one hand-authored office kept as a fixture, imported by tests and by
  nothing that runs.
- `src/office/FloorPreview.tsx` — an office's floor with nobody on it, fitted whole into
  the viewport; the join screen shows the office you are about to walk into with it.
  `OfficeFloor` is the other way to draw a layout: zoomed to a person and scrolled to
  follow them. `FloorLayout` draws either, and without click handlers it draws something
  to look at rather than something to walk on.
- `src/office/InsideOffice.tsx` — standing in one: the floor, everyone on it, and the
  controls for being one of them. Every office-specific thing arrives as a prop, so there
  is no floorplan and no office id in the file. ("Room" is reserved for a zone inside an
  office — see `CONTEXT.md` — which is why this is not called `OfficeRoom`.)
- `src/office/editing/` — authoring one, at `/<slug>/edit`: a place an owner goes rather
  than a mode inside the office, so nothing there touches presence or the published
  layout. `layoutEdits.ts` is the whole of the editing logic as pure functions from layout
  to layout, and it holds one invariant — what comes out is always structurally a layout,
  so an owner's draft always saves however half-finished it is. `EditorFloor.tsx` turns
  pointer drags into those functions' arguments; `OfficeEditor.tsx` is the screen. The
  inspector beside the floor is the precision a drag cannot reach — the selected zone's
  position and size in world px, and the floor's own width and height, with a value outside
  what a floor may be refused at the field rather than at publish. It reads the layout the
  canvas draws and writes back to the same one, so dragging renumbers the fields and typing
  moves the zone.
  Only the owner gets in, and that is the database's answer rather than a check in this
  code: every policy on `offices` names the owner, so a stranger's query returns no rows
  (ADR-0005). Publishing is the one thing done from this screen that anybody else sees:
  it refuses a layout that isn't an office — overlapping rooms, a spawn under a wall, no
  spawn or several — naming what is wrong and where, asks before disrupting people who are
  inside, and then hands them the new floor to stand on.

### Identity and offices

- **Visiting takes no account.** `src/auth/session.ts` signs a Visitor in anonymously as
  the page loads, and the Supabase client persists that session — so a refresh brings
  back the same person, not a stranger. **Creating** an Office needs a magic-link
  account, because an Office outlives the browser storage an anonymous identity lives in
  (ADR-0003). `AccountSignIn` is that second door, and the create form appears behind it.
- `supabase/migrations/` — the `offices` table: owner, permanent slug, name, the published
  floor's dimensions, the published and draft Layouts, and a layout version the database
  bumps itself on every publish. The floor columns describe the floor every client of that
  office shares, and the database refuses a row where they and the published document
  disagree; a draft is free to propose another size, and publishing is what makes it the
  office's (ADR-0009). A Layout is one JSON document (ADR-0001). An office is deleted by
  being marked deleted, never by having its row removed — the row is what keeps its slug
  spent, so a shared link can never come to mean somewhere else — and no policy grants
  DELETE at all, so that is the database's rule rather than the client's manners.
- **Row-level security is the boundary.** The table is owner-only for every operation.
  Row-level security filters rows and a draft is a *column*, so the public read surface
  is the `offices_public` view, which has no draft column to leak and shows only
  published Offices. Creating an Office is refused outright for an anonymous identity.
- `src/lib/publishing.ts` — the other half of publishing and deleting: the calls an owner's
  browser makes to the token server around the database write, over `src/lib/api.ts` (which
  is just where the API's base URL lives, shared with `stream.ts`). None is load-bearing —
  the office is published, or deleted, the moment the row is written.
- `src/OwnOffices.tsx` — the owner's list of their offices, and the two things they can do
  to one from outside it: rename it, which leaves the address every shared link uses alone,
  and delete it, which asks first because the address is then spent for good and anybody
  inside is disconnected. Both are ordinary writes; what makes them owner-only is that the
  database hands nobody else the row (ADR-0005).
- `src/lib/offices.ts` — the write path. A Layout is validated against
  `src/office/layoutSchema.ts` before a request is issued: a draft only has to be
  well-formed, publishing also has to describe an Office that works — one spawn zone,
  nothing solid under it, and no two rooms over the same floor (which would make
  room-context, and so privacy, depend on zone order).
  The database keeps a backstop of its own — a Layout must be a document with a `zones`
  array and a Floor matching the row's floor columns — but it stops short of checking
  Zones, so that the schema has one implementation and not a second one in SQL. Anyone
  holding the (public) anon key can therefore still write well-shaped nonsense; making
  validation a real boundary means moving Layout writes behind the token server, which
  already loads the shared module from source.
- `supabase/tests/offices.rls.test.ts` proves the rules against a real database — owner
  writes succeed, strangers fail, a Visitor sees published Layouts and never a draft. It
  skips unless `.env` names a Supabase to run against.

Against a hosted project — the usual case:

```bash
npx supabase login
npx supabase link --project-ref <your-project-ref>
npm run db:push       # apply supabase/migrations
npm run config:push   # apply supabase/config.toml's auth settings (anonymous sign-ins,
                      # site URL, redirect allow-list) to that project
```

`supabase/config.toml` is the source of truth for those auth settings, so a change there
is pushed rather than clicked in the dashboard.

A local stack is optional, and the only way to read the magic-link email a test sends —
without one, that suite mints the link through the admin API instead:

```bash
npm run db:start   # local Supabase (Docker), applies supabase/migrations
npm run db:reset   # re-apply migrations from scratch
npm run db:stop
```

---

Stack below is the underlying starter template.

Starter template: **Vite + React + TypeScript + Tailwind CSS v4 + shadcn/ui**.

## Stack

- [Vite](https://vite.dev/) — dev server & build
- React 19 + TypeScript
- [Tailwind CSS v4](https://tailwindcss.com/) (via `@tailwindcss/vite`)
- [shadcn/ui](https://ui.shadcn.com/) — Radix-based components, Nova preset (Geist font)
- [sonner](https://sonner.emilkowal.ski/) — toasts

## Getting started

```bash
npm install
npm run dev      # start dev server
npm run build    # typecheck + production build
npm run preview  # preview the build
npm test         # run the test suite (Vitest)
```

## Adding components

```bash
npx shadcn@latest add <component>
# e.g.
npx shadcn@latest add dialog table tabs
```

Components land in `src/components/ui/`. Config lives in `components.json`.

## Path alias

`@` maps to `src/` (configured in `vite.config.ts` + `tsconfig`).

```ts
import { Button } from "@/components/ui/button"
```

## Included components

button, card, input, label, badge, sonner, dropdown-menu.

## Theming

CSS variables (light + `.dark`) in `src/index.css`. Toggle dark mode by adding
the `dark` class to `<html>`.
