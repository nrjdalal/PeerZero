// Combined desktop backend: one Bun process that runs the Hono API (with the in-process
// WebTorrent engine) and, optionally, serves the static UI, so the whole app ships as a single
// self-contained binary (see build.ts). Under Tauri the shell serves the UI and this binary is
// the API-only sidecar; run standalone with PZ_FRONTEND_DIR to also serve the UI in a browser.
//
// The API port is loopback-only and fixed so the statically-exported frontend (which bakes
// NEXT_PUBLIC_API_URL at build time) always knows where the API is.
import { serveStatic } from "./serve-static"

const API_PORT = Number(process.env.PZ_PORT || 9336)

// Set every env the Hono modules read BEFORE importing the bundle (env is validated at module
// init). Use unconditional `=` (not `||=`): Bun auto-loads any .env in the cwd first, so `||=`
// would keep a stray dev value (e.g. HONO_TRUSTED_ORIGINS) and break CORS for the Tauri webview.
process.env.NODE_ENV = "production"
process.env.HONO_PORT = String(API_PORT)
// Same-origin (browser) plus the Tauri webview origins, so CORS passes in both shells.
process.env.HONO_TRUSTED_ORIGINS = [
  `http://127.0.0.1:${API_PORT}`,
  `http://localhost:${API_PORT}`,
  "tauri://localhost",
  "http://tauri.localhost",
].join(",")
// Hono reads PORT/HOST first - portless injects them in dev. Clear any inherited values so the
// desktop sidecar always binds our fixed loopback port.
delete process.env.PORT
delete process.env.HOST

// Load the pre-built Hono bundle. Importing it boots the in-process WebTorrent engine and gives us
// the Bun.serve config ({ fetch, websocket }); it does NOT start a server (only an entry's default
// export auto-serves), so we drive it ourselves below.
const hono = (await import("../../api/hono/bundle/index.mjs")).default as {
  fetch: (req: Request, server: unknown) => Response | Promise<Response>
  websocket: unknown
}

// Optional: serve the static export too, so the binary alone is a runnable app.
const FRONTEND_DIR = process.env.PZ_FRONTEND_DIR

Bun.serve({
  port: API_PORT,
  hostname: "127.0.0.1",
  websocket: hono.websocket as never,
  async fetch(req, server) {
    const { pathname } = new URL(req.url)
    if (pathname === "/api" || pathname.startsWith("/api/")) {
      return hono.fetch(req, server)
    }
    if (FRONTEND_DIR) return serveStatic(pathname, FRONTEND_DIR)
    return new Response("Not found", { status: 404 })
  },
})

console.log(`[desktop] app on http://127.0.0.1:${API_PORT} (webtorrent engine in-process)`)
if (FRONTEND_DIR) console.log(`[desktop] serving UI from ${FRONTEND_DIR}`)
