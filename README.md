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
