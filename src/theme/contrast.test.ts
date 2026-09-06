import { describe, expect, it } from "vitest"
import { contrastRatio, oklchToSrgb, over, parseColor } from "./contrast"

describe("Reading an oklch token", () => {
  it("reads lightness, chroma and hue", () => {
    expect(parseColor("oklch(0.545 0.118 197)")).toEqual({
      l: 0.545,
      c: 0.118,
      h: 197,
      alpha: 1,
    })
  })

  it("reads the alpha a token writes as a percentage", () => {
    expect(parseColor("oklch(1 0 0 / 10%)")?.alpha).toBeCloseTo(0.1)
  })

  it("reads the alpha a token writes as a fraction", () => {
    expect(parseColor("oklch(0.2 0 0 / 0.35)")?.alpha).toBeCloseTo(0.35)
  })

  it("treats a missing hue as zero, which is what a grey is", () => {
    expect(parseColor("oklch(0.97 0 0)")).toEqual({ l: 0.97, c: 0, h: 0, alpha: 1 })
  })

  it("refuses anything that is not an oklch colour, rather than guessing at it", () => {
    expect(parseColor("#ffffff")).toBeNull()
    expect(parseColor("var(--primary)")).toBeNull()
  })
})

describe("Turning oklch into the sRGB a screen shows", () => {
  it("puts white at the top of every channel", () => {
    const white = oklchToSrgb({ l: 1, c: 0, h: 0, alpha: 1 })
    expect(white.r).toBeCloseTo(1, 3)
    expect(white.g).toBeCloseTo(1, 3)
    expect(white.b).toBeCloseTo(1, 3)
  })

  it("puts black at the bottom of every channel", () => {
    const black = oklchToSrgb({ l: 0, c: 0, h: 0, alpha: 1 })
    expect(black.r).toBeCloseTo(0, 3)
    expect(black.g).toBeCloseTo(0, 3)
    expect(black.b).toBeCloseTo(0, 3)
  })

  it("keeps a chroma-0 colour grey, all three channels together", () => {
    const grey = oklchToSrgb({ l: 0.556, c: 0, h: 0, alpha: 1 })
    expect(grey.g).toBeCloseTo(grey.r, 3)
    expect(grey.b).toBeCloseTo(grey.r, 3)
  })

  it("clamps a colour outside the sRGB gamut instead of returning a channel over 1", () => {
    // A chroma no screen can show. The number still has to be a colour afterwards.
    const beyond = oklchToSrgb({ l: 0.6, c: 0.5, h: 30, alpha: 1 })
    for (const channel of [beyond.r, beyond.g, beyond.b]) {
      expect(channel).toBeGreaterThanOrEqual(0)
      expect(channel).toBeLessThanOrEqual(1)
    }
  })
})

describe("Contrast between two colours", () => {
  const WHITE = { l: 1, c: 0, h: 0, alpha: 1 }
  const BLACK = { l: 0, c: 0, h: 0, alpha: 1 }

  it("puts black on white at the ratio the spec caps at", () => {
    expect(contrastRatio(BLACK, WHITE)).toBeCloseTo(21, 1)
  })

  it("reads the same either way round, since neither colour is the foreground", () => {
    expect(contrastRatio(WHITE, BLACK)).toBeCloseTo(contrastRatio(BLACK, WHITE), 6)
  })

  it("puts a colour against itself at 1", () => {
    expect(contrastRatio(WHITE, WHITE)).toBeCloseTo(1, 6)
  })

})

describe("Resolving a translucent colour onto what is behind it", () => {
  const WHITE_GROUND = { r: 1, g: 1, b: 1 }

  it("leaves an opaque colour exactly as it was", () => {
    const solid = { l: 0.5, c: 0.1, h: 200, alpha: 1 }
    expect(over(solid, WHITE_GROUND)).toEqual(oklchToSrgb(solid))
  })

  it("returns the backdrop when the colour in front is fully transparent", () => {
    const backdrop = { r: 0.2, g: 0.3, b: 0.4 }
    expect(over({ l: 1, c: 0, h: 0, alpha: 0 }, backdrop)).toEqual(backdrop)
  })

  it("lands between the two when the colour in front is half there", () => {
    expect(over({ l: 1, c: 0, h: 0, alpha: 0.5 }, { r: 0, g: 0, b: 0 }).r).toBeCloseTo(0.5, 3)
  })
})
