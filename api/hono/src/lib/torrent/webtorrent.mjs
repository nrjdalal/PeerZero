// WebTorrent download engine (in-process module of api/hono)
//
// Runs a WebTorrent (3.x) client and exposes plain async functions the Hono routers call
// directly. It used to be a separate sidecar reached over HTTP, but it runs under Bun like the
// rest of the backend, so it lives in-process now. The two webtorrent native addons that crash
// Bun are kept out of the process: WebRTC/`node-datachannel` is neutralized by the webrtc-stub
// plugin (preloaded via api/hono/bunfig.toml in dev/test, applied at bundle time by the build),
// and uTP/`utp-native` is disabled with `{ utp: false }` below. Peers are found via the DHT plus
// udp/http trackers over TCP, which is all a local client needs.

import { spawn } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { homedir, platform } from "node:os"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import WebTorrent from "webtorrent"

const __dirname = dirname(fileURLToPath(import.meta.url))
// api/hono/src/lib/torrent -> repo root (only used for the legacy .downloads migration in dev).
const REPO_ROOT = resolve(__dirname, "../../../../..")

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

// User settings live in their own file, separate from state.json's engine/torrent state, so a
// settings write never rewrites the (large) torrents list and vice versa. Holds the download folder
// plus the frontend's UI preferences (Search enabled, table sort/column visibility, last query),
// which the frontend owns as an opaque blob. Stored server-side because the desktop webview's origin
// (and thus its localStorage) changes every launch; see the note in desktop/backend/main.ts.
const SETTINGS_FILE = resolve(STATE_DIR, "settings.json")
// The UI-preferences blob, null until the frontend first saves it.
let uiPrefs = null

// Bun on Windows throws EEXIST from mkdir(recursive) when the target already exists as a
// reparse point / known folder (e.g. ~/Downloads or ~/Desktop); Node treats it as a no-op.
// Tolerate an already-existing directory so choosing such a folder in Settings doesn't 500.
function ensureDir(dir) {
  try {
    mkdirSync(dir, { recursive: true })
  } catch (err) {
    if (err?.code === "EEXIST" && statSync(dir).isDirectory()) return
    throw err
  }
}

mkdirSync(STATE_DIR, { recursive: true })
ensureDir(downloadDir)

// A crashing torrent should never take the backend down. Stay defensive: log and keep going.
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
// local client's peer discovery. See the header note and webrtc-stub.mjs.
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
    // Settled size/progress, replayed while a restored torrent re-verifies on boot (see snapshot's
    // `syncing`) so its bar is truthful instead of 0% until webtorrent finishes checking pieces.
    length: t.length || 0,
    downloaded: t.downloaded || 0,
    progress: t.progress || 0,
  }))
  try {
    writeFileSync(STATE_FILE, JSON.stringify({ torrents }, null, 2))
  } catch (err) {
    console.error("[engine] failed to write state:", err?.message || err)
  }
}

// ---------- persistence: user settings (download folder + UI preferences) ----------

function loadSettings() {
  // Prefer the dedicated settings file. On first boot after upgrade it won't exist yet, so migrate
  // downloadDir from its old home - state.json's `settings` key (loadState also covers the legacy
  // in-repo state file). The boot code re-persists the result, completing the migration.
  try {
    if (existsSync(SETTINGS_FILE)) return JSON.parse(readFileSync(SETTINGS_FILE, "utf8"))
  } catch (err) {
    console.error("[engine] failed to read settings:", err?.message || err)
  }
  const legacy = loadState()
  return legacy.settings ? { downloadDir: legacy.settings.downloadDir } : {}
}

function saveSettings() {
  try {
    writeFileSync(SETTINGS_FILE, JSON.stringify({ downloadDir, ui: uiPrefs }, null, 2))
  } catch (err) {
    console.error("[engine] failed to write settings:", err?.message || err)
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
  const m = meta.get(t.infoHash) ?? {}
  // Syncing = a restored torrent still re-verifying its on-disk pieces (before webtorrent's
  // `ready`). In that window webtorrent reports zero size/progress, so we replay the persisted
  // values for a truthful bar; `done` stays live, so the torrent only counts as Completed once
  // the pieces are actually verified (and self-corrects if the files turned out to be gone).
  const restored = t.ready ? null : m.restored
  const syncing = !!restored
  return {
    infoHash: t.infoHash,
    name: t.name || restored?.name || t.infoHash,
    magnetURI: t.magnetURI,
    length: t.length || restored?.length || 0,
    downloaded: restored ? restored.downloaded : t.downloaded || 0,
    uploaded: t.uploaded || 0,
    downloadSpeed: t.downloadSpeed || 0,
    uploadSpeed: t.uploadSpeed || 0,
    progress: restored ? restored.progress : t.progress || 0,
    numPeers: t.numPeers || 0,
    seeders: seederCount(t),
    // webtorrent reports ms; NaN/Infinity before metadata -> null so JSON stays clean.
    timeRemaining: Number.isFinite(t.timeRemaining) ? t.timeRemaining : null,
    ratio: t.ratio || 0,
    done: t.done,
    ready: t.ready,
    syncing,
    paused: m.paused ?? false,
    addedAt: m.addedAt ?? 0,
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

  return new Promise((res, reject) => {
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
      res(snapshot(torrent))
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
      res(snapshot(t))
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
  // Capture before client.remove destroys the torrent object.
  const rootName = t.name
  const base = resolve(t.path || downloadDir)
  await new Promise((res) =>
    client.remove(t.infoHash, { destroyStore: !!destroyStore }, () => res()),
  )
  // destroyStore deletes the files but leaves the torrent's now-empty folder tree behind, so a
  // "Delete files" removal still litters the download dir with empty folders. Remove that
  // top-level folder too, but only when it's a direct child of the download dir (never the dir
  // itself), so a malformed name can't escalate into deleting anything outside it.
  if (destroyStore && rootName) {
    const root = resolve(base, rootName)
    if (dirname(root) === base && root !== base) {
      try {
        rmSync(root, { recursive: true, force: true })
      } catch {
        /* best effort - the files themselves are already gone */
      }
    }
  }
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
  ensureDir(resolved)
  downloadDir = resolved
  saveSettings()
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

// ---------- public API (called in-process by the Hono torrents router) ----------

export function list() {
  return client.torrents.map(snapshot)
}

export function getTorrent(infoHash) {
  const t = findTorrent(infoHash)
  return t ? snapshot(t) : null
}

export { addTorrent as add, removeTorrent as remove }

export function pause(infoHash) {
  return setPaused(infoHash, true)
}

export function resume(infoHash) {
  return setPaused(infoHash, false)
}

export function getSettings() {
  return { downloadDir }
}

export function setSettings(dir) {
  return { downloadDir: setDownloadDir(dir) }
}

// The frontend's persisted UI preferences, opaque to the engine. getUiPrefs returns null until the
// first save; setUiPrefs replaces the whole blob and persists it (into settings.json, under `ui`).
export function getUiPrefs() {
  return uiPrefs
}

export function setUiPrefs(prefs) {
  uiPrefs = prefs ?? null
  saveSettings()
  return uiPrefs
}

// Open the current download folder in the OS file manager.
export function openDownloadDir() {
  openPath(downloadDir)
  return true
}

// Reveal (select) a torrent's downloaded folder/file in the OS file manager.
export function revealTorrent(infoHash) {
  const t = findTorrent(infoHash)
  if (!t) return false
  revealPath(resolve(t.path || downloadDir, t.name || ""))
  return true
}

// Native folder picker; sets and returns the chosen folder (chosen:false if cancelled/absent).
export async function chooseDir() {
  const chosen = await chooseFolder()
  if (chosen) return { downloadDir: setDownloadDir(chosen), chosen: true }
  return { downloadDir, chosen: false }
}

// Shutdown hook: destroy the WebTorrent client (stops the DHT/trackers/timers) so a process that
// only needs the engine transiently - e.g. the e2e test - can exit cleanly.
export function destroyClient() {
  return new Promise((res) => client.destroy(() => res()))
}

const jsonResponse = (status, body) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })

// Range-capable byte stream of a torrent file, returned as a Web Response (for the video player
// and external-player handoff). 404 when the torrent/file isn't ready, 416 on a bad range.
export function streamFile(infoHash, idx, range, method = "GET") {
  const t = findTorrent(infoHash)
  if (!t || !t.ready) return jsonResponse(404, { error: "not ready" })
  const file = Number.isInteger(idx) ? t.files[idx] : undefined
  if (!file) return jsonResponse(404, { error: "file not found" })
  // Streaming an unfinished file needs the torrent running with this file's pieces prioritized;
  // a completed file reads straight from disk and works even while the torrent is paused/seeding.
  if (file.progress < 1) {
    t.resume()
    file.select()
  }
  const total = file.length
  let start = 0
  let end = total - 1
  let status = 200
  const headers = {
    "accept-ranges": "bytes",
    "content-type": file.type || "application/octet-stream",
  }
  const match = /^bytes=(\d*)-(\d*)$/.exec(range || "")
  if (match) {
    if (!match[1] && match[2]) {
      start = Math.max(0, total - Number(match[2])) // suffix range "bytes=-N": last N bytes
    } else {
      if (match[1]) start = Number(match[1])
      if (match[2]) end = Number(match[2])
    }
    if (start > end || start >= total) {
      return new Response(null, { status: 416, headers: { "content-range": `bytes */${total}` } })
    }
    end = Math.min(end, total - 1)
    status = 206
    headers["content-range"] = `bytes ${start}-${end}/${total}`
  }
  headers["content-length"] = String(end - start + 1)
  if (method === "HEAD") return new Response(null, { status, headers })
  const nodeStream = file.createReadStream({ start, end })
  nodeStream.on("error", (err) => console.error("[engine] stream error:", err?.message || err))
  // Hand the Node Readable straight to Response. Do NOT use Readable.toWeb(): under Bun it throws
  // ("QueuingStrategyInit.highWaterMark member is required", oven-sh/bun#2935). Bun's Response
  // accepts a Node stream (it is an async iterable) as a body, which is all this backend runs on.
  return new Response(nodeStream, { status, headers })
}

// ---------- boot: restore previously-added torrents (runs once at module load) ----------

function restoreOnBoot() {
  const state = loadState()
  // Restore previously-added torrents (webtorrent re-verifies existing files on disk and resumes).
  for (const saved of state.torrents || []) {
    try {
      // Prefer the saved .torrent metadata (instant + peerless ready); fall back to magnet.
      const source = saved.torrentFile ? Buffer.from(saved.torrentFile, "base64") : saved.magnetURI
      // Each torrent restores to its own saved folder; path-less legacy entries lived in .downloads.
      const t = client.add(source, { path: saved.path || LEGACY_DOWNLOAD_DIR }, () => saveState())
      // Use saved.infoHash (always present) - t.infoHash can be unset synchronously. `restored` is
      // the last-known size/progress, replayed by snapshot() while this torrent shows as "syncing".
      setMeta(saved.infoHash, {
        paused: !!saved.paused,
        addedAt: saved.addedAt ?? nowUnix(),
        restored: {
          name: saved.name,
          length: saved.length ?? 0,
          downloaded: saved.downloaded ?? 0,
          progress: saved.progress ?? 0,
        },
      })
      if (saved.paused) t.pause()
      t.on("done", () => stopSeeding(t))
    } catch (err) {
      console.error("[engine] restore failed for", saved.infoHash, err?.message || err)
    }
  }
}

// Load persisted settings (download folder + UI prefs), migrating from state.json on first boot,
// then re-persist so the migration completes and settings.json exists going forward.
const savedSettings = loadSettings()
if (savedSettings.downloadDir) {
  try {
    downloadDir = resolve(savedSettings.downloadDir)
    ensureDir(downloadDir)
  } catch (err) {
    console.error("[engine] bad saved downloadDir:", err?.message || err)
  }
}
uiPrefs = savedSettings.ui ?? null
saveSettings()
restoreOnBoot()
console.log(`[engine] in-process webtorrent engine -> ${downloadDir}`)
