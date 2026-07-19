// A small, dependency-free parser for release/torrent names. It extracts a clean, readable
// title (plus year and season/episode when present) by cutting the name at the first "release
// tag" (year, SxxExx, resolution, source, codec, ...). It is deliberately heuristic: good
// enough for a display name on its own, and refined by the on-device model when available.
// The structured fields it returns also feed the Jellyfin library layout in Phase 2.

export type ParsedName = {
  title: string
  year?: number
  season?: number
  episode?: number
}

const MEDIA_EXT =
  /\.(mkv|mp4|avi|mov|m4v|ts|webm|iso|img|dmg|pkg|exe|msi|zip|rar|7z|flac|mp3|m4a|epub|pdf|cbz|cbr)$/i

const YEAR = /^(?:19|20)\d{2}$/
const SXXEYY = /^s(\d{1,2})e(\d{1,3})$/i
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

const isTag = (t: string) =>
  YEAR.test(t) ||
  SXXEYY.test(t) ||
  SEASON_ONLY.test(t) ||
  NxYY.test(t) ||
  TAGS.some((re) => re.test(t))

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

// Title-case purely-lowercase words so lowercase sources read nicely, keeping small connector
// words lowercase (except the first word), and leaving numbers, versions, and already-cased
// acronyms (UHD, AMD64) untouched.
function toTitleCase(tokens: string[]): string {
  return tokens
    .map((w, i) => {
      if (!/^[a-z]+$/.test(w)) return w
      if (i > 0 && SMALL_WORDS.has(w)) return w
      return w[0].toUpperCase() + w.slice(1)
    })
    .join(" ")
    .trim()
}

export function parseTorrentName(raw: string): ParsedName {
  let s = raw.replace(MEDIA_EXT, "")
  // Drop bracketed group/quality tags like [HorribleSubs] or [1080p] entirely.
  s = s.replace(/\[[^\]]*\]/g, " ")
  // Scene separators (dots/underscores/hyphens) become spaces. This also splits the trailing
  // "-ReleaseGroup", which then falls past the title cut below.
  const tokens = s
    .replace(/[-._]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .map((t) => t.replace(/^[([]+|[)\]]+$/g, "")) // strip surrounding brackets/parens
    .filter(Boolean)

  let year: number | undefined
  let season: number | undefined
  let episode: number | undefined
  let cut = tokens.length
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i]
    const se = tok.match(SXXEYY) ?? tok.match(NxYY)
    if (se) {
      season ??= Number(se[1])
      episode ??= Number(se[2])
    } else if (SEASON_ONLY.test(tok)) {
      season ??= Number(tok.slice(1))
    } else if (YEAR.test(tok)) {
      year ??= Number(tok)
    } else if (!isTag(tok)) {
      continue
    }
    if (cut === tokens.length) cut = i
  }

  let titleTokens = tokens.slice(0, cut)
  if (titleTokens.length === 0) titleTokens = tokens // name was all tags: keep everything
  const title = toTitleCase(titleTokens)
  return { title, year, season, episode }
}

const pad2 = (n: number) => String(n).padStart(2, "0")

// Compose a readable display name from the parsed fields. TV gets an SxxExx suffix, movies get
// a (year); anything else is just the cleaned title.
export function toDisplayName(p: ParsedName): string {
  const title = p.title.trim()
  if (!title) return ""
  if (p.season != null && p.episode != null) return `${title} S${pad2(p.season)}E${pad2(p.episode)}`
  if (p.year) return `${title} (${p.year})`
  return title
}

export function cleanNameFromRaw(raw: string): string {
  return toDisplayName(parseTorrentName(raw))
}
