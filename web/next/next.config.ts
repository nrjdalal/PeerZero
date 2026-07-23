import { getSafeEnv } from "@packages/env"
import { env } from "@packages/env/web-next"
import { withEnvStyles } from "env.style"
import type { NextConfig } from "next"

getSafeEnv(env, "@web/next")

// One build signal drives every per-environment cue: env.style's ENV_STYLES_ENV. We map it to the
// app channel and expose it as NEXT_PUBLIC_APP_CHANNEL so the in-app logo tints to match env.style's
// favicon tint (see lib/channel.ts + components/common/logo.tsx). production -> stable (brand black),
// preview -> canary (amber), anything else (incl. `next dev`) -> local (blue).
const appChannel =
  process.env.ENV_STYLES_ENV === "production"
    ? "stable"
    : process.env.ENV_STYLES_ENV === "preview"
      ? "canary"
      : "local"

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
  env: { NEXT_PUBLIC_APP_CHANNEL: appChannel },
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

// env.style tints the favicon per environment (its own ENV_STYLES_ENV detection). Colors match the
// logo palette above: development = blue, preview (canary) = amber; production keeps the brand mark.
export default withEnvStyles(nextConfig, {
  color: {
    development: "#3b82f6",
    preview: "#f59e0b",
  },
})
