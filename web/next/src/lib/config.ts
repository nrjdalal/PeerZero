import { BUILD_VERSION } from "@packages/env"
import { env } from "@packages/env/web-next"

// Server-only env var: SSR reaches the local Hono server directly; the browser goes through Next's /api rewrite.
const getInternalApiUrl = () => {
  if (typeof window === "undefined") {
    return env.INTERNAL_API_URL
  }
  return undefined
}

// The desktop shell binds the API to an ephemeral port and injects the resulting URL as
// window.__PEERZERO_API_URL__ (via a Tauri initialization script, before any app JS runs), since a
// dynamic port cannot be baked at build time. Prefer it when present; fall back to the baked env.
const getApiUrl = () => {
  if (typeof window !== "undefined") {
    const injected = (window as { __PEERZERO_API_URL__?: string }).__PEERZERO_API_URL__
    if (injected) return injected
  }
  return env.NEXT_PUBLIC_API_URL
}

export const config = {
  // Runtime / env-derived app values (NOT brand, brand lives in @packages/config/site)
  app: {
    url: env.NEXT_PUBLIC_APP_URL,
    version: BUILD_VERSION,
  },

  // API configuration
  api: {
    url: getApiUrl(),
    internalUrl: getInternalApiUrl(),
  },
} as const
