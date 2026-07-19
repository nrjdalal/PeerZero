import { getSafeEnv } from "@packages/env"
import { env } from "@packages/env/web-next"
import type { NextConfig } from "next"

getSafeEnv(env, "@web/next")

// Dev-only: Next 16 blocks cross-origin dev requests; behind portless the browser Host is a named .localhost subdomain, so allow the app's base domain and its subdomains.
const appDevHost = (() => {
  try {
    return new URL(env.NEXT_PUBLIC_APP_URL).hostname.split(".").slice(-2).join(".")
  } catch {
    return undefined
  }
})()

// The desktop build (Tauri) sets NEXT_OUTPUT=export to emit a static SPA it serves from the
// webview. Everything else - `bun run dev/build/start`, Docker, hosted - keeps the standalone
// SSR server and the /api proxy exactly as before, so desktop packaging stays isolated from
// the web deploy.
const staticExport = process.env.NEXT_OUTPUT === "export"

const nextConfig: NextConfig = {
  output: staticExport ? "export" : "standalone",
  ...(staticExport && { images: { unoptimized: true } }),
  ...(appDevHost && { allowedDevOrigins: [appDevHost, `*.${appDevHost}`] }),
  reactCompiler: true,
  // Proxy the browser's same-origin /api/* calls to the local Hono server. A static export
  // has no server, so it is omitted there and the client calls the absolute NEXT_PUBLIC_API_URL.
  ...(!staticExport && {
    rewrites: async () => {
      return [
        {
          source: "/api/:path*",
          destination: `${env.INTERNAL_API_URL || env.NEXT_PUBLIC_API_URL}/api/:path*`,
        },
      ]
    },
  }),
}

export default nextConfig
