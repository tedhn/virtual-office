import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { contrastRatio, oklchToSrgb, over, parseColor, type Oklch, type Srgb } from "./contrast"
import { readTokenBlock } from "./tokens"

/**
 * The palette, checked where it is written.
 *
 * These are the ticket's acceptance criteria as assertions: a colour was chosen for every
 * role, and every piece of text that lands on a surface can be read on it. A palette is
 * the kind of thing that is correct on the day it is written and quietly wrong three edits
 * later, so the rules are here rather than in a reviewer's head.
 */
const CSS = readFileSync(fileURLToPath(new URL("../index.css", import.meta.url)), "utf8")
const LIGHT = readTokenBlock(CSS, ":root")
const DARK = readTokenBlock(CSS, ".dark")

/** WCAG AA for body text: anything under 18.66px bold or 24px plain, which is all of ours. */
const AA_TEXT = 4.5
/** WCAG AA for the boundary of a control you are meant to find and aim at. */
const AA_UI = 3

/** Tokens naming a Floor colour rather than a chrome one — see the Floor block below. */
const isFloorToken = (name: string) => /^--(floor|zone)-/.test(name)

/**
 * The three tokens allowed to be a true neutral.
 *
 * The rule below exists to catch a colour nobody chose. White is a colour somebody chose:
 * the chrome's ground is white and bright on purpose, and giving it a token whisper of
 * chroma to satisfy a test would be the test dictating the design. Every other role has to
 * have been picked, which is what the rule is for.
 */
const NEUTRAL_BY_CHOICE = new Set(["--background", "--card", "--popover"])

/** A token's colour, or a failure naming the token. Never a silent pass on a missing one. */
function color(tokens: Record<string, string>, name: string): Oklch {
  const raw = tokens[name]
  expect(raw, `${name} is not declared`).toBeDefined()
  const parsed = parseColor(raw)
  expect(parsed, `${name} is \`${raw}\`, which is not an oklch colour`).not.toBeNull()
  return parsed!
}

/**
 * What a reader actually sees, which is not always what a token says.
 *
 * Several tokens are translucent — a border at 12%, a HUD panel over the Floor — so each
 * layer is resolved onto the one behind it before anything is measured. `ground` is what
 * the whole stack sits on: the page for chrome, the Floor's surface for anything drawn on
 * the Floor.
 */
function reads(
  tokens: Record<string, string>,
  fg: Oklch | string,
  bg: Oklch | string,
  ground: Oklch | string = "--background",
): number {
  const resolve = (c: Oklch | string) => (typeof c === "string" ? color(tokens, c) : c)
  const base: Srgb = oklchToSrgb(resolve(ground))
  const behind = over(resolve(bg), base)
  return contrastRatio(over(resolve(fg), behind), behind)
}

const THEMES: [string, Record<string, string>][] = [
  ["light", LIGHT],
  ["dark", DARK],
]

describe("The palette is chosen rather than left at its defaults", () => {
  it.each(THEMES)("has no colourless placeholder anywhere in %s", (_theme, tokens) => {
    const colourless = Object.entries(tokens)
      .filter(([name]) => !NEUTRAL_BY_CHOICE.has(name))
      .filter(([, value]) => value.startsWith("oklch("))
      .filter(([, value]) => parseColor(value)?.c === 0)
      .map(([name]) => name)
    expect(colourless).toEqual([])
  })

  it.each(THEMES)("gives the four load-bearing roles a hue in %s", (_theme, tokens) => {
    for (const role of ["--primary", "--secondary", "--accent", "--muted"]) {
      expect(color(tokens, role).c, `${role} has no chroma`).toBeGreaterThan(0)
    }
  })

  it("gives both themes the same set of chrome colours, so neither is half a theme", () => {
    // Colours only. A token like `--radius` is the same number in either theme and is
    // declared once; a colour that exists in one block and not the other is a role the
    // dark reader sees in the light palette's value.
    const colours = (tokens: Record<string, string>) =>
      Object.keys(tokens)
        .filter((name) => !isFloorToken(name))
        .filter((name) => parseColor(tokens[name]) !== null)
        .sort()
    expect(colours(DARK)).toEqual(colours(LIGHT))
  })
})

describe("Text meets AA against the surface it sits on", () => {
  const PAIRS: [string, string][] = [
    ["--foreground", "--background"],
    ["--card-foreground", "--card"],
    ["--popover-foreground", "--popover"],
    ["--primary-foreground", "--primary"],
    ["--secondary-foreground", "--secondary"],
    ["--accent-foreground", "--accent"],
    ["--muted-foreground", "--muted"],
    ["--muted-foreground", "--background"],
    ["--muted-foreground", "--card"],
    // Every error message in the app is `text-destructive` on one of these two.
    ["--destructive", "--background"],
    ["--destructive", "--card"],
  ]

  for (const [theme, tokens] of THEMES) {
    it.each(PAIRS)(`reads %s on %s in ${theme}`, (fg, bg) => {
      expect(reads(tokens, fg, bg)).toBeGreaterThanOrEqual(AA_TEXT)
    })

    it(`reads a destructive button's label on its own tint in ${theme}`, () => {
      // `Button variant="destructive"` is destructive text on a 10% destructive wash, not
      // white on a solid red — so the tint is what the label has to be read against.
      const wash = { ...color(tokens, "--destructive"), alpha: theme === "dark" ? 0.2 : 0.1 }
      expect(reads(tokens, "--destructive", wash)).toBeGreaterThanOrEqual(AA_TEXT)
    })
  }
})

describe("Controls are findable without reading their label", () => {
  for (const [theme, tokens] of THEMES) {
    it(`outlines an input against the page in ${theme}`, () => {
      expect(reads(tokens, "--input", "--background")).toBeGreaterThanOrEqual(AA_UI)
    })

    it(`shows the focus ring against the page in ${theme}`, () => {
      expect(reads(tokens, "--ring", "--background")).toBeGreaterThanOrEqual(AA_UI)
    })

    it(`shows a primary button against the page in ${theme}`, () => {
      expect(reads(tokens, "--primary", "--background")).toBeGreaterThanOrEqual(AA_UI)
    })
  }
})

describe("Chrome drawn on the Floor rather than on the page", () => {
  /**
   * The in-Office toolbar, the chat bar and the mobile controls are ordinary chrome
   * Buttons and Inputs — but they float on the Floor, which has no theme and is always
   * dark. They wear a `.dark` class for exactly that reason (ADR-0012), so it is the dark
   * palette, not the reader's, that has to hold up against the Floor's surface.
   *
   * Without this block a reader in the light theme got a Leave button coloured for white
   * and drawn on a dark room, and every assertion above still passed: they all measure
   * against `--background`, which is the one surface these controls never touch.
   */
  const FLOOR = () => color(LIGHT, "--floor-surface")

  it.each([
    ["--foreground", "--background"],
    ["--primary-foreground", "--primary"],
    ["--secondary-foreground", "--secondary"],
    ["--muted-foreground", "--background"],
  ])("reads %s on %s there", (fg, bg) => {
    expect(reads(DARK, fg, bg, FLOOR())).toBeGreaterThanOrEqual(AA_TEXT)
  })

  it("reads the Leave button, which is destructive text on its own wash", () => {
    const wash = { ...color(DARK, "--destructive"), alpha: 0.2 }
    expect(reads(DARK, "--destructive", wash, FLOOR())).toBeGreaterThanOrEqual(AA_TEXT)
  })

  it("shows the default action, whose colour is the whole signal", () => {
    expect(reads(DARK, "--primary", FLOOR(), FLOOR())).toBeGreaterThanOrEqual(AA_UI)
  })

  it("reads what is typed into the chat bar, and shows the field it is typed into", () => {
    // The bar is `bg-background/95` over the Floor rather than over the page.
    const bar = { ...color(DARK, "--background"), alpha: 0.95 }
    expect(reads(DARK, "--foreground", bar, FLOOR())).toBeGreaterThanOrEqual(AA_TEXT)
    expect(reads(DARK, "--input", bar, FLOOR())).toBeGreaterThanOrEqual(AA_UI)
  })
})

describe("The Floor is one dark surface in either theme", () => {
  /** Everything on the Floor is read against the Floor, never against the page. */
  const onFloor = (fg: Oklch | string, bg: Oklch | string = "--floor-surface") =>
    reads(LIGHT, fg, bg, "--floor-surface")

  it("keeps the Floor's colours out of the theme blocks", () => {
    // The Floor is a surface, not a theme: it is the same dark playfield whichever theme
    // the chrome is in, so a `.dark` override would be a second answer to a settled
    // question — and the one that only some readers ever see.
    expect(Object.keys(DARK).filter(isFloorToken)).toEqual([])
  })

  it("draws a grid visible on the surface it is drawn on", () => {
    // The bug this exists to stop: a hardcoded black gridline, invisible the moment the
    // Floor stopped being light.
    const surface = color(LIGHT, "--floor-surface")
    expect(contrastRatio(over(color(LIGHT, "--floor-grid"), oklchToSrgb(surface)), surface))
      .toBeGreaterThan(1.08)
  })

  it("reads a Zone's label against the Floor", () => {
    expect(onFloor("--floor-label")).toBeGreaterThanOrEqual(AA_TEXT)
  })

  it("reads a HUD panel's text against the panel", () => {
    expect(onFloor("--floor-panel-foreground", "--floor-panel")).toBeGreaterThanOrEqual(AA_TEXT)
  })

  it("reads the Join prompt over a Room", () => {
    expect(onFloor("--floor-prompt-foreground", "--floor-prompt")).toBeGreaterThanOrEqual(AA_TEXT)
  })

  it("reads a Zone's label on the Zones that carry one", () => {
    for (const zone of ["--zone-room-private", "--zone-room-nonprivate", "--zone-table", "--zone-dining"]) {
      expect(onFloor("--floor-label", zone), `label on ${zone}`).toBeGreaterThanOrEqual(AA_TEXT)
    }
  })

  it("reads a name in the chat log, whoever said it", () => {
    for (const speaker of ["--floor-chat-you", "--floor-chat-peer"]) {
      expect(onFloor(speaker, "--floor-panel"), speaker).toBeGreaterThanOrEqual(AA_TEXT)
    }
  })

  it("reads a speaking Avatar's name on the badge it turns into", () => {
    expect(onFloor("--floor-panel-foreground", "--floor-speaking-label")).toBeGreaterThanOrEqual(
      AA_TEXT,
    )
  })

  it("shows an Avatar's status badges, which are a glyph and no words", () => {
    for (const badge of ["--floor-alert", "--floor-share"]) {
      expect(onFloor("--floor-panel-foreground", badge), badge).toBeGreaterThanOrEqual(AA_UI)
    }
  })

  it("shows the marks drawn over the Floor rather than on a Zone", () => {
    for (const mark of ["--floor-you", "--floor-speaking", "--floor-select", "--floor-control-knob"]) {
      expect(onFloor(mark), mark).toBeGreaterThanOrEqual(AA_UI)
    }
  })

  it("shows every Zone kind against the Floor it sits on", () => {
    // A Zone the Owner placed has to be visible as a thing on the Floor, or the Layout
    // they authored is not the Layout anyone sees.
    for (const zone of [
      "--zone-wall",
      "--zone-exterior",
      "--zone-room-private",
      "--zone-room-nonprivate",
      "--zone-table",
      "--zone-dining",
    ]) {
      expect(onFloor(zone), `${zone} against the Floor`).toBeGreaterThan(1.08)
    }
  })
})
