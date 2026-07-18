// zero-torrent download engine (Bun sidecar)
//
// Runs a WebTorrent (3.x) client and exposes a tiny JSON HTTP API on 127.0.0.1 that the
// Bun/Hono backend proxies to. It runs under Bun like the rest of the stack; the two
// webtorrent native addons that crash Bun (an unsupported libuv function, uv_timer_init)
// are kept out of the process: WebRTC/`node-datachannel` is neutralized by the preload in
// src/webrtc-stub.mjs (wired via bunfig.toml), and uTP/`utp-native` is disabled with
// `{ utp: false }` below. Peers are found via the DHT plus udp/http trackers over TCP,
// which is all a local client needs. It stays a separate process so a crashing torrent
// can never take the backend down. See AGENTS.md / docs for the architecture rationale.

import { spawn } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { createServer } from "node:http"
import { homedir, platform } from "node:os"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import WebTorrent from "webtorrent"

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(__dirname, "../../..")

const PORT = Number(process.env.TORRENT_ENGINE_PORT || 4444)
const HOST = process.env.TORRENT_ENGINE_HOST || "127.0.0.1"

// Where new torrents download by default (overridable in Settings; env wins as the hard default).
const DEFAULT_DOWNLOAD_DIR = resolve(
  process.env.TORRENT_DOWNLOAD_DIR || resolve(homedir(), "Downloads", "PeerZero"),
)
// Current download dir for NEW torrents. Loaded from persisted settings on boot; existing
// torrents keep whatever folder they were added with (stored per-torrent in state).
let downloadDir = DEFAULT_DOWNLOAD_DIR

// State lives in a fixed app dir so it survives changing the download location. Older builds
// kept it inside the repo's .downloads; loadState() migrates from there on first boot.
const STATE_DIR = resolve(homedir(), ".peerzero")
const STATE_FILE = resolve(STATE_DIR, "state.json")
const LEGACY_DOWNLOAD_DIR = resolve(`${REPO_ROOT}/.downloads`)
const LEGACY_STATE_FILE = resolve(LEGACY_DOWNLOAD_DIR, ".zero-torrent-state.json")

mkdirSync(STATE_DIR, { recursive: true })
mkdirSync(downloadDir, { recursive: true })

// A crashing torrent should never take the whole engine down. Stay defensive: log
// and keep serving so the parent doesn't have to restart us.
process.on("uncaughtException", (err) =>
  console.error("[engine] uncaughtException:", err?.message || err),
)
process.on("unhandledRejection", (err) => console.error("[engine] unhandledRejection:", err))

// maxConns is per-torrent. Kept deliberately conservative: too many connections
// exhaust a consumer router's NAT/connection table, which degrades the WHOLE network
// (DNS crawls, other downloads stall, wifi drops) and starves the torrents too. With
// several torrents active at once this multiplies, so 25 stays gentle on the router;
// raise it via TORRENT_MAX_CONNS on a capable network/wired link.
const MAX_CONNS = Number(process.env.TORRENT_MAX_CONNS) || 25
// utp: false -> keep the `utp-native` addon out of the process; it crashes Bun on an
// unsupported libuv function (uv_timer_init). TCP + DHT + udp/http trackers cover a
// local client's peer discovery. See the header note and src/webrtc-stub.mjs.
const client = new WebTorrent({ maxConns: MAX_CONNS, utp: false })
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
  // Prefer the current state file; fall back to the legacy in-repo location once (migration).
  for (const file of [STATE_FILE, LEGACY_STATE_FILE]) {
    try {
      if (existsSync(file)) return JSON.parse(readFileSync(file, "utf8"))
    } catch (err) {
      console.error("[engine] failed to read state:", err?.message || err)
    }
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
    // Each torrent remembers its own folder so changing the default never moves existing ones.
    path: t.path || downloadDir,
    paused: meta.get(t.infoHash)?.paused ?? false,
    addedAt: meta.get(t.infoHash)?.addedAt ?? null,
  }))
  try {
    writeFileSync(STATE_FILE, JSON.stringify({ settings: { downloadDir }, torrents }, null, 2))
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
    downloadDir: t.path || downloadDir,
    files: t.ready ? t.files.map(fileSnapshot) : [],
  }
}

function findTorrent(infoHash) {
  return client.torrents.find((t) => t.infoHash === infoHash?.toLowerCase())
}

// ---------- torrent actions ----------

async function addTorrent(magnet) {
  // Dedup: client.get() is async in webtorrent 3.x, so await it. Re-adding a magnet that
  // is already present returns its current snapshot instead of client.add() erroring with
  // "Cannot add duplicate torrent" (3.x raises that by destroying the just-added torrent).
  let existing = null
  try {
    existing = await client.get(magnet)
  } catch {
    existing = null
  }
  if (existing && existing.infoHash) return snapshot(existing)

  return new Promise((resolve, reject) => {
    let settled = false
    const t = client.add(magnet, { path: downloadDir }, (torrent) => {
      if (settled) return
      settled = true
      // Backstop: stamp addedAt on ready too (preserving any earlier value) so a torrent
      // that resolves before the 8s fallback never stays at addedAt 0 (which shows as "-").
      setMeta(torrent.infoHash, {
        paused: false,
        addedAt: meta.get(torrent.infoHash)?.addedAt ?? nowUnix(),
      })
      saveState()
      resolve(snapshot(torrent))
    })
    // Stamp addedAt as early as possible so the new torrent shows its add time (not a dash
    // at addedAt 0) and sorts to the top immediately. A magnet's infoHash is usually known
    // synchronously; if not, the infoHash event fires the moment it is.
    const stampAdded = () => {
      if (t.infoHash)
        setMeta(t.infoHash, { paused: false, addedAt: meta.get(t.infoHash)?.addedAt ?? nowUnix() })
    }
    stampAdded()
    t.once("infoHash", stampAdded)
    t.on("error", (err) => {
      if (settled) return
      // Concurrent-add race the pre-check can miss: 3.x rejects a duplicate by destroying
      // this new torrent with a "duplicate torrent" error, then calls the ontorrent callback
      // above with the existing torrent (which resolves us). Ignore the error and let it settle.
      if (/duplicate torrent/i.test(err?.message || "")) return
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

// ---------- settings + reveal in the file manager ----------

// Expand a leading ~ so users can type "~/Movies" in Settings.
function expandHome(p) {
  if (p === "~") return homedir()
  if (p.startsWith("~/")) return resolve(homedir(), p.slice(2))
  return p
}

function setDownloadDir(dir) {
  const resolved = resolve(expandHome(String(dir).trim()))
  mkdirSync(resolved, { recursive: true })
  downloadDir = resolved
  saveState()
  return downloadDir
}

// Open a folder in the OS file manager. Local-only tool, so shelling out to the opener is fine.
function openPath(target) {
  const p = platform()
  const cmd = p === "darwin" ? "open" : p === "win32" ? "explorer" : "xdg-open"
  spawn(cmd, [target], { detached: true, stdio: "ignore" }).unref()
}

// Reveal (select) a file/folder in the file manager, falling back to opening its parent.
function revealPath(target) {
  const p = platform()
  if (p === "darwin") spawn("open", ["-R", target], { detached: true, stdio: "ignore" }).unref()
  else if (p === "win32")
    spawn("explorer", [`/select,${target}`], { detached: true, stdio: "ignore" }).unref()
  else spawn("xdg-open", [dirname(target)], { detached: true, stdio: "ignore" }).unref()
}

// Open a native folder picker and resolve to the chosen absolute path (or null if cancelled
// or unavailable). Local-only tool, so the engine runs in the user's session and can show a
// GUI dialog. macOS uses osascript; Windows a WinForms dialog; Linux zenity if present.
function chooseFolder() {
  return new Promise((res) => {
    const p = platform()
    let cmd
    let args
    if (p === "darwin") {
      cmd = "osascript"
      args = ["-e", 'POSIX path of (choose folder with prompt "Choose download folder")']
    } else if (p === "win32") {
      cmd = "powershell"
      args = [
        "-NoProfile",
        "-Command",
        "Add-Type -AssemblyName System.Windows.Forms; $d = New-Object System.Windows.Forms.FolderBrowserDialog; if ($d.ShowDialog() -eq 'OK') { Write-Output $d.SelectedPath }",
      ]
    } else {
      cmd = "zenity"
      args = ["--file-selection", "--directory", "--title=Choose download folder"]
    }
    try {
      let out = ""
      const child = spawn(cmd, args)
      child.stdout.on("data", (d) => (out += d))
      child.on("error", () => res(null)) // picker binary missing (e.g. no zenity)
      child.on("close", (code) => res(code === 0 && out.trim() ? out.trim() : null))
    } catch {
      res(null)
    }
  })
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

    if (parts[0] === "health") return json(res, 200, { ok: true, downloadDir })

    // /settings  (GET the current download dir, PUT/POST to change it)
    if (parts[0] === "settings" && parts.length === 1) {
      if (method === "GET") return json(res, 200, { downloadDir })
      if (method === "PUT" || method === "POST") {
        const raw = await readBody(req)
        let dir = ""
        try {
          dir = JSON.parse(raw).downloadDir || ""
        } catch {
          /* ignore malformed body; handled below */
        }
        if (!dir || !String(dir).trim()) return json(res, 400, { error: "downloadDir required" })
        try {
          return json(res, 200, { downloadDir: setDownloadDir(dir) })
        } catch (err) {
          return json(res, 400, { error: err?.message || "failed to set download dir" })
        }
      }
    }

    // /open  (POST: open the current download folder in the file manager)
    if (parts[0] === "open" && parts.length === 1 && method === "POST") {
      openPath(downloadDir)
      return json(res, 200, { ok: true })
    }

    // /choose-dir  (POST: native folder picker; sets and returns the chosen folder)
    if (parts[0] === "choose-dir" && parts.length === 1 && method === "POST") {
      const chosen = await chooseFolder()
      if (chosen) return json(res, 200, { downloadDir: setDownloadDir(chosen), chosen: true })
      return json(res, 200, { downloadDir, chosen: false })
    }

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
        if (action === "reveal") {
          const t = findTorrent(infoHash)
          if (!t) return json(res, 404, { error: "not found" })
          revealPath(resolve(t.path || downloadDir, t.name || ""))
          return json(res, 200, { ok: true })
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
  console.log(`[engine] webtorrent engine on http://${HOST}:${PORT} -> ${downloadDir}`)
  const state = loadState()
  // Apply the saved download location for new torrents (existing ones keep their own path).
  if (state.settings?.downloadDir) {
    try {
      downloadDir = resolve(state.settings.downloadDir)
      mkdirSync(downloadDir, { recursive: true })
    } catch (err) {
      console.error("[engine] bad saved downloadDir:", err?.message || err)
    }
  }
  // Restore previously-added torrents (webtorrent re-verifies existing files on disk and resumes).
  for (const saved of state.torrents || []) {
    try {
      // Prefer the saved .torrent metadata (instant + peerless ready); fall back to magnet.
      const source = saved.torrentFile ? Buffer.from(saved.torrentFile, "base64") : saved.magnetURI
      // Each torrent restores to its own saved folder; path-less legacy entries lived in .downloads.
      const t = client.add(source, { path: saved.path || LEGACY_DOWNLOAD_DIR }, () => saveState())
      // Use saved.infoHash (always present) - t.infoHash can be unset synchronously.
      setMeta(saved.infoHash, { paused: !!saved.paused, addedAt: saved.addedAt ?? nowUnix() })
      if (saved.paused) t.pause()
      t.on("done", () => stopSeeding(t))
    } catch (err) {
      console.error("[engine] restore failed for", saved.infoHash, err?.message || err)
    }
  }
})
