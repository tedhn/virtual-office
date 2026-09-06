import { describe, expect, it } from "vitest"
import type { Zone } from "./layout"
import { seatAppearance, zoneAppearance } from "./zoneAppearance"

const zone = (over: Partial<Zone> & Pick<Zone, "kind">): Zone => ({
  id: "z1",
  rect: { x: 0, y: 0, w: 0.2, h: 0.2 },
  ...over,
})

const PRIVATE_ROOM = zone({ kind: "room", private: true, label: "Booth" })
const NONPRIVATE_ROOM = zone({ kind: "room", label: "Lobby" })
const EVERY_KIND = [
  PRIVATE_ROOM,
  NONPRIVATE_ROOM,
  zone({ kind: "table" }),
  zone({ kind: "table", style: "dining", label: "Lunch" }),
  zone({ kind: "wall" }),
  zone({ kind: "spawn" }),
  zone({ kind: "exterior" }),
]

describe("What a Zone is painted with", () => {
  it.each(EVERY_KIND)("takes $kind's colours from named tokens", (z) => {
    // The point of the tokens: repainting a Floor is one edit to the stylesheet, not a
    // hunt through the call sites for an opacity somebody guessed at.
    expect(zoneAppearance(z).className).not.toMatch(/black\/|white\/|bg-(neutral|amber|cyan)-/)
    expect(zoneAppearance(z).className).toMatch(/(zone|floor)-/)
  })

  it("gives each kind its own fill, so no two kinds are the same thing to look at", () => {
    const fills = EVERY_KIND.map((z) => zoneAppearance(z).className)
    expect(new Set(fills).size).toBe(EVERY_KIND.length)
  })
})

describe("Telling a private Room from a non-private one", () => {
  // A private Room isolates the audio, video and chat of everyone inside it. Whether you
  // are about to walk into one is not something to signal with a hue alone — anyone who
  // cannot separate the two hues would be walking into a private Room unawares.
  const priv = zoneAppearance(PRIVATE_ROOM)
  const nonprivate = zoneAppearance(NONPRIVATE_ROOM)

  it("draws the private one's wall solid and the non-private one's broken", () => {
    expect(priv.borderStyle).toBe("solid")
    expect(nonprivate.borderStyle).toBe("dashed")
  })

  it("marks each with its own glyph, so neither is merely the absence of the other", () => {
    expect(priv.mark).toBe("private")
    expect(nonprivate.mark).toBe("nonprivate")
    expect(priv.mark).not.toBe(nonprivate.mark)
  })

  it("still tints them differently, since colour is a channel too", () => {
    expect(priv.className).not.toBe(nonprivate.className)
  })

  it("says the same thing about a Room whose privacy is written as an explicit false", () => {
    expect(zoneAppearance(zone({ kind: "room", private: false }))).toEqual(nonprivate)
  })
})

describe("Telling a taken Seat from a free one", () => {
  const taken = seatAppearance({ taken: true, sittable: false })
  const free = seatAppearance({ taken: false, sittable: true })

  it("fills the taken one and leaves the free one hollow", () => {
    // Asserted on the class that paints it rather than on a flag beside it: a flag no
    // renderer reads would go on passing this after the fill was dropped.
    expect(taken.className).toMatch(/(^|\s)bg-zone-seat-taken(\s|$)/)
    expect(free.className).not.toMatch(/(^|\s)bg-/)
  })

  it("draws the free one's ring broken, the way an empty chair is an invitation", () => {
    expect(free.borderStyle).toBe("dashed")
    expect(taken.borderStyle).toBe("solid")
  })

  it("takes its colours from named tokens as well", () => {
    for (const skin of [taken, free]) {
      expect(skin.className).not.toMatch(/black\/|white\//)
      expect(skin.className).toMatch(/zone-seat/)
    }
  })

  it("offers a hover only on a Seat that can actually be taken", () => {
    expect(free.className).toMatch(/hover:/)
    expect(seatAppearance({ taken: false, sittable: false }).className).not.toMatch(/hover:/)
    expect(taken.className).not.toMatch(/hover:/)
  })
})
