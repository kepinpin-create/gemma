import { fileURLToPath } from "node:url"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  // The API runs on :8000; proxying keeps the browser on one origin, so the session cookie just works.
  server: { port: 5173, proxy: { "/api": "http://127.0.0.1:8000" } },
})
