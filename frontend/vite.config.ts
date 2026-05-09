import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"

// Vite's dev server runs on 5173; the backend runs on 5000. Without a proxy,
// the browser would block POST /auth/login as cross-origin. The proxy makes
// the backend look same-origin from the frontend's perspective, so the API
// client can use plain relative paths like "/auth/login" or
// "/integrations/agent/run". Production deploys would solve same-origin
// differently (reverse proxy, single-domain hosting).
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/auth": "http://localhost:5000",
      "/integrations": "http://localhost:5000",
      "/health": "http://localhost:5000",
    },
  },
})
