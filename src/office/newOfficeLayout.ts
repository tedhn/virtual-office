// Relative imports carry an explicit `.ts` extension, in case this module is ever pulled
// into the graph the server loads from source. See ADR-0004.
import type { Layout } from "./layout.ts"
import { FLOOR } from "./types.ts"

/** The Spawn Zone a new Office is given, centred on its empty Floor. */
const SPAWN = { x: 0.3, y: 0.45, w: 0.4, h: 0.1 }

/**
 * What an Owner gets the moment they name an Office: an empty Floor with a single Spawn
 * Zone on it, and nothing else to walk into.
 *
 * The Spawn Zone is not decoration — an Office with no Spawn is one nobody can arrive in,
 * which is why publishing refuses it (see `layoutSchema.ts`). Starting with one means a
 * new Office is publishable from its first moment rather than after an errand.
 *
 * A function rather than a constant: this Layout is the Owner's to edit from here on, and
 * every Office handing back edits to one shared object is a bug waiting for the editor.
 */
export function newOfficeLayout(): Layout {
  return {
    floor: { ...FLOOR },
    zones: [{ id: "spawn", kind: "spawn", rect: { ...SPAWN } }],
  }
}
