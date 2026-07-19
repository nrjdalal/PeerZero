import { createEnv } from "@t3-oss/env-core"
import { z } from "zod"

import "@/lib/utils"
import { NODE_ENV } from "@/lib/constants"

// Local-first: the public URLs default to the local app, so no env is needed to run or build.
export const env = createEnv({
  server: {
    NODE_ENV,
    INTERNAL_API_URL: z.url().optional(),
  },
  clientPrefix: "NEXT_PUBLIC_",
  client: {
    NEXT_PUBLIC_APP_URL: z.url().default("http://localhost:9410"),
    NEXT_PUBLIC_API_URL: z.url().default("http://localhost:9336"),
    NEXT_PUBLIC_NODE_ENV: NODE_ENV,
  },
  runtimeEnv: {
    NODE_ENV: process.env.NODE_ENV,
    INTERNAL_API_URL: process.env.INTERNAL_API_URL,
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    NEXT_PUBLIC_NODE_ENV: process.env.NODE_ENV,
  },
  emptyStringAsUndefined: true,
})
