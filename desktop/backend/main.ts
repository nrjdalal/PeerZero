// Combined desktop backend: one Bun process that runs the Hono API (with the in-process
// WebTorrent engine) and, optionally, serves the static UI, so the whole app ships as a single
// self-contained binary (see build.ts). Under Tauri the shell serves the UI and this binary is
// the API-only sidecar; run standalone with PZ_FRONTEND_DIR to also serve the UI in a browser.
//
// The API binds an ephemeral loopback port (an OS-assigned free port, the pattern most local
// desktop servers use) instead of a fixed one: a fixed port lets a second - or stale - instance
// collide, and the survivor's UI could end up talking to the wrong backend. We print the chosen
// port as `PZ_API_PORT=<port>` so the Tauri shell can inject it into the webview at runtime (it
// sets window.__PEERZERO_API_URL__, which the frontend prefers over its baked default). PZ_PORT
// still pins the port for Docker/tests.
import { createServer } from "node:net"

import { serveStatic } from "./serve-static"

// Ask the OS for a free loopback port: bind :0, read the assigned port, release it. There is a
// tiny window between release and re-bind, but on single-user loopback that never bites in
// practice, and it lets us know the port before importing the bundle (which needs it in env).
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer()
    probe.once("error", reject)
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address()
      probe.close(() =>
        address && typeof address === "object"
          ? resolve(address.port)
          : reject(new Error("could not resolve a free port")),
      )
    })
  })
}

const API_PORT = process.env.PZ_PORT ? Number(process.env.PZ_PORT) : await freePort()

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
// desktop sidecar always binds our chosen loopback port.
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

// Machine-readable handshake the Tauri shell parses (src-tauri/src/lib.rs) to learn which port
// to point the webview at. Keep the exact `PZ_API_PORT=<port>` shape in sync with that parser.
console.log(`PZ_API_PORT=${API_PORT}`)
console.log(`[desktop] app on http://127.0.0.1:${API_PORT} (webtorrent engine in-process)`)
if (FRONTEND_DIR) console.log(`[desktop] serving UI from ${FRONTEND_DIR}`)
