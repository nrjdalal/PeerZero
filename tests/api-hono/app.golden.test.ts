// Golden suite for the @api/hono backend + its in-process WebTorrent engine - every reachable HTTP
// path and behavior, driven through the real request handler (server.fetch), the same path the UI
// takes. Golden files under ./golden are the committed canonical responses; volatile fields
// (versions, temp paths, magnet trackers, timestamps, network stats) are normalized before
// matching. Regenerate intended changes with UPDATE_GOLDEN=1.
//
// The suite runs via run.ts, which isolates HOME + the download dir and seeds a completed-torrent
// fixture first (see fixtures/seed.ts + tests/README.md). It absorbs the old app.e2e.test.ts
// lifecycle coverage. One engine boots for the whole file, so tests are ordered read -> mutate and
// the fixture (never deleted) backs the /stream cases.
import { beforeAll, describe, expect, test } from "bun:test"

import {
  FIXTURE_ADDED_AT,
  FIXTURE_NAME,
  FIXTURE_SIZE,
  fixtureContent,
} from "./fixtures/constants.ts"
import { matchGolden, matchGoldenBytes } from "./lib/golden.ts"

// Sintel (Blender open movie): a real, legal magnet. Only its infohash is used (parsed offline);
// we never wait on its swarm - it stays "connecting" and backs the add/pause/resume/delete cases.
const MAGNET =
  "magnet:?xt=urn:btih:08ada5a7a6183aae1e09d831df6748d566095a10&dn=Sintel&tr=udp%3A%2F%2Fexplodie.org%3A6969"
const SINTEL = "08ada5a7a6183aae1e09d831df6748d566095a10"

type Snapshot = {
  infoHash: string
  name: string
  magnetURI: string
  length: number
  downloaded: number
  uploaded: number
  downloadSpeed: number
  uploadSpeed: number
  progress: number
  numPeers: number
  seeders: number
  timeRemaining: number | null
  ratio: number
  done: boolean
  ready: boolean
  syncing: boolean
  paused: boolean
  addedAt: number
  downloadDir: string
  files: {
    name: string
    path: string
    index: number
    length: number
    deselected: boolean
    downloaded: number
    progress: number
  }[]
}

let call: (path: string, init?: RequestInit) => Promise<Response>
let fixtureHash: string

async function json(path: string, init?: RequestInit) {
  const res = await call(path, init)
  return { status: res.status, body: (await res.json()) as any }
}

async function list(): Promise<Snapshot[]> {
  return (await json("/api/torrents")).body.data.torrents
}

// Stable projection of a torrent snapshot: mask identity/path/time/network fields that vary run to
// run, keep the deterministic contract (flags, sizes, files, and the fixture's fixed addedAt).
function normalize(t: Snapshot) {
  return {
    infoHash: "<infohash>",
    name: t.name === t.infoHash ? "<pending-name>" : t.name,
    magnetURI: "<magnet>",
    length: t.length,
    downloaded: t.downloaded,
    uploaded: t.uploaded,
    downloadSpeed: t.downloadSpeed,
    uploadSpeed: t.uploadSpeed,
    progress: t.progress,
    numPeers: t.numPeers,
    seeders: t.seeders,
    timeRemaining: t.timeRemaining,
    ratio: t.ratio,
    done: t.done,
    ready: t.ready,
    syncing: t.syncing,
    paused: t.paused,
    addedAt: t.addedAt === FIXTURE_ADDED_AT ? t.addedAt : "<ts>",
    downloadDir: "<downloadDir>",
    files: t.files.map((f) => ({ ...f, path: f.path.split(/[/\\]/).pop() })),
  }
}

function streamHeaders(res: Response) {
  return {
    status: res.status,
    "content-type": res.headers.get("content-type"),
    "content-length": res.headers.get("content-length"),
    "content-range": res.headers.get("content-range"),
    "accept-ranges": res.headers.get("accept-ranges"),
  }
}

beforeAll(async () => {
  const server = (await import("@/index")).default as { fetch: (r: Request) => Promise<Response> }
  call = (path, init) => Promise.resolve(server.fetch(new Request(`http://local${path}`, init)))
  for (let i = 0; i < 80; i++) {
    const f = (await list()).find((t) => t.name === FIXTURE_NAME && t.ready)
    if (f) {
      fixtureHash = f.infoHash
      break
    }
    await Bun.sleep(250)
  }
  if (!fixtureHash) throw new Error("seeded fixture never became ready")
}, 45_000)

describe("system routes", () => {
  test("GET / returns version + environment", async () => {
    const { status, body } = await json("/")
    matchGolden("root", { status, environment: body.data.environment, version: "<version>" })
  })

  test("GET /api/health reports ok", async () => {
    const { status, body } = await json("/api/health")
    matchGolden("health", {
      status,
      message: body.data.message,
      environment: body.data.environment,
      version: "<version>",
    })
  })

  test("GET /headers is forbidden outside local/development", async () => {
    const { status, body } = await json("/headers")
    matchGolden("headers-forbidden", { status, body })
  })

  test("unknown route is a 404 envelope", async () => {
    const { status, body } = await json("/api/does-not-exist")
    matchGolden("not-found", { status, body })
  })
})

describe("sources + settings", () => {
  test("GET /api/torrents/sources structural contract", async () => {
    const { status, body } = await json("/api/torrents/sources")
    const d = body.data
    // Only deterministic structure: provider health + tracker liveness populate asynchronously, so
    // their contents are not golden-stable - the committed provider registry and shape are.
    matchGolden("sources", {
      status,
      providerKeys: Object.keys(d.providers[0]).sort(),
      providersNonEmpty: d.providers.length > 0,
      hasApibay: d.providers.some((p: any) => p.name === "apibay"),
      healthIsArray: Array.isArray(d.health),
      trackersType: Array.isArray(d.trackers) ? "array" : typeof d.trackers,
      directory: "<directory>",
    })
  })

  test("POST /api/torrents/sources/refresh matches the sources shape", async () => {
    const { status, body } = await json("/api/torrents/sources/refresh", { method: "POST" })
    const d = body.data
    matchGolden("sources-refresh", {
      status,
      providerKeys: Object.keys(d.providers[0]).sort(),
      hasApibay: d.providers.some((p: any) => p.name === "apibay"),
      trackersType: Array.isArray(d.trackers) ? "array" : typeof d.trackers,
      directory: "<directory>",
    })
  })

  test("GET /api/torrents/settings returns the download dir", async () => {
    const { status, body } = await json("/api/torrents/settings")
    expect(typeof body.data.downloadDir).toBe("string")
    matchGolden("settings-get", { status, downloadDir: "<downloadDir>" })
  })

  test("PUT /api/torrents/settings sets the download dir", async () => {
    const current = (await json("/api/torrents/settings")).body.data.downloadDir
    const { status, body } = await json("/api/torrents/settings", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ downloadDir: current }),
    })
    expect(body.data.downloadDir).toBe(current)
    matchGolden("settings-put", { status, downloadDir: "<downloadDir>" })
  })

  test("PUT /api/torrents/settings rejects an empty dir", async () => {
    const { status, body } = await json("/api/torrents/settings", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ downloadDir: "" }),
    })
    matchGolden("settings-put-invalid", { status, code: body.error?.code })
  })
})

describe("the seeded completed fixture", () => {
  test("appears in the list as ready + done (normalized snapshot)", async () => {
    const f = (await list()).find((t) => t.name === FIXTURE_NAME)!
    expect(f.ready).toBe(true)
    expect(f.done).toBe(true)
    expect(f.length).toBe(FIXTURE_SIZE)
    matchGolden("fixture-snapshot", normalize(f))
  })
})

describe("/stream", () => {
  test("full GET returns 200 + all bytes", async () => {
    const res = await call(`/api/torrents/${fixtureHash}/stream/0`)
    matchGolden("stream-full-headers", streamHeaders(res))
    matchGoldenBytes("stream-full", new Uint8Array(await res.arrayBuffer()))
  })

  test("Range returns 206 + the requested slice", async () => {
    const res = await call(`/api/torrents/${fixtureHash}/stream/0`, {
      headers: { range: "bytes=0-15" },
    })
    matchGolden("stream-range-headers", streamHeaders(res))
    const bytes = new Uint8Array(await res.arrayBuffer())
    expect([...bytes]).toEqual([...fixtureContent().subarray(0, 16)])
    matchGoldenBytes("stream-range", bytes)
  })

  test("suffix Range returns the last N bytes", async () => {
    const res = await call(`/api/torrents/${fixtureHash}/stream/0`, {
      headers: { range: "bytes=-16" },
    })
    matchGolden("stream-suffix-headers", streamHeaders(res))
    const bytes = new Uint8Array(await res.arrayBuffer())
    expect([...bytes]).toEqual([...fixtureContent().subarray(FIXTURE_SIZE - 16)])
  })

  test("out-of-range is 416", async () => {
    const res = await call(`/api/torrents/${fixtureHash}/stream/0`, {
      headers: { range: "bytes=99999-" },
    })
    matchGolden("stream-416", {
      status: res.status,
      "content-range": res.headers.get("content-range"),
    })
  })

  test("HEAD behavior", async () => {
    const res = await call(`/api/torrents/${fixtureHash}/stream/0`, { method: "HEAD" })
    const body = await res.arrayBuffer()
    matchGolden("stream-head", { ...streamHeaders(res), bodyLength: body.byteLength })
  })

  test("unknown torrent is 404 not ready", async () => {
    const res = await call(`/api/torrents/${"0".repeat(40)}/stream/0`)
    matchGolden("stream-unknown", { status: res.status, body: await res.json() })
  })

  test("bad file index is 404 file not found", async () => {
    const res = await call(`/api/torrents/${fixtureHash}/stream/99`)
    matchGolden("stream-bad-index", { status: res.status, body: await res.json() })
  })

  test("non-numeric file index is 404 file not found", async () => {
    const res = await call(`/api/torrents/${fixtureHash}/stream/abc`)
    matchGolden("stream-nan-index", { status: res.status, body: await res.json() })
  })
})

describe("torrent lifecycle (Sintel magnet)", () => {
  test("POST /api/torrents adds by magnet", async () => {
    const { status, body } = await json("/api/torrents", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ magnet: MAGNET }),
    })
    const t: Snapshot = body.data.torrent
    expect(t.infoHash).toBe(SINTEL)
    matchGolden("add", {
      status,
      infoHash: t.infoHash,
      done: t.done,
      paused: t.paused,
      progress: t.progress,
    })
  }, 15_000) // offline, add waits up to ~8s for the engine's early-snapshot fallback

  test("re-adding the same magnet is idempotent (dedup)", async () => {
    const { status, body } = await json("/api/torrents", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ magnet: MAGNET }),
    })
    expect(status).toBe(200)
    expect(body.data.torrent.infoHash).toBe(SINTEL)
  })

  test("POST /api/torrents rejects an empty magnet", async () => {
    const { status, body } = await json("/api/torrents", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ magnet: "" }),
    })
    matchGolden("add-empty", { status, code: body.error?.code })
  })

  test("POST /api/torrents rejects a non-magnet string", async () => {
    const { status, body } = await json("/api/torrents", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ magnet: "not-a-magnet" }),
    })
    matchGolden("add-invalid", { status, code: body.error?.code })
  })

  test("pause + resume flip paused", async () => {
    const paused: Snapshot = (await json(`/api/torrents/${SINTEL}/pause`, { method: "POST" })).body
      .data.torrent
    expect(paused.paused).toBe(true)
    const resumed: Snapshot = (await json(`/api/torrents/${SINTEL}/resume`, { method: "POST" }))
      .body.data.torrent
    expect(resumed.paused).toBe(false)
    matchGolden("pause-resume", { paused: paused.paused, resumed: resumed.paused })
  })

  test("pause on an unknown hash is 404", async () => {
    const { status, body } = await json(`/api/torrents/${"0".repeat(40)}/pause`, { method: "POST" })
    matchGolden("pause-unknown", { status, code: body.error?.code, message: body.error?.message })
  })

  test("resume on an unknown hash is 404", async () => {
    const { status, body } = await json(`/api/torrents/${"0".repeat(40)}/resume`, {
      method: "POST",
    })
    matchGolden("resume-unknown", { status, code: body.error?.code })
  })

  test("reveal on an unknown hash returns ok:false (no GUI spawn)", async () => {
    const { status, body } = await json(`/api/torrents/${"0".repeat(40)}/reveal`, {
      method: "POST",
    })
    matchGolden("reveal-unknown", { status, ok: body.data.ok })
  })

  test("delete on an unknown hash returns ok:false", async () => {
    const { status, body } = await json(`/api/torrents/${"0".repeat(40)}`, { method: "DELETE" })
    matchGolden("delete-unknown", { status, ok: body.data.ok })
  })

  test("DELETE removes the torrent (and destroys its store)", async () => {
    const { status, body } = await json(`/api/torrents/${SINTEL}?destroyStore=true`, {
      method: "DELETE",
    })
    expect(body.data.ok).toBe(true)
    matchGolden("delete", { status, ok: body.data.ok })
    expect((await list()).some((t) => t.infoHash === SINTEL)).toBe(false)
  })

  test("DELETE query validation rejects a bad destroyStore", async () => {
    const { status, body } = await json(`/api/torrents/${SINTEL}?destroyStore=maybe`, {
      method: "DELETE",
    })
    matchGolden("delete-invalid", { status, code: body.error?.code })
  })
})

describe("search", () => {
  test("empty query is rejected", async () => {
    const { status, body } = await json("/api/torrents/search?q=")
    matchGolden("search-empty", { status, code: body.error?.code })
  })
})
