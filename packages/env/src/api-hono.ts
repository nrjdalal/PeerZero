import { createEnv } from "@t3-oss/env-core"
import { z } from "zod"

import "@/lib/utils"
import { NODE_ENV } from "@/lib/constants"
import { polyfillServer } from "@/lib/polyfill"

export const env = createEnv({
  server: {
    NODE_ENV,
    AGENT_SIGNIN_ENABLED: z.stringbool().default(false),
    HONO_APP_URL: z.url(),
    HONO_PORT: z.coerce.number().default(4000),
    HONO_RATE_LIMIT: z.coerce.number().default(60),
    HONO_RATE_LIMIT_WINDOW_MS: z.coerce.number().default(60000),
    HONO_TRUSTED_ORIGINS: z
      .string()
      .transform((s) => s.split(",").map((v) => v.trim().replace(/\/$/, "")))
      .pipe(z.array(z.url())),
    // Base URL of the local WebTorrent engine sidecar (api/torrent-engine).
    TORRENT_ENGINE_URL: z.url().default("http://127.0.0.1:4444"),
    // Encoded registry the app refreshes from at runtime. The bundled registry.json is
    // the instant answer; this is fetched in the background on a TTL so a running app
    // picks up new trackers/directory/providers without a git pull. Set to any non-URL
    // value (e.g. "off") to disable runtime sync.
    REGISTRY_SYNC_URL: z
      .string()
      .default(
        "https://raw.githubusercontent.com/nrjdalal/PeerZero/canary/api/hono/src/lib/torrent/registry.json",
      ),
  },
  runtimeEnv: {
    NODE_ENV: process.env.NODE_ENV,
    AGENT_SIGNIN_ENABLED: process.env.AGENT_SIGNIN_ENABLED,
    HONO_APP_URL: polyfillServer(process.env.HONO_APP_URL, "https://polyfill.url"),
    HONO_PORT: process.env.HONO_PORT,
    HONO_RATE_LIMIT: process.env.HONO_RATE_LIMIT,
    HONO_RATE_LIMIT_WINDOW_MS: process.env.HONO_RATE_LIMIT_WINDOW_MS,
    HONO_TRUSTED_ORIGINS: polyfillServer(process.env.HONO_TRUSTED_ORIGINS, "https://polyfill.url"),
    TORRENT_ENGINE_URL: process.env.TORRENT_ENGINE_URL,
    REGISTRY_SYNC_URL: process.env.REGISTRY_SYNC_URL,
  },
  emptyStringAsUndefined: true,
})
