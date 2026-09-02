import type { Layout } from "./layout.ts"
import { FLOOR } from "./types.ts"

/**
 * The office this app ships with — a fixture standing in for the Layout an Owner will
 * eventually author, not the geometry module's only reality. Everything that needs a
 * floorplan takes one as an argument; this is simply the one currently handed in.
 *
 * Coordinates are normalized (0..1) against `floor`. The footprint is an L: the main
 * office is the tall block to the right of x≈0.34; the two non-private Rooms (T1, T2 —
 * the building's toilets) jut out top-left, OUTSIDE the main office; the bottom-left is
 * left empty.
 *
 * Open-plan interior: only Rooms have walls; the rest is open floor with the
 * dining-styled table D up top, three work tables down the right, and the Spawn Zone in
 * the corridor beside the tables where Visitors arrive.
 */
export const DEFAULT_LAYOUT: Layout = {
  floor: FLOOR,
  zones: [
    { id: "wall-beside-c-top", kind: "wall", rect: { x: 0.0, y: 0.28, w: 0.3, h: 0.008 } },
    { id: "wall-beside-c-bottom", kind: "wall", rect: { x: 0.0, y: 0.512, w: 0.3, h: 0.008 } },
    { id: "t4", kind: "table", seats: 2, rect: { x: 0.0, y: 0.29, w: 0.3, h: 0.05 } },
    { id: "T1", kind: "room", private: false, label: "MT", rect: { x: 0.0, y: 0.0, w: 0.155, h: 0.07 } },
    { id: "T2", kind: "room", private: false, label: "FT", rect: { x: 0.0, y: 0.11, w: 0.263, h: 0.06 } },
    { id: "wall-toilet-right", kind: "wall", rect: { x: 0.267, y: 0.03, w: 0.018, h: 0.142 } },
    { id: "wall-male-right", kind: "wall", rect: { x: 0.160, y: 0.0, w: 0.018, h: 0.07 } },
    { id: "wall-toilet-bottom", kind: "wall", rect: { x: 0.0, y: 0.172, w: 0.286, h: 0.008 } },
    { id: "D", kind: "table", style: "dining", label: "D", rect: { x: 0.56, y: 0.07, w: 0.3, h: 0.11 } },
    { id: "C", kind: "room", private: true, label: "C", rect: { x: 0.5, y: 0.28, w: 0.5, h: 0.24 } },
    { id: "t1", kind: "table", rect: { x: 0.5, y: 0.58, w: 0.5, h: 0.05 } },
    { id: "t2", kind: "table", rect: { x: 0.5, y: 0.68, w: 0.5, h: 0.05 } },
    { id: "t3", kind: "table", rect: { x: 0.5, y: 0.78, w: 0.5, h: 0.05 } },
    // Arrivals scatter in the open corridor beside the tables: below room C, above A/B,
    // left of the work tables — so nobody starts inside a Room or on a chair.
    { id: "spawn", kind: "spawn", rect: { x: 0.08, y: 0.66, w: 0.24, h: 0.08 } },
    { id: "A", kind: "room", private: true, label: "A", rect: { x: 0.0, y: 0.88, w: 0.5, h: 0.12 } },
    { id: "B", kind: "room", private: true, label: "B", rect: { x: 0.5, y: 0.88, w: 0.5, h: 0.12 } },
  ],
}
