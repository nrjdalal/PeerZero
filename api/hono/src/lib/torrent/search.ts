// Search aggregation: providers from the registry (data-driven ones from defs.ts plus
// hand-mapped bespoke ones) are queried in parallel, deduped by infohash (keeping the
// higher seeder count), and sorted by seeders. Providers fail independently.

import { defProviders } from "@/lib/torrent/defs"
import { directoryOrigin } from "@/lib/torrent/directory"
import {
  getHealthReport,
  type HealthRecord,
  isDisabled,
  recordHealth,
  shouldCanary,
} from "@/lib/torrent/health"
import { type BespokeDef, registry } from "@/lib/torrent/registry"
import { type Provider, type SearchResult, toUnixSeconds } from "@/lib/torrent/shared"
import { buildMagnet } from "@/lib/torrent/trackers"

// Re-exported so the API's public type surface (api/hono/src/index.ts) is unchanged.
export type { SearchResult } from "@/lib/torrent/shared"

const PER_PROVIDER_TIMEOUT_MS = 10_000

// A browser-like UA; some hosts 403 the default fetch UA but pass a browser string.
const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"

// A JSON API whose two-level nesting (results carrying a per-quality array) doesn't fit
// the flat-rows executor, so it's mapped here; origin and path come from the registry.
async function runNestedMovies(
  def: BespokeDef,
  query: string,
  origin: string,
  signal: AbortSignal,
): Promise<SearchResult[]> {
  const url = origin + def.path.replace("{q}", encodeURIComponent(query))
  const res = await fetch(url, {
    signal,
    headers: { accept: "application/json", "user-agent": BROWSER_UA },
  })
  if (!res.ok) throw new Error(`${def.name} ${res.status}`)
  const body = (await res.json()) as { data?: { movies?: Array<Record<string, unknown>> } }
  const movies = body.data?.movies ?? []
  const results: SearchResult[] = []
  for (const m of movies) {
    const title = String(m.title_long ?? m.title ?? "")
    const torrents = Array.isArray(m.torrents) ? (m.torrents as Array<Record<string, unknown>>) : []
    for (const t of torrents) {
      const infoHash = String(t.hash ?? "").toLowerCase()
      if (infoHash.length !== 40) continue
      const quality = [t.quality, t.type].filter(Boolean).join(" ")
      const name = quality ? `${title} [${quality}]` : title
      results.push({
        source: def.name,
        name,
        infoHash,
        magnet: buildMagnet(infoHash, name),
        sizeBytes: Number(t.size_bytes) || 0,
        seeders: Number(t.seeds) || 0,
        leechers: Number(t.peers) || 0,
        category: "Movies",
        added: toUnixSeconds(t.date_uploaded_unix),
      })
    }
  }
  return results
}

// Turn each bespoke provider from the registry into a Provider the aggregator fans out over.
function bespokeProviders(): Provider[] {
  return registry().bespoke.map((def) => ({
    name: def.name,
    directoryName: def.directoryName,
    defaultOrigin: def.defaultOrigin,
    search: (query, origin, signal) => runNestedMovies(def, query, origin, signal),
  }))
}

// Data-driven providers first, then the bespoke ones. Order only affects display and
// dedup tie-breaks.
const PROVIDERS: Provider[] = [...defProviders(), ...bespokeProviders()]

// Query the canary fires at a stale/disabled provider to test if it's alive again.
const CANARY_QUERY = "ubuntu"

// A provider's current origin: its directory-tracked domain if available, else the
// bundled default. One place so search and canary agree.
function resolveOrigin(p: Provider): string {
  return p.directoryName ? (directoryOrigin(p.directoryName) ?? p.defaultOrigin) : p.defaultOrigin
}

// Run one provider's search, timeout-bounded, folding the outcome into its health
// record. Never throws.
async function runProvider(
  p: Provider,
  query: string,
): Promise<{ name: string; ok: boolean; count: number; results: SearchResult[]; error?: string }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), PER_PROVIDER_TIMEOUT_MS)
  const started = Date.now()
  try {
    const results = await p.search(query, resolveOrigin(p), controller.signal)
    recordHealth(p.name, { ok: true, count: results.length, latencyMs: Date.now() - started })
    return { name: p.name, ok: true, count: results.length, results }
  } catch (err) {
    const error = err instanceof Error ? err.message : "failed"
    recordHealth(p.name, { ok: false, count: 0, latencyMs: Date.now() - started, error })
    return { name: p.name, ok: false, count: 0, results: [], error }
  } finally {
    clearTimeout(timer)
  }
}

// Background liveness canary: probe any stale/never-checked/disabled-and-due provider so
// a recovered source re-enables itself. Self-throttled (one sweep at a time); never throws.
let canaryInFlight = false
export function runProviderCanaries(): void {
  if (canaryInFlight) return
  const due = PROVIDERS.filter((p) => shouldCanary(p.name))
  if (!due.length) return
  canaryInFlight = true
  void Promise.allSettled(due.map((p) => runProvider(p, CANARY_QUERY))).finally(() => {
    canaryInFlight = false
  })
}

// Health of every provider, for the /sources endpoint and the UI.
export function providerHealth(): HealthRecord[] {
  return getHealthReport()
}

// The set of active search providers, for display in the UI.
export function activeProviders() {
  return PROVIDERS.map((p) => ({
    name: p.name,
    origin: resolveOrigin(p),
    directoryTracked: Boolean(p.directoryName),
  }))
}

export type SearchOutcome = {
  results: SearchResult[]
  sources: Array<{ name: string; ok: boolean; count: number; error?: string }>
}

export async function searchTorrents(query: string): Promise<SearchOutcome> {
  // Origins and trackers come from the sealed bundle, so nothing is fetched here.

  // Skip auto-disabled providers so a dead source doesn't add its timeout to the search;
  // they're re-probed by the canary and re-enable on recovery. Still reported below so
  // the UI lists them.
  const active = PROVIDERS.filter((p) => !isDisabled(p.name))
  const disabled = PROVIDERS.filter((p) => isDisabled(p.name))

  const settled = await Promise.all(active.map((p) => runProvider(p, query)))

  // Re-probe stale/disabled providers in the background for the next search.
  runProviderCanaries()

  // Dedupe by infohash, keeping the entry with the most seeders (best swarm signal).
  const byHash = new Map<string, SearchResult>()
  for (const s of settled) {
    for (const r of s.results) {
      const existing = byHash.get(r.infoHash)
      if (!existing || r.seeders > existing.seeders) byHash.set(r.infoHash, r)
    }
  }

  const results = [...byHash.values()].sort((a, b) => b.seeders - a.seeders)
  const sources = [
    ...settled.map(({ name, ok, count, error }) => ({ name, ok, count, error })),
    ...disabled.map((p) => ({
      name: p.name,
      ok: false,
      count: 0,
      error: "auto-disabled (repeated failures)",
    })),
  ]
  return { results, sources }
}
