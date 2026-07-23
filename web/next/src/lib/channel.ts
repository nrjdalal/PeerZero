// The build channel, baked at build time. `next.config.ts` derives NEXT_PUBLIC_APP_CHANNEL from
// env.style's ENV_STYLES_ENV (production -> stable, preview -> canary, else local), so a single
// signal drives BOTH the favicon tint (env.style) and the in-app logo tint (below). Unset -> local.
export type AppChannel = "stable" | "canary" | "local"

const raw = process.env.NEXT_PUBLIC_APP_CHANNEL

export const appChannel: AppChannel = raw === "stable" || raw === "canary" ? raw : "local"

// The logo tile background per channel (env.style's palette): stable = the brand near-black,
// canary = amber, local/dev = blue. Lets you tell a stable install, a canary build, and a local
// dev build apart at a glance - matching the app's icon color on canary.
export const CHANNEL_COLOR: Record<AppChannel, string> = {
  stable: "#0a0a0a",
  canary: "#f59e0b",
  local: "#3b82f6",
}

export const channelColor = CHANNEL_COLOR[appChannel]
