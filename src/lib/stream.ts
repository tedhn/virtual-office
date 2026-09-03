import { StreamVideoClient, type User } from "@stream-io/video-react-sdk"

const API_KEY = import.meta.env.VITE_STREAM_API_KEY as string | undefined
// Base URL for the token server. Empty -> same origin (dev proxy / single-service prod).
// Set VITE_API_URL when the token server is hosted separately from the frontend.
const API_BASE = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, "") ?? ""

interface TokenResponse {
  apiKey: string
  token: string
}

/**
 * Ask our token server for a Stream JWT. Secret never touches the browser.
 *
 * `office` is the slug of the Office being walked into: the server mints only for one
 * that exists and is published, so a token cannot be had for an Office that isn't there.
 */
async function fetchToken(userId: string, office: string): Promise<TokenResponse> {
  const res = await fetch(`${API_BASE}/api/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId, office }),
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => "")
    throw new Error(`token request failed (${res.status}): ${detail}`)
  }
  return res.json()
}

/**
 * Create a connected StreamVideoClient for the given user.
 * Uses the token-provider form so the SDK can refresh the token itself.
 */
export async function createClient(
  userId: string,
  userName: string,
  office: string,
): Promise<StreamVideoClient> {
  const { apiKey, token } = await fetchToken(userId, office)
  // Prefer the key returned by the server; fall back to the build-time env key.
  const resolvedKey = apiKey || API_KEY
  if (!resolvedKey) {
    throw new Error("No Stream API key. Set VITE_STREAM_API_KEY (or return it from /api/token).")
  }

  const user: User = { id: userId, name: userName }

  return new StreamVideoClient({
    apiKey: resolvedKey,
    user,
    token,
    // Re-fetch on expiry so long sessions don't drop.
    tokenProvider: async () => (await fetchToken(userId, office)).token,
  })
}
