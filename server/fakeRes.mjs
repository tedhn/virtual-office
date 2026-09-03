/**
 * The Express response these routes actually use — `status` and `json` — recorded instead
 * of sent.
 *
 * Shared between the suites that call a route directly, so "what did it answer" means the
 * same thing in both: `sent.status` is 200 unless a route said otherwise, which is exactly
 * what Express assumes too.
 */
export function fakeRes() {
  const sent = { status: 200, body: undefined }
  const res = {
    status(code) {
      sent.status = code
      return res
    },
    json(body) {
      sent.body = body
      return res
    },
  }
  return { res, sent }
}
