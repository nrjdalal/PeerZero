// zero-torrent download engine (Node sidecar)
//
// Runs a WebTorrent client and exposes a tiny JSON HTTP API on 127.0.0.1 that the
// Bun/Hono backend proxies to. This lives in its own Node process because
// webtorrent depends on the `node-datachannel` native addon, which panics under
// Bun (unsupported libuv function). webtorrent is pinned to 2.8.5: the 3.0.x line
// crashes the process on a `piece.reserve()` null during download; 2.8.5 completes
// downloads cleanly. See AGENTS.md / docs for the architecture rationale.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { createServer } from "node:http"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import WebTorrent from "webtorrent"

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(__dirname, "../../..")

const PORT = Number(process.env.TORRENT_ENGINE_PORT || 4444)
const HOST = process.env.TORRENT_ENGINE_HOST || "127.0.0.1"
const DOWNLOAD_DIR = resolve(process.env.TORRENT_DOWNLOAD_DIR || `${REPO_ROOT}/.downloads`)
const STATE_FILE = resolve(DOWNLOAD_DIR, ".zero-torrent-state.json")

mkdirSync(DOWNLOAD_DIR, { recursive: true })

// A crashing torrent should never take the whole engine down. 2.8.5 is stable, but
// stay defensive: log and keep serving so the parent doesn't have to restart us.
process.on("uncaughtException", (err) =>
  console.error("[engine] uncaughtException:", err?.message || err),
)
process.on("unhandledRejection", (err) => console.error("[engine] unhandledRejection:", err))

// maxConns is per-torrent. Kept deliberately conservative: too many connections
// exhaust a consumer router's NAT/connection table, which degrades the WHOLE network
// (DNS crawls, other downloads stall, wifi drops) and starves the torrents too. 50 is
// gentle on the router; raise it via TORRENT_MAX_CONNS on a capable network/wired link.
const MAX_CONNS = Number(process.env.TORRENT_MAX_CONNS) || 50
const client = new WebTorrent({ maxConns: MAX_CONNS })
client.on("error", (err) => console.error("[engine] client error:", err?.message || err))

// infoHash -> { paused: boolean, addedAt: number } side-state webtorrent doesn't
// track for us. addedAt is unix seconds, set once when the torrent is first added.
const meta = new Map()

const nowUnix = () => Math.floor(Date.now() / 1000)

// Merge into a torrent's meta, preserving fields (e.g. addedAt) not being changed.
function setMeta(infoHash, updates) {
  meta.set(infoHash, { ...meta.get(infoHash), ...updates })
}

// ---------- persistence: remember added magnets, restore on boot ----------

function loadState() {
  try {
    if (existsSync(STATE_FILE)) return JSON.parse(readFileSync(STATE_FILE, "utf8"))
  } catch (err) {
    console.error("[engine] failed to read state:", err?.message || err)
  }
  return { torrents: [] }
}

function saveState() {
  const torrents = client.torrents.map((t) => ({
    infoHash: t.infoHash,
    magnetURI: t.magnetURI,
    // Persist the .torrent metadata so a restored torrent is immediately ready
    // (and streamable) even while paused, without re-fetching metadata from peers.
    torrentFile: t.torrentFile ? Buffer.from(t.torrentFile).toString("base64") : null,
    name: t.name,
    paused: meta.get(t.infoHash)?.paused ?? false,
    addedAt: meta.get(t.infoHash)?.addedAt ?? null,
  }))
  try {
    writeFileSync(STATE_FILE, JSON.stringify({ torrents }, null, 2))
  } catch (err) {
    console.error("[engine] failed to write state:", err?.message || err)
  }
}

// ---------- snapshots (what the UI renders) ----------

// Count connected peers that already have every piece (seeders). WebTorrent doesn't
// expose this directly, so derive it from each wire's piece bitfield.
function seederCount(t) {
  const wires = t.wires
  if (!wires || !t.ready) return 0
  const total = t.pieces ? t.pieces.length : 0
  if (!total) return 0
  let seeds = 0
  for (const w of wires) {
    const bf = w.peerPieces
    if (!bf) continue
    let all = true
    for (let i = 0; i < total; i++) {
      if (!bf.get(i)) {
        all = false
        break
      }
    }
    if (all) seeds++
  }
  return seeds
}

function fileSnapshot(file) {
  return {
    name: file.name,
    path: file.path,
    length: file.length,
    downloaded: file.downloaded,
    progress: file.progress,
  }
}

function snapshot(t) {
  return {
    infoHash: t.infoHash,
    name: t.name || t.infoHash,
    magnetURI: t.magnetURI,
    length: t.length || 0,
    downloaded: t.downloaded || 0,
    uploaded: t.uploaded || 0,
    downloadSpeed: t.downloadSpeed || 0,
    uploadSpeed: t.uploadSpeed || 0,
    progress: t.progress || 0,
    numPeers: t.numPeers || 0,
    seeders: seederCount(t),
    // webtorrent reports ms; NaN/Infinity before metadata -> null so JSON stays clean.
    timeRemaining: Number.isFinite(t.timeRemaining) ? t.timeRemaining : null,
    ratio: t.ratio || 0,
    done: t.done,
    ready: t.ready,
    paused: meta.get(t.infoHash)?.paused ?? false,
    addedAt: meta.get(t.infoHash)?.addedAt ?? 0,
    downloadDir: DOWNLOAD_DIR,
    files: t.ready ? t.files.map(fileSnapshot) : [],
  }
}

function findTorrent(infoHash) {
  return client.torrents.find((t) => t.infoHash === infoHash?.toLowerCase())
}

// ---------- torrent actions ----------

function addTorrent(magnet) {
  return new Promise((resolve, reject) => {
    let existing
    try {
      existing = client.get(magnet)
    } catch {
      existing = null
    }
    // client.get can return a pending promise-like in some versions; guard on infoHash.
    if (existing && existing.infoHash) {
      resolve(snapshot(existing))
      return
    }

    let settled = false
    const t = client.add(magnet, { path: DOWNLOAD_DIR }, (torrent) => {
      if (settled) return
      settled = true
      saveState()
      resolve(snapshot(torrent))
    })
    // Set addedAt synchronously (a magnet's infoHash is known immediately) so the new
    // torrent sorts to the top from its very first live snapshot, instead of showing
    // addedAt 0, landing at the bottom, and then jumping up once the callback fires.
    if (t.infoHash) setMeta(t.infoHash, { paused: false, addedAt: nowUnix() })
    t.on("error", (err) => {
      if (settled) return
      settled = true
      reject(err)
    })
    // Adding a magnet resolves metadata over the network; don't hang forever, but
    // return an early snapshot so the UI can show "connecting" while it resolves.
    setTimeout(() => {
      if (settled) return
      settled = true
      setMeta(t.infoHash, { paused: false, addedAt: meta.get(t.infoHash)?.addedAt ?? nowUnix() })
      saveState()
      resolve(snapshot(t))
    }, 8000)
    t.on("done", () => stopSeeding(t))
  })
}

// We don't seed: once a torrent finishes downloading, pause it so it stops uploading.
function stopSeeding(t) {
  try {
    t.pause()
  } catch {
    /* already destroyed */
  }
  setMeta(t.infoHash, { paused: true })
  saveState()
}

async function removeTorrent(infoHash, destroyStore) {
  const t = findTorrent(infoHash)
  if (!t) return false
  await new Promise((res) =>
    client.remove(t.infoHash, { destroyStore: !!destroyStore }, () => res()),
  )
  meta.delete(t.infoHash)
  saveState()
  return true
}

function setPaused(infoHash, paused) {
  const t = findTorrent(infoHash)
  if (!t) return null
  if (paused) t.pause()
  else t.resume()
  setMeta(t.infoHash, { paused })
  saveState()
  return snapshot(t)
}

// ---------- HTTP helpers ----------

function json(res, status, body) {
  const data = JSON.stringify(body)
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(data),
  })
  res.end(data)
}

function readBody(req) {
  return new Promise((res) => {
    let raw = ""
    req.on("data", (c) => (raw += c))
    req.on("end", () => res(raw))
  })
}

// ---------- router ----------

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${HOST}:${PORT}`)
    const parts = url.pathname.split("/").filter(Boolean) // e.g. ["torrents", "<hash>", "pause"]
    const method = req.method || "GET"

    if (parts[0] === "health") return json(res, 200, { ok: true, downloadDir: DOWNLOAD_DIR })

    if (parts[0] === "torrents") {
      // /torrents
      if (parts.length === 1) {
        if (method === "GET") return json(res, 200, { torrents: client.torrents.map(snapshot) })
        if (method === "POST") {
          const raw = await readBody(req)
          let magnet = raw
          try {
            const parsed = JSON.parse(raw)
            magnet = parsed.magnet || parsed.magnetURI || raw
          } catch {
            /* raw magnet string body is fine too */
          }
          if (!magnet || !String(magnet).trim()) return json(res, 400, { error: "magnet required" })
          try {
            const snap = await addTorrent(String(magnet).trim())
            return json(res, 200, { torrent: snap })
          } catch (err) {
            return json(res, 400, { error: err?.message || "failed to add torrent" })
          }
        }
      }

      const infoHash = parts[1]
      const action = parts[2]

      // /torrents/:hash
      if (parts.length === 2) {
        const t = findTorrent(infoHash)
        if (!t) return json(res, 404, { error: "not found" })
        if (method === "GET") return json(res, 200, { torrent: snapshot(t) })
        if (method === "DELETE") {
          const ok = await removeTorrent(infoHash, url.searchParams.get("destroyStore") === "true")
          return json(res, ok ? 200 : 404, { ok })
        }
      }

      // /torrents/:hash/pause | resume | delete
      if (parts.length === 3 && method === "POST") {
        if (action === "pause") {
          const snap = setPaused(infoHash, true)
          return snap ? json(res, 200, { torrent: snap }) : json(res, 404, { error: "not found" })
        }
        if (action === "resume") {
          const snap = setPaused(infoHash, false)
          return snap ? json(res, 200, { torrent: snap }) : json(res, 404, { error: "not found" })
        }
        if (action === "delete") {
          const ok = await removeTorrent(infoHash, url.searchParams.get("destroyStore") === "true")
          return json(res, ok ? 200 : 404, { ok })
        }
      }
    }

    return json(res, 404, { error: "not found" })
  } catch (err) {
    console.error("[engine] request error:", err?.message || err)
    return json(res, 500, { error: "internal engine error" })
  }
})

server.listen(PORT, HOST, () => {
  console.log(`[engine] webtorrent engine on http://${HOST}:${PORT} -> ${DOWNLOAD_DIR}`)
  // Restore previously-added torrents (webtorrent re-verifies existing files on disk and resumes).
  const state = loadState()
  for (const saved of state.torrents || []) {
    try {
      // Prefer the saved .torrent metadata (instant + peerless ready); fall back to magnet.
      const source = saved.torrentFile ? Buffer.from(saved.torrentFile, "base64") : saved.magnetURI
      const t = client.add(source, { path: DOWNLOAD_DIR }, () => saveState())
      // Use saved.infoHash (always present) - t.infoHash can be unset synchronously.
      setMeta(saved.infoHash, { paused: !!saved.paused, addedAt: saved.addedAt ?? nowUnix() })
      if (saved.paused) t.pause()
      t.on("done", () => stopSeeding(t))
    } catch (err) {
      console.error("[engine] restore failed for", saved.infoHash, err?.message || err)
    }
  }
})
