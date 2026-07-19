import { serve, upgradeWebSocket as nodeUpgradeWebSocket } from "@hono/node-server"
import { env } from "@packages/env/api-hono"
import type { Hono } from "hono"
import { upgradeWebSocket as bunUpgradeWebSocket, websocket } from "hono/bun"
import { WebSocketServer } from "ws"

// Vercel Functions can't run Bun.serve(), so on Vercel we serve WebSockets through the Node adapter (@hono/node-server + ws); everywhere else (local, Docker/self-host) Bun.serve() owns the socket via hono/bun.
const onVercel = process.env.VERCEL === "1"

// Both adapters accept the same handler factory; the cast collapses their otherwise non-unionable signatures to one callable type. Registered on a route in index.ts.
export const upgradeWebSocket = onVercel
  ? (nodeUpgradeWebSocket as typeof bunUpgradeWebSocket)
  : bunUpgradeWebSocket

// On Vercel, return the Node http.Server so the platform drives all traffic including the WebSocket upgrade; elsewhere return the Bun.serve() shape so Bun owns fetch + the socket. Both honor process.env.PORT when set (Vercel, or portless assigning a dev port), else HONO_PORT.
export const createServer = (app: Hono) => {
  const port = process.env.PORT ? Number(process.env.PORT) : env.HONO_PORT
  // Bind loopback by default (mirrors the engine's HOST handling) so a port collision - e.g. a
  // stray desktop backend already listening on 127.0.0.1 - fails loudly with EADDRINUSE instead
  // of silently co-binding a different address family (IPv6 wildcard) and letting the proxy route
  // traffic to the wrong server. Containers set HOST=0.0.0.0 to be reachable externally. The
  // desktop sidecar drives its own Bun.serve, so this hostname never applies there.
  const hostname = process.env.HOST || "127.0.0.1"
  return onVercel
    ? serve({
        fetch: app.fetch,
        port,
        websocket: { server: new WebSocketServer({ noServer: true }) },
      })
    : {
        fetch: app.fetch,
        port,
        hostname,
        websocket,
      }
}
