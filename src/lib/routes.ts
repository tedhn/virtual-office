import { isSlug } from "./slug"

/**
 * What a URL means, as a value.
 *
 * An Office is addressed by its slug at the root of the site, so the whole route table
 * is: nothing is the home screen, one slug-shaped segment is an Office, that slug followed
 * by `edit` is its editor, and everything else is nowhere. That is small enough that a
 * router library would be more code than it replaces — and this way the mapping is a pure
 * function, testable without a browser.
 *
 * A segment that is not slug-shaped is `notFound` without asking the database, because
 * no Office can ever have answered to it.
 *
 * `edit` being a route under an Office rather than a query string or a mode flag is the
 * point of it: authoring is a place you go, separate from being present in the Office, and
 * it has its own address to leave and come back to.
 */
export type Route =
  | { kind: "home" }
  | { kind: "office"; slug: string }
  | { kind: "edit"; slug: string }
  | { kind: "notFound" }

/** The one segment an Office's own address can be followed by. */
const EDIT_SEGMENT = "edit"

export function routeOf(pathname: string): Route {
  const segments = pathname.split("/").filter(Boolean)
  if (segments.length === 0) return { kind: "home" }
  if (!isSlug(segments[0])) return { kind: "notFound" }
  if (segments.length === 1) return { kind: "office", slug: segments[0] }
  if (segments.length === 2 && segments[1] === EDIT_SEGMENT) {
    return { kind: "edit", slug: segments[0] }
  }
  return { kind: "notFound" }
}

/** Where an Office lives. The link people share. */
export function officePath(slug: string): string {
  return `/${slug}`
}

/** Where an Office is authored. Only its Owner can open it, which the database decides. */
export function editPath(slug: string): string {
  return `/${slug}/${EDIT_SEGMENT}`
}
