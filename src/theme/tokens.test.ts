import { describe, expect, it } from "vitest"
import { readTokenBlock } from "./tokens"

const CSS = `
:root {
    --background: oklch(0.972 0.006 85);
    /* a comment between two tokens */
    --foreground: oklch(0.28 0.028 55);
    --radius: 0.625rem;
}

.dark {
    --background: oklch(0.21 0.012 60);
    --border: oklch(1 0 0 / 12%);
}

@layer base {
  body { color: red; }
}
`

describe("Reading a block of tokens out of a stylesheet", () => {
  it("returns every custom property the block declares", () => {
    expect(readTokenBlock(CSS, ":root")).toEqual({
      "--background": "oklch(0.972 0.006 85)",
      "--foreground": "oklch(0.28 0.028 55)",
      "--radius": "0.625rem",
    })
  })

  it("keeps the blocks apart, so a theme's override is its own", () => {
    expect(readTokenBlock(CSS, ".dark")["--background"]).toBe("oklch(0.21 0.012 60)")
  })

  it("does not leak a token from one block into another", () => {
    expect(readTokenBlock(CSS, ".dark")["--foreground"]).toBeUndefined()
    expect(readTokenBlock(CSS, ":root")["--border"]).toBeUndefined()
  })

  it("throws for a selector the stylesheet does not have, rather than reporting it empty", () => {
    // An empty object would read as "this theme declares nothing", which is a passing
    // result for every assertion a caller could make about it.
    expect(() => readTokenBlock(CSS, ".sepia")).toThrow(/\.sepia/)
  })
})
