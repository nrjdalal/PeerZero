// Derives each app's public URLs from portless's PORTLESS_URL (worktree branch included) and injects them before spawning the real dev command; a transparent pass-through when PORTLESS_URL is unset (PORTLESS=0, CI).

// Toggle the adjacent `api.` label (it sits just before the two base labels) to get a sibling
// app's host, and insert `engine.` the same way for the torrent-engine sidecar. Assumes the
// `<name>` / `api.<name>` / `engine.<name>` naming from the package.json `portless.name`s
// (convert.ts keeps forks in sync) and a single-label worktree prefix; a branch literally named
// `api` would be misread as the api host. Update this if that scheme changes.
export function deriveUrls(portlessUrl: string): { web: string; api: string; engine: string } {
  const labels = new URL(portlessUrl).hostname.split(".")
  const apiIdx = labels.length - 3
  const isApi = apiIdx >= 0 && labels[apiIdx] === "api"
  const webLabels = isApi ? labels.toSpliced(apiIdx, 1) : labels
  // Insert a sibling label just before the base name, mirroring the api scheme so the worktree
  // branch prefix carries over to every app's host.
  const sibling = (name: string) => webLabels.toSpliced(webLabels.length - 2, 0, name)
  const apiLabels = isApi ? labels : sibling("api")
  const engineLabels = sibling("engine")
  const toOrigin = (host: string[]) => {
    const url = new URL(portlessUrl)
    url.hostname = host.join(".")
    return url.origin
  }
  return { web: toOrigin(webLabels), api: toOrigin(apiLabels), engine: toOrigin(engineLabels) }
}

if (import.meta.main) {
  const cmd = process.argv.slice(2)
  if (cmd.length === 0) {
    console.error("portless: no command given")
    process.exit(1)
  }

  const overrides: Record<string, string> = {}
  const portlessUrl = process.env.PORTLESS_URL
  if (portlessUrl) {
    const { web, api, engine } = deriveUrls(portlessUrl)
    overrides.NEXT_PUBLIC_APP_URL = web
    overrides.NEXT_PUBLIC_API_URL = api
    overrides.HONO_TRUSTED_ORIGINS = web
    // The Hono API reaches the sidecar through the proxy at its derived engine host; the engine
    // itself registers this host by running under portless (see api/torrent-engine/package.json).
    overrides.TORRENT_ENGINE_URL = engine
  }

  const proc = Bun.spawn(cmd, {
    env: { ...process.env, ...overrides },
    stdio: ["inherit", "inherit", "inherit"],
  })
  const stop = () => proc.kill()
  process.on("SIGINT", stop)
  process.on("SIGTERM", stop)
  process.exit((await proc.exited) ?? 1)
}
