import { getSafeEnv } from "@packages/env"
import { env } from "@packages/env/web-next"
import type { NextConfig } from "next"

getSafeEnv(env, "@web/next")

// Dev-only: Next 16 blocks cross-origin dev requests; behind portless the browser Host is a named .localhost subdomain, so allow the app's base domain and its subdomains. A single `*` (one label) is enough: the web dev server only ever sees its own host, portless-prefixed with the worktree branch as a single leftmost label.
const appDevHost = (() => {
  try {
    return new URL(env.NEXT_PUBLIC_APP_URL).hostname.split(".").slice(-2).join(".")
  } catch {
    return undefined
  }
})()

const nextConfig: NextConfig = {
  output: "standalone",
  ...(appDevHost && { allowedDevOrigins: [appDevHost, `*.${appDevHost}`] }),
  reactCompiler: true,
  // Proxy the browser's same-origin /api/* calls to the local Hono server.
  rewrites: async () => {
    return [
      {
        source: "/api/:path*",
        destination: `${env.INTERNAL_API_URL || env.NEXT_PUBLIC_API_URL}/api/:path*`,
      },
    ]
  },
}

export default nextConfig
