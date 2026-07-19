// End-to-end test for the app's backend: the real Hono API driving the real torrent-engine
// sidecar (api/torrent-engine) over its local HTTP seam - the same path the Next UI takes.
//
// It boots the actual engine subprocess (Bun + WebTorrent, WebRTC/uTP disabled) against an
// isolated state + download dir, then exercises health, the registry-backed sources list, and
// the full add -> list -> pause -> resume -> delete torrent lifecycle. Nothing here waits on
// the BitTorrent swarm: a magnet's infohash is parsed offline and every lifecycle action
// round-trips through the engine without needing peers, so the test is deterministic.

import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

// Env must be set before the app (and its validated env module) is imported below.
const ENGINE_PORT = 6399 // fixed test port, distinct from dev's default
const ENGINE_URL = `http://127.0.0.1:${ENGINE_PORT}`
process.env.SKIP_ENV_VALIDATION = "true" // dummy-fill server vars the app doesn't need here
process.env.NODE_ENV = "test"
process.env.TORRENT_ENGINE_URL = ENGINE_URL
process.env.REGISTRY_SYNC_URL = "off" // no background registry fetch during the test

// Sintel (Blender open movie) - a real, legal, well-known magnet. We only use its infohash,
// which parse-torrent derives offline; we never wait for its swarm.
const MAGNET =
  "magnet:?xt=urn:btih:08ada5a7a6183aae1e09d831df6748d566095a10&dn=Sintel&tr=udp%3A%2F%2Fexplodie.org%3A6969"
const INFOHASH = "08ada5a7a6183aae1e09d831df6748d566095a10"

const ENGINE_DIR = join(import.meta.dir, "../../torrent-engine")

let engine: ReturnType<typeof Bun.spawn> | undefined
let home = ""
let downloadDir = ""
// server.fetch is the same handler Bun serves in production (default export of src/index.ts).
let call: (path: string, init?: RequestInit) => Promise<Response>

async function waitUntil(fn: () => Promise<boolean>, timeoutMs: number, label: string) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await fn().catch(() => false)) return
    await Bun.sleep(250)
  }
  throw new Error(`timed out after ${timeoutMs}ms waiting for ${label}`)
}

beforeAll(async () => {
  home = mkdtempSync(join(tmpdir(), "pz-e2e-home-"))
  downloadDir = mkdtempSync(join(tmpdir(), "pz-e2e-dl-"))

  // Spawn the real engine under Bun. Preload the WebRTC stub explicitly (rather than relying on
  // bunfig.toml discovery, which doesn't apply to this spawned process) so node-datachannel is
  // never imported - it has no try/catch and its native binary is absent under CI's
  // `bun install --ignore-scripts`. uTP degrades on its own (webtorrent's utp.cjs try/catch).
  // HOME is isolated so the engine's ~/.peerzero state never touches the developer's.
  engine = Bun.spawn(["bun", "--preload", "./src/webrtc-stub.mjs", "src/index.mjs"], {
    cwd: ENGINE_DIR,
    env: {
      ...process.env,
      TORRENT_ENGINE_PORT: String(ENGINE_PORT),
      TORRENT_DOWNLOAD_DIR: downloadDir,
      HOME: home,
    },
    stdout: "ignore",
    stderr: "inherit", // surface a boot failure (e.g. a missing dep) in the test log
  })

  await waitUntil(
    async () => (await fetch(`${ENGINE_URL}/health`)).ok,
    45_000,
    "torrent-engine to become healthy",
  )

  // Import the app only after env + engine are ready. Outside Vercel, createServer() returns the
  // Bun serve shape ({ fetch, ... }) - the same handler Bun serves in production.
  const server = (await import("@/index")).default as {
    fetch: (req: Request) => Response | Promise<Response>
  }
  call = (path, init) => Promise.resolve(server.fetch(new Request(`http://local${path}`, init)))
}, 60_000) // cold WebTorrent import on a CI runner can take well past bun's 5s default hook timeout

afterAll(() => {
  engine?.kill()
  for (const dir of [home, downloadDir]) {
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

describe("app e2e: Hono API -> torrent-engine", () => {
  test("GET /api/health reports ok", async () => {
    const res = await call("/api/health")
    expect(res.status).toBe(200)
    const { data } = (await res.json()) as { data: { message: string; environment: string } }
    expect(data.message).toBe("ok")
    expect(data.environment).toBe("test")
  })

  test("GET /api/torrents/sources lists providers from the committed registry", async () => {
    const res = await call("/api/torrents/sources")
    expect(res.status).toBe(200)
    const { data } = (await res.json()) as { data: { providers: Array<{ name: string }> } }
    expect(Array.isArray(data.providers)).toBe(true)
    expect(data.providers.length).toBeGreaterThan(0)
    // apibay (The Pirate Bay) is a fixture provider in the committed registry.
    expect(data.providers.map((p) => p.name)).toContain("apibay")
  })

  test("torrent lifecycle: add -> list -> pause -> resume -> delete", async () => {
    // add
    const add = await call("/api/torrents", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ magnet: MAGNET }),
    })
    expect(add.status).toBe(200)
    const added = ((await add.json()) as { data: { torrent: { infoHash: string } } }).data.torrent
    expect(added.infoHash).toBe(INFOHASH)

    // list contains it
    const listed = (
      (await (await call("/api/torrents")).json()) as {
        data: { torrents: Array<{ infoHash: string }> }
      }
    ).data.torrents
    expect(listed.some((t) => t.infoHash === INFOHASH)).toBe(true)

    // pause
    const paused = (
      (await (await call(`/api/torrents/${INFOHASH}/pause`, { method: "POST" })).json()) as {
        data: { torrent: { paused: boolean } }
      }
    ).data.torrent
    expect(paused.paused).toBe(true)

    // resume
    const resumed = (
      (await (await call(`/api/torrents/${INFOHASH}/resume`, { method: "POST" })).json()) as {
        data: { torrent: { paused: boolean } }
      }
    ).data.torrent
    expect(resumed.paused).toBe(false)

    // delete (destroy the on-disk store since it's a throwaway)
    const del = await call(`/api/torrents/${INFOHASH}?destroyStore=true`, { method: "DELETE" })
    expect(del.status).toBe(200)
    expect(((await del.json()) as { data: { ok: boolean } }).data.ok).toBe(true)

    // gone from the list
    const after = (
      (await (await call("/api/torrents")).json()) as {
        data: { torrents: Array<{ infoHash: string }> }
      }
    ).data.torrents
    expect(after.some((t) => t.infoHash === INFOHASH)).toBe(false)
  }, 30_000) // add waits up to ~8s for the engine's early-snapshot fallback when offline

  test("display name: cosmetic PATCH persists; canonical name + reveal untouched", async () => {
    type Snap = { infoHash: string; name: string; displayName?: string }
    const add = await call("/api/torrents", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ magnet: MAGNET }),
    })
    const added = ((await add.json()) as { data: { torrent: Snap } }).data.torrent
    expect(added.infoHash).toBe(INFOHASH)
    const originalName = added.name
    // A new torrent starts with only its original name; the engine never auto-generates a
    // display name (that's the frontend's job), so displayName is unset here.
    expect(typeof originalName).toBe("string")
    expect(added.displayName).toBeUndefined()

    // PATCH a locally-generated display name.
    const patched = (
      (await (
        await call(`/api/torrents/${INFOHASH}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ displayName: "Sintel (2010)" }),
        })
      ).json()) as { data: { torrent: Snap } }
    ).data.torrent
    // Snapshot returns BOTH the canonical name (unchanged) and the optional displayName.
    expect(patched.name).toBe(originalName)
    expect(patched.displayName).toBe("Sintel (2010)")

    // The list snapshot carries the displayName too.
    const one = (
      (await (await call("/api/torrents")).json()) as { data: { torrents: Snap[] } }
    ).data.torrents.find((t) => t.infoHash === INFOHASH)
    expect(one?.name).toBe(originalName)
    expect(one?.displayName).toBe("Sintel (2010)")

    // Persisted to disk, so a restart restores it (and the restore path never regenerates).
    const state = JSON.parse(readFileSync(join(home, ".peerzero", "state.json"), "utf8")) as {
      torrents: Array<{ infoHash: string; name: string; displayName?: string | null }>
    }
    const saved = state.torrents.find((t) => t.infoHash === INFOHASH)
    expect(saved?.displayName).toBe("Sintel (2010)")
    expect(saved?.name).toBe(originalName) // canonical name is what gets persisted for FS ops

    // Reveal targets the real folder by canonical name; the display name never reaches it.
    const reveal = await call(`/api/torrents/${INFOHASH}/reveal`, { method: "POST" })
    expect(((await reveal.json()) as { data: { ok: boolean } }).data.ok).toBe(true)

    // An empty display name is rejected at the API boundary (invalid values never persist).
    const bad = await call(`/api/torrents/${INFOHASH}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ displayName: "   " }),
    })
    expect(bad.status).toBe(400)

    await call(`/api/torrents/${INFOHASH}?destroyStore=true`, { method: "DELETE" })
  }, 30_000)

  // Regression: the desktop app calls this API cross-origin (tauri://localhost -> 127.0.0.1), so
  // the rename's PATCH triggers a CORS preflight. If PATCH is missing from allowMethods the
  // browser silently blocks it while direct fetches (like the test above) still pass - exactly
  // how the display-name rename first broke. Guard the preflight so a method can't drop out.
  test("CORS preflight advertises PATCH for a cross-origin rename", async () => {
    const preflight = await call(`/api/torrents/${INFOHASH}`, {
      method: "OPTIONS",
      headers: { origin: "http://127.0.0.1:9337", "access-control-request-method": "PATCH" },
    })
    const allowed = (preflight.headers.get("access-control-allow-methods") ?? "")
      .split(",")
      .map((m) => m.trim())
    expect(allowed).toContain("PATCH")
  })
})
