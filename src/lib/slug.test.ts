import { describe, expect, it } from "vitest"
import { randomTail } from "./randomTail"
import { isSlug, slugCandidates, slugFrom, SLUG_MAX_LENGTH } from "./slug"

describe("Recognising a slug", () => {
  it("accepts lowercase words joined by single hyphens", () => {
    expect(isSlug("acme")).toBe(true)
    expect(isSlug("acme-hq")).toBe(true)
    expect(isSlug("acme-hq-2")).toBe(true)
  })

  it("refuses anything a shared link could be ambiguous about", () => {
    expect(isSlug("Acme")).toBe(false)
    expect(isSlug("acme hq")).toBe(false)
    expect(isSlug("acme--hq")).toBe(false)
    expect(isSlug("-acme")).toBe(false)
    expect(isSlug("acme-")).toBe(false)
    expect(isSlug("acme/hq")).toBe(false)
    expect(isSlug("")).toBe(false)
  })

  it("refuses the addresses the server already answers to", () => {
    // An Office here would be permanently unreachable, and a slug is permanent.
    expect(isSlug("api")).toBe(false)
    expect(isSlug("ws")).toBe(false)
    expect(isSlug("assets")).toBe(false)
    expect(isSlug("api-hq")).toBe(true)
  })

  it("holds a slug to the length the database also holds it to", () => {
    expect(isSlug("ab")).toBe(false)
    expect(isSlug("abc")).toBe(true)
    expect(isSlug("a".repeat(SLUG_MAX_LENGTH))).toBe(true)
    expect(isSlug("a".repeat(SLUG_MAX_LENGTH + 1))).toBe(false)
  })
})

describe("The slug a name asks for", () => {
  it("is the name, lowercased and hyphenated", () => {
    expect(slugFrom("Acme HQ")).toBe("acme-hq")
    expect(slugFrom("  Fourth  Floor  ")).toBe("fourth-floor")
    expect(slugFrom("Ted's Office!")).toBe("ted-s-office")
  })

  it("keeps a name that is already a slug intact", () => {
    expect(slugFrom("acme-hq")).toBe("acme-hq")
  })

  it("reads accented letters as the letters they are", () => {
    expect(slugFrom("Café Berlin")).toBe("cafe-berlin")
  })

  it("falls back to a word rather than to nothing", () => {
    expect(slugFrom("🏢")).toBe("office")
    expect(slugFrom("   ")).toBe("office")
  })

  it("appends a tail when given one, so a taken slug can be tried again", () => {
    expect(slugFrom("Acme HQ", "k3f9")).toBe("acme-hq-k3f9")
    expect(slugFrom("🏢", "k3f9")).toBe("office-k3f9")
  })

  it("stays inside the length limit, tail and all", () => {
    const long = "z".repeat(200)
    expect(isSlug(slugFrom(long))).toBe(true)
    expect(isSlug(slugFrom(long, "k3f9"))).toBe(true)
    expect(slugFrom(long, "k3f9").endsWith("-k3f9")).toBe(true)
  })

  it("never truncates onto a trailing hyphen", () => {
    // The cut lands exactly on the hyphen between the two words.
    const name = `${"z".repeat(SLUG_MAX_LENGTH - 1)} tail`
    expect(slugFrom(name)).toBe("z".repeat(SLUG_MAX_LENGTH - 1))
  })
})

describe("The slugs a name is tried under", () => {
  const tails = () => {
    let n = 0
    return () => `t${n++}`
  }

  it("asks for the bare name first, then the same name with a tail", () => {
    expect(slugCandidates("Acme HQ", tails())).toEqual([
      "acme-hq",
      "acme-hq-t0",
      "acme-hq-t1",
      "acme-hq-t2",
      "acme-hq-t3",
    ])
  })

  it("drops a bare candidate that is not a usable slug", () => {
    // "Hi" is too short to be a slug on its own, so only the tailed forms are offered.
    expect(slugCandidates("Hi", tails())).toEqual(["hi-t0", "hi-t1", "hi-t2", "hi-t3"])
  })

  it("never offers an address the server owns, however the Office is named", () => {
    expect(slugCandidates("API", tails())).toEqual([
      "api-t0",
      "api-t1",
      "api-t2",
      "api-t3",
    ])
  })

  it("only ever offers usable slugs", () => {
    for (const name of ["Acme HQ", "Hi", "🏢", "z".repeat(200)]) {
      for (const candidate of slugCandidates(name, randomTail)) {
        expect(isSlug(candidate)).toBe(true)
      }
    }
  })
})
