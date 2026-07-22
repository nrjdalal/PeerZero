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
import {
  closeSync,
  existsSync,
  ftruncateSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  rmSync,
  statSync,
  writeFileSync,
  writeSync,
} from "node:fs"
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
    // Indices of files the user deleted, so they stay hidden and deselected across restarts.
    removed: [...(meta.get(t.infoHash)?.removed ?? [])],
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

function fileSnapshot(file, index, deselected) {
  // Clamp: webtorrent's `File.get downloaded()` subtracts the "irrelevant" first/last piece bytes and
  // can go slightly negative for a small file that lives inside one partially-downloaded shared piece,
  // which would show as a negative bar. A deleted file reports empty (webtorrent still holds the old
  // in-memory progress since it never re-scans disk) and is flagged so the UI shows a "download"
  // action to fetch it back instead of "play".
  const downloaded = deselected ? 0 : Math.max(0, Math.min(file.length, file.downloaded))
  return {
    name: file.name,
    path: file.path,
    // Position in the torrent's `files` array - the id used to stream/reveal/download/delete it.
    index,
    length: file.length,
    deselected: !!deselected,
    downloaded,
    progress: deselected || !file.length ? 0 : Math.max(0, Math.min(1, downloaded / file.length)),
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
    // Files the user deleted stay in the list, flagged `deselected` (data gone, won't re-download
    // until the user hits download) - webtorrent can't drop a file from a torrent's metadata.
    files: t.ready ? t.files.map((f, i) => fileSnapshot(f, i, m.removed?.has(i))) : [],
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

// The absolute on-disk path of one file. `file.path` is relative to the torrent's folder and
// already includes the torrent-name segment, so resolving against the torrent's base dir is enough.
function fileDiskPath(t, file) {
  return resolve(t.path || downloadDir, file.path)
}

// Look up a ready torrent and one of its files by index; null if either is missing or not ready.
function findFile(infoHash, fileIdx) {
  const t = findTorrent(infoHash)
  if (!t || !t.ready) return null
  const file = Number.isInteger(fileIdx) ? t.files[fileIdx] : undefined
  if (!file) return null
  return { t, file }
}

// Reveal (select) a single file in the OS file manager.
export function revealFile(infoHash, fileIdx) {
  const found = findFile(infoHash, fileIdx)
  if (!found) return false
  revealPath(fileDiskPath(found.t, found.file))
  return true
}

// Drop this file's pieces from webtorrent's in-memory chunk cache (the CacheChunkStore LRU wrapping
// the fs store). Freeing the bytes on disk doesn't touch that cache, so without this a later re-verify
// could read a stale pre-delete buffer from memory, mark the piece "have", skip re-fetching it, and
// leave a zeroed hole on disk. (`store.store.cache` is a webtorrent / cache-chunk-store internal,
// pinned to webtorrent 3.0.16; guarded so a store without the cache layer is a no-op.)
function dropFileCache(t, file) {
  const cache = t.store?.store?.cache
  if (!cache || typeof cache.remove !== "function") return
  for (let i = file._startPiece; i <= file._endPiece; i++) cache.remove(i)
}

// Re-derive the torrent's wanted-piece selection from scratch: deselect every piece, then re-select
// every file the user has NOT deleted. webtorrent's `file.deselect()` subtracts from a MERGED interval
// set with no per-piece refcount, so deselecting one file also un-wants the boundary piece it shares
// with a kept neighbor, stranding that neighbor (it can never fetch that piece). Rebuilding instead -
// each kept file re-adds its full `[_startPiece.._endPiece]` range including boundaries - keeps every
// shared boundary piece wanted by whichever kept file needs it, while a deleted file's EXCLUSIVE
// pieces are wanted by nobody. Call after any change to a torrent's `removed` set. Must run
// synchronously so the deferred `_gcSelections` sees the final selection state.
function recomputeSelections(t, removedSet) {
  if (!t?.ready || !t.pieces?.length) return
  t.deselect(0, t.pieces.length - 1)
  for (let i = 0; i < t.files.length; i++) {
    const f = t.files[i]
    if (removedSet?.has(i)) {
      // A deleted file is not wanted, so treat it as complete for done-tracking. Otherwise webtorrent's
      // `_checkDone` (torrent.done = every file.done) would keep an incomplete-then-deleted file's
      // `done` false forever, stranding the torrent as perpetually "Downloading" (still announcing +
      // holding peer slots) with nothing left to fetch. `downloadFile`'s `_markUnverified` flips this
      // back to false when the file is re-selected.
      if (f) f.done = true
      continue
    }
    try {
      f.select()
    } catch {
      /* zero-length or destroyed file */
    }
  }
}

// The range of pieces that lie ENTIRELY inside one file (not shared with an adjacent file). Files
// rarely start/end on a piece boundary, so the first and/or last piece usually also holds a
// neighbor's bytes; those "boundary" pieces are excluded. `none` is true when the file is smaller than
// a piece or wholly inside shared pieces (no exclusive piece at all). (`_startPiece`/`_endPiece`,
// `pieceLength`/`lastPieceLength` are webtorrent internals, stable in the pinned 3.0.16.) Exported for
// unit-testability.
export function exclusivePieceRange(t, file) {
  const P = t.pieceLength
  const last = t.pieces.length - 1
  const pieceLen = (i) => (i === last ? t.lastPieceLength : P)
  const fileEnd = file.offset + file.length - 1 // inclusive
  const headShared = file.offset % P !== 0
  const firstExclusive = headShared ? file._startPiece + 1 : file._startPiece
  const tailShared = file._endPiece * P + pieceLen(file._endPiece) - 1 > fileEnd
  const lastExclusive = tailShared ? file._endPiece - 1 : file._endPiece
  const none = firstExclusive > lastExclusive
  // File-relative byte offsets of the boundary slivers freeFileBytes preserves: [0, headKeepBytes)
  // and [tailKeepStart, length); the exclusive region it frees lies between them.
  const headKeepBytes = none ? 0 : firstExclusive * P - file.offset
  const tailKeepStart = none
    ? file.length
    : lastExclusive * P + pieceLen(lastExclusive) - file.offset
  return { firstExclusive, lastExclusive, none, headKeepBytes, tailKeepStart }
}

// Free a deleted file's disk blocks WITHOUT corrupting the data-pieces it shares with neighbor files.
// A file's first/last piece usually also holds a neighbor's bytes (libtorrent keeps those slivers in a
// "part file" so the neighbor's piece still verifies); we do the same by freeing only the file's
// EXCLUSIVE pieces and preserving the boundary slivers in place. Mechanism (std fs, no FFI): read the
// tail sliver, `ftruncate` DOWN to the kept head bytes (frees the middle + tail blocks while never
// touching the head, so the head boundary is crash-safe), write the tail sliver back at its original
// offset (past the new EOF, leaving the middle unwritten), then `ftruncate` back to the logical size.
// The middle is left reading as zeros and is neighbor-safe EVERYWHERE; whether its BLOCKS are actually
// reclaimed is filesystem-dependent: a write-past-EOF gap is a real hole on ext4/xfs (Linux, Docker),
// and a file with no tail to keep (piece-aligned / pad-file / single-file torrents) is reclaimed
// everywhere via the pure ftruncate. On APFS, rewriting the tail re-allocates the middle, so a
// tail-sliver file stays correct + neighbor-safe but is NOT reclaimed there - an in-place hole punch
// would fix it, but macOS arm64's variadic `fcntl(F_PUNCHHOLE)` isn't callable from Bun's FFI (a
// native shim is the follow-up). The only data-gap window is the tail sliver between the truncate and
// its rewrite (a few syscalls, no I/O); a crash there loses at most that one end-boundary piece, which
// the kept neighbor re-fetches. Throws (e.g. ENOENT) to the caller.
// Exported for unit-testability.
export function freeFileBytes(t, file, diskPath) {
  const { none, headKeepBytes, tailKeepStart } = exclusivePieceRange(t, file)
  if (none) return // all-boundary file (smaller than a piece): freeing it would nick a neighbor
  let fd
  try {
    fd = openSync(diskPath, "r+")
    const tailLen = file.length - tailKeepStart
    let tail = null
    // Only preserve the tail sliver if its shared piece is fully downloaded (bitfield "have"). A have
    // piece is quiescent - webtorrent never rewrites it - so read+rewrite can't race an in-flight store
    // write for a still-downloading torrent. A not-have tail is (or will be) fetched normally by
    // whichever kept file wants that piece, so we skip it and leave a hole for that fetch to fill (no
    // rewrite -> no race, no lost bytes). The head sliver is never rewritten (kept by truncating above
    // it), so it needs no such guard.
    if (tailLen > 0 && t.bitfield?.get?.(file._endPiece)) {
      tail = Buffer.alloc(tailLen)
      const n = readSync(fd, tail, 0, tailLen, tailKeepStart) // partial file: read only what exists
      if (n < tailLen) tail = tail.subarray(0, n)
    }
    ftruncateSync(fd, headKeepBytes) // free middle + tail blocks; head [0, headKeepBytes) untouched
    if (tail && tail.length) writeSync(fd, tail, 0, tail.length, tailKeepStart) // write past EOF -> hole
    ftruncateSync(fd, file.length) // restore logical size (sparse where nothing was written)
  } finally {
    if (fd !== undefined) closeSync(fd)
  }
}

// Delete one file's data: stop wanting it, free its disk blocks, and remember the index so it stays
// deleted across restarts. The file stays in the torrent's metadata - the UI shows it disabled with a
// "download" to fetch it back. `recomputeSelections` un-wants only this file's EXCLUSIVE pieces (kept
// neighbors keep the shared boundary pieces wanted); `freeFileBytes` reclaims those exclusive blocks
// on disk while preserving the boundary slivers, so no neighbor is nicked. We deliberately leave the
// freed pieces' bitfield bits "have": they're deselected so never re-requested, and clearing them
// (only possible via `_markUnverified`, which re-selects) would either re-download the file or flip
// `torrent.done` to false. `dropFileCache` evicts any stale in-memory chunks for the file's pieces.
export function removeFile(infoHash, fileIdx) {
  const found = findFile(infoHash, fileIdx)
  if (!found) return false
  const { t, file } = found
  const removed = new Set(meta.get(t.infoHash)?.removed ?? [])
  removed.add(fileIdx)
  setMeta(t.infoHash, { removed })
  recomputeSelections(t, removed)
  // Recompute torrent.done: the deleted file is now done=true, so if it was the last incomplete file
  // the torrent settles to done (fires 'done' -> stopSeeding) instead of announcing forever.
  t._checkDone?.()
  try {
    freeFileBytes(t, file, fileDiskPath(t, file))
  } catch (err) {
    // ENOENT (nothing on disk yet) is fine; anything else is worth surfacing.
    if (err?.code !== "ENOENT")
      console.error("[engine] failed to free file data:", err?.message || err)
  }
  dropFileCache(t, file)
  saveState()
  return true
}

// Re-download a previously-deleted file: mark it wanted again, mark its freed (exclusive) pieces
// not-have so the picker re-requests them, recompute `done`, and resume. Only the file's EXCLUSIVE
// pieces are marked not-have; its boundary pieces were preserved on disk (still valid) so they stay
// "have" and are NOT re-fetched, meaning a re-download never disturbs a neighbor. `_markUnverified`
// clears the bit + re-selects the single piece (no disk re-hash); it runs synchronously with
// `recomputeSelections` so the deferred `_gcSelections` keeps the middle pieces selected.
export function downloadFile(infoHash, fileIdx) {
  const found = findFile(infoHash, fileIdx)
  if (!found) return false
  const { t, file } = found
  const removed = new Set(meta.get(t.infoHash)?.removed ?? [])
  removed.delete(fileIdx)
  setMeta(t.infoHash, { removed })
  recomputeSelections(t, removed) // re-selects this file (and every other kept file)
  const { firstExclusive, lastExclusive, none } = exclusivePieceRange(t, file)
  if (!none && typeof t._markUnverified === "function") {
    for (let i = firstExclusive; i <= lastExclusive; i++) t._markUnverified(i)
  }
  t._checkDone?.() // recompute done (select/deselect/_markUnverified don't); re-announces to trackers
  t.resume()
  setMeta(t.infoHash, { paused: false })
  saveState()
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

// The live read stream per `${infoHash}:${fileIdx}`, so a new Range request (a seek) can destroy the
// previous read before starting the next one - see the note in streamFile below.
const activeStreams = new Map()

// Range-capable byte stream of a torrent file, returned as a Web Response (for the video player
// and external-player handoff). 404 when the torrent/file isn't ready, 416 on a bad range. `signal`
// (the request's AbortSignal) tears the read down when the client disconnects (a seek or a close).
export function streamFile(infoHash, idx, range, method = "GET", signal) {
  const t = findTorrent(infoHash)
  if (!t || !t.ready) return jsonResponse(404, { error: "not ready" })
  const file = Number.isInteger(idx) ? t.files[idx] : undefined
  if (!file) return jsonResponse(404, { error: "file not found" })
  // A deleted file's exclusive pieces were freed (its middle is a hole), but webtorrent's bitfield
  // still reads "have", so `file.progress` stays 1 and the code below would serve a 200/206 whose body
  // then errors on the missing middle (a broken player). Refuse it - the row shows a "download" first.
  if (meta.get(t.infoHash)?.removed?.has(idx)) return jsonResponse(404, { error: "file deleted" })
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

  // Seeking forward opens a new Range request while the previous read for this file may still be live.
  // WebTorrent selects each read's byte range at priority 1; with two live reads at equal priority the
  // OLD (pre-seek) range is drained first and STARVES the seek target, so the new read parks on missing
  // pieces until the player times out and false-EOFs - playback "ends" on a forward seek. WebTorrent's
  // own HTTP server avoids this by letting the client's socket-close destroy the previous read (which
  // deselects its range); Bun's `new Response(nodeStream)` does NOT reliably tear a Node stream down on
  // cancel, so track the live read per file and destroy it ourselves before starting the next one.
  // Destroying it deselects the stale range, so the seek pieces are fetched first.
  const key = `${t.infoHash}:${idx}`
  activeStreams.get(key)?.destroy()
  const nodeStream = file.createReadStream({ start, end })
  activeStreams.set(key, nodeStream)
  const untrack = () => {
    if (activeStreams.get(key) === nodeStream) activeStreams.delete(key)
  }
  nodeStream.on("close", untrack)
  nodeStream.on("error", (err) => {
    untrack()
    console.error("[engine] stream error:", err?.message || err)
  })
  // Client disconnected (a seek closes the old request; closing the player closes the last one): destroy
  // the read so its byte range is deselected and stops competing with the next seek for pieces.
  if (signal) {
    if (signal.aborted) nodeStream.destroy()
    else signal.addEventListener("abort", () => nodeStream.destroy(), { once: true })
  }
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
      const removed = new Set(saved.removed ?? [])
      // Each torrent restores to its own saved folder; path-less legacy entries lived in .downloads.
      const t = client.add(source, { path: saved.path || LEGACY_DOWNLOAD_DIR }, (torrent) => {
        // Re-apply the user's deletions so they don't re-download. Rebuild the whole selection (not a
        // per-file deselect) so kept neighbors keep the boundary pieces they share with a deleted file.
        recomputeSelections(torrent, removed)
        saveState()
      })
      // Use saved.infoHash (always present) - t.infoHash can be unset synchronously. `restored` is
      // the last-known size/progress, replayed by snapshot() while this torrent shows as "syncing".
      setMeta(saved.infoHash, {
        paused: !!saved.paused,
        addedAt: saved.addedAt ?? nowUnix(),
        removed,
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
