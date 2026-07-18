// Data-driven providers: each is a ProviderDef that one executor fetches and maps to
// SearchResult[]. The list is loaded from the registry at runtime (see registry.ts).

import { registry } from "@/lib/torrent/registry"
import {
  decodeEntities,
  getPath,
  infoHashFromMagnet,
  isValidInfoHash,
  parseBinarySize,
  type Provider,
  type SearchResult,
  toUnixSeconds,
  xmlTag,
} from "@/lib/torrent/shared"
import { buildMagnet } from "@/lib/torrent/trackers"

// A browser-like UA; some hosts 403 the default fetch UA but pass a browser string.
const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"

// Cloudflare / DDoS-Guard interstitials answer 200 with a JS challenge page, not results.
// Treat that as a failure (throw) so the source is marked down and backed off, instead of
// silently reporting zero results forever. Cloudflare gates on IP reputation, so a source
// blocked from one network may still work from another; the health canary re-probes it.
const CHALLENGE_RE =
  /just a moment\.\.\.|challenge-platform|cf-browser-verification|_cf_chl|enable javascript and cookies|ddos-guard/i
function assertNotBlocked(body: string, name: string): void {
  if (CHALLENGE_RE.test(body.slice(0, 4000))) throw new Error(`${name} blocked (challenge page)`)
}

// A field is a JSON dot-path (json kind) or an XML tag name (rss kind).
type Field = string

type FieldMap = {
  infoHash?: Field // preferred; else derived from the magnet
  magnet?: Field // used to derive infoHash when infoHash is unset
  name: Field
  size?: Field
  seeders?: Field
  leechers?: Field
  category?: Field
  added?: Field
}

type BaseDef = {
  name: string
  // Directory entry name; when set, the origin is resolved live from the directory.
  directoryName?: string
  defaultOrigin: string
  // Extra request headers (a browser UA is sent by default and can be overridden).
  headers?: Record<string, string>
}

export type ProviderDef = BaseDef &
  (
    | {
        kind: "json"
        method?: "GET" | "POST"
        // Path appended to origin; "{q}" is replaced with the url-encoded query.
        path: string
        // POST body template; "{q}" is replaced with the JSON-escaped query.
        body?: string
        // Dot-path to the array of rows in the response ("" = the root is the array).
        rows: Field
        fields: FieldMap
        // Treat size as a human string ("1.5 GiB") rather than a byte count.
        sizeText?: boolean
      }
    | {
        kind: "rss"
        // Path appended to origin; "{q}" is replaced with the url-encoded query.
        path: string
        // Element that delimits a result; defaults to "item".
        item?: string
        fields: FieldMap
        // Treat the size tag as a raw byte count rather than a human string.
        sizeBytes?: boolean
      }
    | {
        kind: "html"
        // Path appended to origin; "{q}" is replaced with the query.
        path: string
        // Encode query spaces as "+" (many PHP search pages expect this).
        plusQuery?: boolean
        // Collapse whitespace runs to single spaces so patterns can use ".+?" across the
        // source's original newlines.
        collapse?: boolean
        // Add the dotall flag so "." spans newlines (for feeds left un-collapsed).
        dotAll?: boolean
        // One global regex whose named groups map to fields. Recognized group names:
        // infoHash (a bare 40-hex hash or any string containing one), magnet (a full
        // URI), name, size, seeders, leechers, added. Each match is one result row.
        pattern: string
      }
  )

// Assemble a SearchResult from raw fields, or null to drop the row. A row without a
// valid infohash is dropped (dedup and magnet-building both need one).
function assemble(
  source: string,
  raw: {
    infoHash?: string
    magnet?: string
    name?: string
    size: number
    seeders: number
    leechers: number
    category?: string
    added: number
  },
): SearchResult | null {
  let infoHash = (raw.infoHash ?? "").toLowerCase()
  if (!isValidInfoHash(infoHash) && raw.magnet) infoHash = infoHashFromMagnet(raw.magnet)
  if (!isValidInfoHash(infoHash)) return null
  const name = raw.name ?? ""
  return {
    source,
    name,
    infoHash,
    // Always rebuild from the infohash so results carry our live-synced trackers.
    magnet: buildMagnet(infoHash, name),
    sizeBytes: raw.size,
    seeders: raw.seeders,
    leechers: raw.leechers,
    category: raw.category ?? "",
    added: raw.added,
  }
}

function num(value: unknown): number {
  return Number(value) || 0
}

async function runJson(
  def: Extract<ProviderDef, { kind: "json" }>,
  query: string,
  origin: string,
  signal: AbortSignal,
): Promise<SearchResult[]> {
  const url = origin + def.path.replace("{q}", encodeURIComponent(query))
  const method = def.method ?? "GET"
  const headers: Record<string, string> = {
    accept: "application/json",
    "user-agent": BROWSER_UA,
    ...def.headers,
  }
  let body: string | undefined
  if (method === "POST" && def.body) {
    headers["content-type"] ??= "application/json"
    body = def.body.replace("{q}", JSON.stringify(query).slice(1, -1))
  }
  const res = await fetch(url, { method, headers, body, signal })
  if (!res.ok) throw new Error(`${def.name} ${res.status}`)
  const json = await res.json()
  const rows = getPath(json, def.rows)
  if (!Array.isArray(rows)) return []
  const f = def.fields
  return rows
    .map((row) =>
      assemble(def.name, {
        infoHash: f.infoHash ? String(getPath(row, f.infoHash) ?? "") : undefined,
        magnet: f.magnet ? String(getPath(row, f.magnet) ?? "") : undefined,
        name: String(getPath(row, f.name) ?? ""),
        size: def.sizeText
          ? parseBinarySize(String(getPath(row, f.size ?? "") ?? ""))
          : num(f.size ? getPath(row, f.size) : 0),
        seeders: num(f.seeders ? getPath(row, f.seeders) : 0),
        leechers: num(f.leechers ? getPath(row, f.leechers) : 0),
        category: f.category ? String(getPath(row, f.category) ?? "") : "",
        added: f.added ? toUnixSeconds(getPath(row, f.added)) : 0,
      }),
    )
    .filter((r): r is SearchResult => r !== null)
}

async function runRss(
  def: Extract<ProviderDef, { kind: "rss" }>,
  query: string,
  origin: string,
  signal: AbortSignal,
): Promise<SearchResult[]> {
  const url = origin + def.path.replace("{q}", encodeURIComponent(query))
  const res = await fetch(url, {
    signal,
    headers: { "user-agent": BROWSER_UA, ...def.headers },
  })
  if (!res.ok) throw new Error(`${def.name} ${res.status}`)
  const xml = await res.text()
  assertNotBlocked(xml, def.name)
  const item = def.item ?? "item"
  const chunks = xml.split(`<${item}>`).slice(1)
  const f = def.fields
  const get = (chunk: string, field?: Field) => (field ? xmlTag(chunk, field) : "")
  return chunks
    .map((chunk) =>
      assemble(def.name, {
        infoHash: f.infoHash ? get(chunk, f.infoHash) : undefined,
        magnet: f.magnet ? decodeEntities(get(chunk, f.magnet)) : undefined,
        name: decodeEntities(get(chunk, f.name)),
        size: def.sizeBytes ? num(get(chunk, f.size)) : parseBinarySize(get(chunk, f.size)),
        seeders: num(get(chunk, f.seeders)),
        leechers: num(get(chunk, f.leechers)),
        category: get(chunk, f.category),
        added: toUnixSeconds(get(chunk, f.added)),
      }),
    )
    .filter((r): r is SearchResult => r !== null)
}

function stripTags(s: string): string {
  return s.replace(/<[^>]*>/g, "")
}

async function runHtml(
  def: Extract<ProviderDef, { kind: "html" }>,
  query: string,
  origin: string,
  signal: AbortSignal,
): Promise<SearchResult[]> {
  const q = def.plusQuery
    ? encodeURIComponent(query).replace(/%20/g, "+")
    : encodeURIComponent(query)
  const url = origin + def.path.replace("{q}", q)
  const res = await fetch(url, {
    signal,
    headers: { "user-agent": BROWSER_UA, ...def.headers },
  })
  if (!res.ok) throw new Error(`${def.name} ${res.status}`)
  let html = await res.text()
  assertNotBlocked(html, def.name)
  if (def.collapse) html = html.replace(/\s+/g, " ")
  const re = new RegExp(def.pattern, def.dotAll ? "gs" : "g")
  const out: SearchResult[] = []
  for (const m of html.matchAll(re)) {
    const g = m.groups ?? {}
    const result = assemble(def.name, {
      // infoHash may be a bare hash or an href/path containing one.
      infoHash: g.infoHash ? (/[0-9a-fA-F]{40}/.exec(g.infoHash)?.[0] ?? "") : undefined,
      magnet: g.magnet ? decodeEntities(g.magnet) : undefined,
      name: g.name ? decodeEntities(stripTags(g.name)) : "",
      size: parseBinarySize((g.size ?? "").replace(/&nbsp;/g, " ")),
      seeders: num((g.seeders ?? "").replace(/,/g, "")),
      leechers: num((g.leechers ?? "").replace(/,/g, "")),
      category: "",
      added: g.added ? toUnixSeconds(g.added) : 0,
    })
    if (result) out.push(result)
  }
  return out
}

// Run one def against a query; throws on transport/HTTP error so the aggregator can
// mark the source failed.
export function runDef(
  def: ProviderDef,
  query: string,
  origin: string,
  signal: AbortSignal,
): Promise<SearchResult[]> {
  if (def.kind === "json") return runJson(def, query, origin, signal)
  if (def.kind === "rss") return runRss(def, query, origin, signal)
  return runHtml(def, query, origin, signal)
}

// Turn each provider from the registry into a Provider the aggregator fans out over.
// The aggregator supplies the per-provider timeout + abort signal.
export function defProviders(): Provider[] {
  return registry().defs.map((def) => ({
    name: def.name,
    directoryName: def.directoryName,
    defaultOrigin: def.defaultOrigin,
    search: (query, origin, signal) => runDef(def, query, origin, signal),
  }))
}
