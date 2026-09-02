import { describe, expect, it } from "vitest"
import { officePath, routeOf } from "./routes"

describe("Reading a URL", () => {
  it("takes the root for the home screen", () => {
    expect(routeOf("/")).toEqual({ kind: "home" })
    expect(routeOf("")).toEqual({ kind: "home" })
  })

  it("takes a single slug-shaped segment for an Office", () => {
    expect(routeOf("/acme-hq")).toEqual({ kind: "office", slug: "acme-hq" })
    expect(routeOf("/acme-hq/")).toEqual({ kind: "office", slug: "acme-hq" })
  })

  it("takes anything else for nowhere, rather than guessing", () => {
    // Not slug-shaped: these can never be an Office's address, so there is nothing to
    // look up and no reason to make the database say so.
    expect(routeOf("/Acme")).toEqual({ kind: "notFound" })
    expect(routeOf("/ab")).toEqual({ kind: "notFound" })
    expect(routeOf("/acme%20hq")).toEqual({ kind: "notFound" })
    expect(routeOf("/acme-hq/settings")).toEqual({ kind: "notFound" })
  })
})

describe("Writing an Office's URL", () => {
  it("is the slug, at the root", () => {
    expect(officePath("acme-hq")).toBe("/acme-hq")
  })

  it("round-trips with reading one", () => {
    expect(routeOf(officePath("acme-hq"))).toEqual({ kind: "office", slug: "acme-hq" })
  })
})
