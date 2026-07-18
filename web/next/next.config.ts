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

const nextConfig: NextConfig = {
  // Static SPA export: no Next server at runtime. The desktop shell (Tauri) serves these
  // files and the UI calls the local Hono API directly over http + ws at NEXT_PUBLIC_API_URL.
  // A static export cannot use rewrites, so the client always targets the absolute API URL.
  output: "export",
  images: { unoptimized: true },
  ...(appDevHost && { allowedDevOrigins: [appDevHost, `*.${appDevHost}`] }),
  reactCompiler: true,
}

export default nextConfig
