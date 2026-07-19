// Media library layout for the engine's hardlink organizer.
//
// When a video torrent finishes, the engine hardlinks its files into a Jellyfin-friendly library
// (Movies/... and Shows/...) so third-party scanners (Jellyfin, Plex, ...) can identify them by
// "Title (Year)" without any remote calls. Hardlinks keep the original download in place and
// untouched (same inode, no extra disk, seeding/reveal/delete all keep working on the canonical
// files) - we never move or rename what webtorrent wrote.
//
// The release-name parser here is a deliberate, trimmed sibling of
// web/next/src/lib/torrent-name/parse.ts (which produces the in-app display name). It lives in
// the engine because the engine is a standalone sidecar (plain .mjs, webtorrent-only) that runs
// headless and can't import the web app's TypeScript. Keep the shared heuristics (TAGS, title
// casing) roughly in sync with parse.ts when either changes.

import { existsSync, linkSync, mkdirSync, statSync } from "node:fs"
import { basename, dirname, join, resolve, sep } from "node:path"

// Video containers a media server scans; only these get linked into the library. `sample` clips
// are skipped so a release's throwaway preview never lands next to the real file.
const VIDEO_EXT = /\.(mkv|mp4|avi|mov|m4v|ts|m2ts|webm|mpg|mpeg|wmv|flv)$/i

// Real file extensions to strip before parsing a name. Deliberately a known list, not a generic
// ".<tail>", so a codec-group segment like "x265-GROUP" (which merely looks like an extension) is
// kept and recognized. The true extension is read separately by extOf().
const STRIP_EXT =
  /\.(mkv|mp4|avi|mov|m4v|ts|m2ts|webm|mpg|mpeg|wmv|flv|iso|img|srt|ass|ssa|sub|idx|nfo|jpe?g|png|pdf|epub|cbz|cbr|flac|mp3|m4a|wav|opus|zip|rar|7z)$/i

const YEAR = /^(?:19|20)\d{2}$/
// Also captures a multi-episode range (S01E01E02 / S01E01-E02) as the optional 3rd group.
const SXXEYY = /^s(\d{1,2})e(\d{1,3})(?:-?e(\d{1,3}))?$/i
const SEASON_ONLY = /^s(\d{1,2})$/i
const NxYY = /^(\d{1,2})x(\d{1,3})$/i

// Whole-token markers that end the human-readable title portion of a scene/p2p name.
const TAGS = [
  /^(?:season|episode|complete|part|vol|volume)$/i,
  /^\d{3,4}p$/i, // 1080p
  /^(?:4k|uhd|hdr|hdr10|hdr10\+|dv|sdr|10bit|8bit)$/i,
  /^(?:bluray|bdrip|brrip|brip|webrip|webdl|web|hdtv|pdtv|dvdrip|dvdr|dvd|hdrip|remux|cam|telesync|scr|screener)$/i,
  /^(?:x264|x265|h264|h265|hevc|avc|xvid|divx|av1|vp9)$/i,
  /^(?:aac|ac3|eac3|dd|ddp|dd5|ddp5|dts|truehd|atmos|flac|mp3|opus)$/i,
  /^(?:proper|repack|internal|extended|unrated|uncut|remastered|limited|multi|dual|subbed|dubbed)$/i,
  /^(?:amzn|nf|dsnp|hmax|atvp|hulu|pcok|stan|red|max)$/i,
]

const isTag = (t) =>
  YEAR.test(t) ||
  SXXEYY.test(t) ||
  SEASON_ONLY.test(t) ||
  NxYY.test(t) ||
  TAGS.some((re) => re.test(t))

// Quality/source/edition terms worth keeping, mapped to a clean display form. These become the
// Jellyfin "version" suffix (e.g. "Movie (Year) - 2160p BluRay Remux.mkv"), so different releases
// of the same title stay distinct instead of colliding, and the info isn't lost. Jellyfin ignores
// this suffix for identification but shows it as the version label. Kept free of periods and commas
// (Jellyfin rejects those in version labels), and audio/channel tags (DDP5.1, Atmos) are dropped
// since they carry dots and aren't useful version distinguishers. Resolutions (\d{3,4}p/i) are
// matched separately, so only the non-numeric terms live here.
const QUALITY_TERMS = {
  // source / media
  bluray: "BluRay",
  bdrip: "BDRip",
  brrip: "BRRip",
  brip: "BRRip",
  webrip: "WEBRip",
  webdl: "WEB",
  web: "WEB",
  hdtv: "HDTV",
  pdtv: "PDTV",
  dvdrip: "DVDRip",
  dvdr: "DVD",
  dvd: "DVD",
  hdrip: "HDRip",
  remux: "Remux",
  cam: "CAM",
  telesync: "TS",
  // codec
  x264: "x264",
  x265: "x265",
  h264: "H264",
  h265: "H265",
  hevc: "HEVC",
  avc: "AVC",
  xvid: "XviD",
  divx: "DivX",
  av1: "AV1",
  vp9: "VP9",
  // resolution shorthands + dynamic range / color
  "4k": "4K",
  uhd: "UHD",
  hdr: "HDR",
  hdr10: "HDR10",
  "hdr10+": "HDR10+",
  dv: "DV",
  sdr: "SDR",
  "10bit": "10bit",
  hlg: "HLG",
  // edition
  extended: "Extended",
  unrated: "Unrated",
  uncut: "Uncut",
  remastered: "Remastered",
  imax: "IMAX",
  theatrical: "Theatrical",
  proper: "Proper",
  repack: "Repack",
  limited: "Limited",
}

// Map one token to its clean quality label, or null when it isn't a quality term (titles, years,
// release-group names, audio tags all drop out here).
function qualityLabel(tok) {
  const low = tok.toLowerCase()
  if (/^\d{3,4}[pi]$/.test(low)) return low // 1080p, 720p, 1080i
  return QUALITY_TERMS[low] ?? null
}

// Build the Jellyfin version suffix from the tokens after the title cut: the recognized quality
// terms in their original order, de-duplicated. Empty string when there's nothing to add.
function qualityTags(tailTokens) {
  const out = []
  for (const tok of tailTokens) {
    const label = qualityLabel(tok)
    if (label && !out.includes(label)) out.push(label)
  }
  return out.join(" ")
}

// Connector words that stay lowercase in title case, unless they lead the title.
const SMALL_WORDS = new Set([
  "a",
  "an",
  "and",
  "as",
  "at",
  "but",
  "by",
  "for",
  "in",
  "of",
  "on",
  "or",
  "the",
  "to",
  "via",
  "vs",
  "with",
])

function toTitleCase(tokens) {
  return tokens
    .map((w, i) => {
      if (!/^[a-z]+$/.test(w)) return w
      if (i > 0 && SMALL_WORDS.has(w)) return w
      return w[0].toUpperCase() + w.slice(1)
    })
    .join(" ")
    .trim()
}

const pad2 = (n) => String(n).padStart(2, "0")

const extOf = (fileName) => {
  const m = fileName.match(/\.([^.]+)$/)
  return m ? m[1].toLowerCase() : ""
}

// A video file worth linking: a known container that isn't a throwaway sample.
export const isVideoFile = (fileName) => VIDEO_EXT.test(fileName) && !/\bsample\b/i.test(fileName)

// Parse a release name into { title, year?, season?, episode?, episodeEnd?, tags }. Unlike parse.ts
// this returns an empty title (rather than falling back to the raw tokens) when the name is all
// tags, so a file named just "S01E01.mkv" borrows its show title from the torrent instead of
// becoming "S01E01". `tags` is the cleaned quality/source/edition suffix (see qualityTags);
// `episodeEnd` is set for multi-episode files (S01E01-E02).
export function parseMediaName(raw) {
  let s = String(raw || "").replace(STRIP_EXT, "") // drop a known extension (never a codec tail)
  // Join a multi-episode marker (S01E01-E02 / S01E01.E02 / S01E01 E02) into a single token so the
  // separator normalization below doesn't split the second episode off into its own token.
  s = s.replace(/(s\d{1,2}e\d{1,3})[-._ ]*e(\d{1,3})/gi, "$1E$2")
  s = s.replace(/\[[^\]]*\]/g, " ") // drop [group]/[quality] tags
  const tokens = s
    .replace(/[-._]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .map((t) => t.replace(/^[([]+|[)\]]+$/g, ""))
    .filter(Boolean)

  let year
  let season
  let episode
  let episodeEnd
  let cut = tokens.length
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i]
    const se = tok.match(SXXEYY) ?? tok.match(NxYY)
    if (se) {
      season ??= Number(se[1])
      episode ??= Number(se[2])
      if (se[3] && episodeEnd === undefined) episodeEnd = Number(se[3])
    } else if (SEASON_ONLY.test(tok)) {
      season ??= Number(tok.slice(1))
    } else if (YEAR.test(tok)) {
      year ??= Number(tok)
    } else if (!isTag(tok)) {
      continue
    }
    if (cut === tokens.length) cut = i
  }

  const title = toTitleCase(tokens.slice(0, cut))
  const tags = qualityTags(tokens.slice(cut))
  return { title, year, season, episode, episodeEnd, tags }
}

// Strip characters illegal in file names on Windows/macOS while keeping spaces and hyphens, then
// tidy whitespace. Trailing dots and spaces are removed too (Windows rejects them).
function fsSafe(name) {
  return String(name || "")
    .replace(/[<>:"/\\|?*]/g, "")
    .replace(/\s+/g, " ")
    .replace(/[. ]+$/g, "")
    .trim()
}

// Build the Jellyfin-relative destination for one parsed video file, or null when it can't be
// classified safely. The `tags` suffix (quality/source/edition) is appended after " - " so
// Jellyfin treats releases of the same title as selectable versions instead of colliding.
//   TV (season + episode): "Shows/Title (Year)/Season NN/Title SxxEyy[-Ezz][ - tags].ext"
//     (year optional; multi-episode files get the -Ezz range).
//   Movie (year): "Movies/Title (Year)/Title (Year)[ - tags].ext".
//   Yearless single movie (only when allowYearlessMovie): "Movies/Title/Title[ - tags].ext".
// The movie/episode file name always begins with the folder name, as Jellyfin's multi-version
// matching requires.
export function jellyfinRelPath(
  { title, year, season, episode, episodeEnd, ext, tags },
  { allowYearlessMovie } = {},
) {
  const t = fsSafe(title)
  if (!t || !ext) return null
  const suffix = tags ? ` - ${tags}` : ""
  if (season != null && episode != null) {
    const showFolder = year ? `${t} (${year})` : t
    const ep = episodeEnd != null ? `E${pad2(episode)}-E${pad2(episodeEnd)}` : `E${pad2(episode)}`
    return join(
      "Shows",
      showFolder,
      `Season ${pad2(season)}`,
      `${t} S${pad2(season)}${ep}${suffix}.${ext}`,
    )
  }
  if (year != null) {
    const folder = `${t} (${year})`
    return join("Movies", folder, `${folder}${suffix}.${ext}`)
  }
  if (allowYearlessMovie) return join("Movies", t, `${t}${suffix}.${ext}`)
  return null
}

// Given a torrent's canonical name and its file list ([{ name, path }]), compute the hardlink
// targets: { srcRel, destRel }. srcRel is the file's path within the download folder (webtorrent's
// file.path, which already includes the torrent's own folder); destRel is relative to the library
// root. Each video file is parsed on its own (so per-episode names resolve individually), borrowing
// the show title/year/season from the torrent name when the file name omits them. A yearless movie
// is only linked when it's the torrent's single video file (avoids scattering ambiguous packs).
export function libraryTargets(torrentName, files) {
  const videos = (files || []).filter((f) => isVideoFile(f.name))
  if (videos.length === 0) return []
  const parent = parseMediaName(torrentName)
  const allowYearlessMovie = videos.length === 1
  const targets = []
  for (const f of videos) {
    const p = parseMediaName(f.name)
    const destRel = jellyfinRelPath(
      {
        title: p.title || parent.title,
        year: p.year ?? parent.year,
        season: p.season ?? parent.season,
        episode: p.episode, // episode is per-file: never borrowed from the torrent name
        episodeEnd: p.episodeEnd,
        // Prefer the file's own quality tags; fall back to the torrent's (e.g. a season pack whose
        // episode files are named bare "S01E01.mkv" but the torrent carries "1080p WEB").
        tags: p.tags || parent.tags,
        ext: extOf(f.name),
      },
      { allowYearlessMovie },
    )
    if (destRel) targets.push({ srcRel: f.path, destRel })
  }
  return targets
}

// Insert a " (n)" counter before the file extension: ".../Movie (1999).mkv" -> ".../Movie (1999) (2).mkv".
function withCounter(p, n) {
  const base = basename(p)
  const dot = base.lastIndexOf(".")
  const stem = dot > 0 ? base.slice(0, dot) : base
  const ext = dot > 0 ? base.slice(dot) : ""
  return join(dirname(p), `${stem} (${n})${ext}`)
}

// Resolve where `src` should be linked under `destBase`, handling name collisions. Returns the
// first candidate path that is free, or a " (n)" variant when the base name is taken by a DIFFERENT
// file (a distinct release of the same title -> a new Jellyfin "version"). Returns null when `src`
// is already linked at one of the candidates (idempotent: a re-run, or the same file re-verified),
// so the caller neither re-links nor duplicates. Gives up (null) after a sane number of collisions.
function freeLinkTarget(src, destBase) {
  let srcIno
  try {
    srcIno = statSync(src).ino
  } catch {
    return null
  }
  for (let n = 1; n <= 40; n++) {
    const candidate = n === 1 ? destBase : withCounter(destBase, n)
    if (!existsSync(candidate)) return candidate
    try {
      if (statSync(candidate).ino === srcIno) return null // src is already linked here
    } catch {
      /* candidate vanished mid-check; fall through and try the next counter */
    }
  }
  return null
}

// Hardlink every target from `base` (the download folder) into `libRoot` (the library root),
// creating parent folders as needed. Returns the number of files linked (an already-present link
// counts as linked - the operation is idempotent). A destination whose base name is taken by a
// different release gets a " (2)", " (3)" ... suffix so both appear as Jellyfin versions instead
// of one silently winning. Silently skips a target that escapes the library root or whose source
// is missing; other errors are reported via onError so one bad file never aborts the rest. The
// caller is responsible for the same-filesystem check (a hardlink can't cross devices).
export function hardlinkTargets(base, libRoot, targets, { onError } = {}) {
  const rootPrefix = libRoot.endsWith(sep) ? libRoot : libRoot + sep
  let linked = 0
  for (const { srcRel, destRel } of targets) {
    const src = resolve(base, srcRel)
    const destBase = resolve(libRoot, destRel)
    if (destBase !== libRoot && !destBase.startsWith(rootPrefix)) continue // path-traversal guard
    if (!existsSync(src)) continue
    const dest = freeLinkTarget(src, destBase)
    if (!dest) {
      linked++ // already linked at this name (or a numbered variant) - nothing to do
      continue
    }
    try {
      mkdirSync(dirname(dest), { recursive: true })
      linkSync(src, dest)
      linked++
    } catch (err) {
      if (err?.code === "EEXIST") {
        linked++ // raced with another writer to the same name; treat as linked
        continue
      }
      onError?.(dest, err)
    }
  }
  return linked
}

// True when two paths live on the same filesystem (a hardlink can't cross devices). Both paths
// must already exist.
export function sameFilesystem(a, b) {
  try {
    return statSync(a).dev === statSync(b).dev
  } catch {
    return false
  }
}
