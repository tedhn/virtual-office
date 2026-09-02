import { describe, expect, it } from "vitest"
import { supabaseConfig } from "./offices.mjs"

describe("Finding the Supabase to ask", () => {
  it("takes the server-side pair when it is set", () => {
    expect(
      supabaseConfig({ SUPABASE_URL: "https://a.supabase.co", SUPABASE_PUBLISHABLE_KEY: "sb_pub" }),
    ).toEqual({ url: "https://a.supabase.co", key: "sb_pub" })
  })

  it("falls back to the browser pair, so one .env configures both halves of the app", () => {
    expect(
      supabaseConfig({
        VITE_SUPABASE_URL: "https://a.supabase.co",
        VITE_SUPABASE_PUBLISHABLE_KEY: "sb_pub",
      }),
    ).toEqual({ url: "https://a.supabase.co", key: "sb_pub" })
  })

  it("still reads the key under the name Supabase gave it before the rename", () => {
    expect(
      supabaseConfig({ SUPABASE_URL: "https://a.supabase.co", SUPABASE_ANON_KEY: "anon" }),
    ).toEqual({ url: "https://a.supabase.co", key: "anon" })
  })

  it("reports nothing rather than half a configuration", () => {
    expect(supabaseConfig({})).toBe(null)
    expect(supabaseConfig({ SUPABASE_URL: "https://a.supabase.co" })).toBe(null)
    expect(supabaseConfig({ SUPABASE_PUBLISHABLE_KEY: "sb_pub" })).toBe(null)
  })
})
