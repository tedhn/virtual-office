import path from "path"
import { defineConfig } from "vitest/config"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    host: true, // listen on 0.0.0.0 -> reachable on LAN / via tunnel
    allowedHosts: true, // accept forwarded Host headers (cloudflared/ngrok)
    proxy: {
      "/api": "http://localhost:3001",
      "/ws": { target: "ws://localhost:3001", ws: true },
    },
  },
  test: {
    // Geometry is pure maths over numbers — no DOM, so no jsdom dependency to install.
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
})
