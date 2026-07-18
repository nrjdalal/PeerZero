// Shared torrent-search types and parsing helpers, kept apart so both the hand-coded
// providers and the data-driven executor share one contract without an import cycle.

export type SearchResult = {
  source: string
  name: string
  infoHash: string
  magnet: string
  sizeBytes: number
  seeders: number
  leechers: number
  category: string
  added: number // unix seconds the torrent was indexed, 0 if unknown
}

export type Provider = {
  name: string
  // Directory entry this provider maps to; when set, its origin resolves from the live
  // directory so a rotated domain doesn't break search.
  directoryName?: string
  defaultOrigin: string
  search: (query: string, origin: string, signal: AbortSignal) => Promise<SearchResult[]>
}

// Parse a value that may be a unix-seconds string/number or an ISO/RSS date string.
export function toUnixSeconds(value: unknown): number {
  if (value == null || value === "") return 0
  const num = Number(value)
  if (Number.isFinite(num) && num > 0) return Math.floor(num)
  const ms = Date.parse(String(value))
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : 0
}

// Parse a binary size like "728.1 GiB" (or "1.5 GB") into bytes.
export function parseBinarySize(text: string): number {
  const m = /([\d.]+)\s*([KMGT]?i?B)/i.exec(text)
  if (!m) return 0
  const value = Number(m[1])
  const unit = m[2].toUpperCase()
  const pow = { B: 0, KIB: 1, MIB: 2, GIB: 3, TIB: 4, KB: 1, MB: 2, GB: 3, TB: 4 }[unit] ?? 0
  return Math.round(value * 1024 ** pow)
}

export function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
}

// First <tag>...</tag> (or namespaced <ns:tag>) inner text within a chunk.
export function xmlTag(chunk: string, tag: string): string {
  const m = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(chunk)
  return m ? m[1].trim() : ""
}

// A 40-hex infohash that isn't the all-zero sentinel some APIs return for "no results".
export function isValidInfoHash(hash: string): boolean {
  return /^[0-9a-f]{40}$/.test(hash) && !/^0{40}$/.test(hash)
}

// Pull the btih infohash out of a magnet URI, lowercased, or "" if absent.
export function infoHashFromMagnet(magnet: string): string {
  const m = /xt=urn:btih:([0-9a-fA-F]{40})/.exec(magnet)
  return m ? m[1].toLowerCase() : ""
}

// Read a dot-path ("a.b.0.c") out of a nested object; "" returns the root value.
export function getPath(obj: unknown, path: string): unknown {
  if (!path) return obj
  let cur: unknown = obj
  for (const key of path.split(".")) {
    if (cur == null) return undefined
    cur = (cur as Record<string, unknown>)[key]
  }
  return cur
}
