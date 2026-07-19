// End-to-end test for the app's backend: the real Hono API driving the in-process WebTorrent
// engine (src/lib/torrent/webtorrent.mjs) - the same path the Next UI takes, now with no separate
// sidecar and no HTTP hop.
//
// The WebRTC stub is preloaded via api/hono/bunfig.toml's [test].preload, so node-datachannel is
// never imported (its native binary is absent under CI's `bun install --ignore-scripts`; uTP
// degrades on its own via webtorrent's utp.cjs try/catch). Nothing here waits on the BitTorrent
// swarm: a magnet's infohash is parsed offline and every lifecycle action round-trips through the
// in-process engine without needing peers, so the test is deterministic.

import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

// The engine boots at import and reads HOME (for ~/.peerzero state) + TORRENT_DOWNLOAD_DIR at
// module init, so isolate them here at module top - before any import can pull in webtorrent.mjs.
const home = mkdtempSync(join(tmpdir(), "pz-e2e-home-"))
const downloadDir = mkdtempSync(join(tmpdir(), "pz-e2e-dl-"))
process.env.SKIP_ENV_VALIDATION = "true" // dummy-fill server vars the app doesn't need here
process.env.NODE_ENV = "test"
process.env.REGISTRY_SYNC_URL = "off" // no background registry fetch during the test
process.env.HOME = home
process.env.TORRENT_DOWNLOAD_DIR = downloadDir

// Sintel (Blender open movie) - a real, legal, well-known magnet. We only use its infohash,
// which parse-torrent derives offline; we never wait for its swarm.
const MAGNET =
  "magnet:?xt=urn:btih:08ada5a7a6183aae1e09d831df6748d566095a10&dn=Sintel&tr=udp%3A%2F%2Fexplodie.org%3A6969"
const INFOHASH = "08ada5a7a6183aae1e09d831df6748d566095a10"

// server.fetch is the same handler Bun serves in production (default export of src/index.ts).
let call: (path: string, init?: RequestInit) => Promise<Response>

beforeAll(async () => {
  // Importing the app boots the in-process engine (webtorrent client + state restore) against the
  // isolated HOME set above. Outside Vercel, createServer() returns the Bun serve shape { fetch }.
  const server = (await import("@/index")).default as {
    fetch: (req: Request) => Response | Promise<Response>
  }
  call = (path, init) => Promise.resolve(server.fetch(new Request(`http://local${path}`, init)))
}, 60_000) // cold WebTorrent import on a CI runner can take well past bun's 5s default hook timeout

afterAll(async () => {
  // Destroy the WebTorrent client (stops the DHT/trackers/timers) so the test process exits cleanly.
  const wt = await import("@/lib/torrent/webtorrent.mjs")
  await wt.destroyClient?.()
  for (const dir of [home, downloadDir]) if (dir) rmSync(dir, { recursive: true, force: true })
})

describe("app e2e: Hono API -> in-process engine", () => {
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
})
