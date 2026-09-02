import { isSlug } from "./slug"

/**
 * What a URL means, as a value.
 *
 * An Office is addressed by its slug at the root of the site, so the whole route table
 * is: nothing is the home screen, one slug-shaped segment is an Office, everything else
 * is nowhere. That is small enough that a router library would be more code than it
 * replaces — and this way the mapping is a pure function, testable without a browser.
 * The moment a second kind of page appears, revisit that.
 *
 * A segment that is not slug-shaped is `notFound` without asking the database, because
 * no Office can ever have answered to it.
 */
export type Route =
  | { kind: "home" }
  | { kind: "office"; slug: string }
  | { kind: "notFound" }

export function routeOf(pathname: string): Route {
  const segments = pathname.split("/").filter(Boolean)
  if (segments.length === 0) return { kind: "home" }
  if (segments.length === 1 && isSlug(segments[0])) return { kind: "office", slug: segments[0] }
  return { kind: "notFound" }
}

/** Where an Office lives. The link people share. */
export function officePath(slug: string): string {
  return `/${slug}`
}
