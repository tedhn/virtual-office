/**
 * Where the token server is.
 *
 * Empty means the same origin, which is the ordinary case: the Vite dev proxy stands in
 * front of it locally, and one service serves both the app and the API in production.
 * `VITE_API_URL` is for a deployment that hosts them apart.
 */
const API_BASE = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, "") ?? ""

/** An endpoint on the token server. `path` starts with a slash. */
export function apiUrl(path: string): string {
  return `${API_BASE}${path}`
}
