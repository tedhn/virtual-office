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

For identity and offices, point the app at a Supabase project (see **Identity and
offices** below): its URL and anon key go in `.env`, and `npm run db:push` applies
`supabase/migrations` to it.

Open two browser windows, join with different names, allow mic access, and walk one
avatar toward the other (WASD / arrow keys) to hear the proximity audio.

### How it works

- `server/index.mjs` — Express token server (:3001). Mints Stream JWTs; the API secret
  never reaches the browser.
- `server/relay.mjs` — the WebSocket fan-out for positions and chat, and the one place
  chat isolation is enforced: a message reaches only sockets whose reported position
  shares the sender's room-context. It computes that from `src/office/layout.ts`, loaded
  straight from TypeScript source (see ADR-0004), so privacy has a single implementation.
  `relay.test.mjs` drives a real socket server and covers the isolation rules.
- `src/office/` — the world: `useMovement` (keyboard + broadcast via
  `call.sendCustomEvent`), `usePositions` (`call.on('custom')` → remote positions),
  `useProximityAudio` (distance → `speaker.setParticipantVolume`), and the floor / avatars.
- `src/office/layout.ts` — the geometry: room-context resolution, spawn scatter, seat
  derivation and collision. Every function takes the `Layout` (floor dimensions + zones)
  it operates on, so an office's floorplan is data rather than code. A zone is one of five
  kinds — room, table, wall, spawn, exterior — with privacy and table styling as flags on
  the zone. `defaultLayout.ts` holds the floorplan this app currently ships;
  `layout.test.ts` covers the geometry.
- Everyone joins one call (`default:office-main`), mic on / camera off.

### Identity and offices

- **Visiting takes no account.** `src/auth/session.ts` signs a Visitor in anonymously as
  the page loads, and the Supabase client persists that session — so a refresh brings
  back the same person, not a stranger. **Creating** an Office needs a magic-link
  account, because an Office outlives the browser storage an anonymous identity lives in
  (ADR-0003). `AccountSignIn` is the second door; the join form is untouched.
- `supabase/migrations/` — the `offices` table: owner, permanent slug, name, floor
  dimensions, the published and draft Layouts, and a layout version the database bumps
  itself on every publish. A Layout is one JSON document (ADR-0001).
- **Row-level security is the boundary.** The table is owner-only for every operation.
  Row-level security filters rows and a draft is a *column*, so the public read surface
  is the `offices_public` view, which has no draft column to leak and shows only
  published Offices. Creating an Office is refused outright for an anonymous identity.
- `src/lib/offices.ts` — the write path. A Layout is validated against
  `src/office/layoutSchema.ts` before a request is issued: a draft only has to be
  well-formed, publishing also has to describe an Office a Visitor can arrive in.
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
