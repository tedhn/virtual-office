import type { CSSProperties } from "react"
import { GRID_PX } from "./types"

/**
 * The Floor's own surface, in one place because it is drawn twice: `FloorCanvas` fits a
 * whole Floor into a box to be looked at, and `OfficeFloor` scrolls a zoomed one under the
 * person standing on it. They had the same border, radius, ground and grid written out
 * separately, which is how the two came to disagree — a Floor previewed on the join screen
 * and the same Floor walked on were not quite the same colour.
 *
 * Dark in either theme, and deliberately not a `dark:` variant of anything. The Floor is
 * the surface being looked at rather than the chrome around it: Avatars, live camera
 * circles and Zone tints all read against dark, and a playfield that inverted with the
 * reader's system preference would be two different products. See the palette comment in
 * `index.css`.
 */
export const FLOOR_SURFACE =
  "relative overflow-hidden rounded-surface border-2 border-floor-edge bg-floor-surface"

/**
 * The grid, drawn in the Floor's own token rather than a hardcoded black.
 *
 * It was `rgba(0,0,0,.06)` with no dark counterpart, which was invisible the moment the
 * Floor stopped being light — `palette.test.ts` now refuses a grid that cannot be seen on
 * the surface it is drawn on. The pitch is `GRID_PX`, the same number a dragged Zone edge
 * snaps to, so the lines are landable as well as visible.
 */
export const FLOOR_GRID: CSSProperties = {
  backgroundImage:
    "linear-gradient(to right, var(--floor-grid) 1px, transparent 1px), " +
    "linear-gradient(to bottom, var(--floor-grid) 1px, transparent 1px)",
  backgroundSize: `${GRID_PX}px ${GRID_PX}px`,
}
