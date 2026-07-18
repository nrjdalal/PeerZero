// Runtime access to the encoded registry (see codec.ts): decoded once and served
// instantly, refreshed in the background from upstream, else the mirror, else last good.

import { env } from "@packages/env/api-hono"

import { unseal } from "@/lib/torrent/codec"
import type { ProviderDef } from "@/lib/torrent/defs"
import { type DirectoryEntry, parseDirectory, parseTrackerList } from "@/lib/torrent/parse"
import encoded from "@/lib/torrent/registry.json"

// A provider the def executor can't express; hand-mapped in search.ts.
export type BespokeDef = {
  name: string
  directoryName?: string
  defaultOrigin: string
  // Path appended to the origin; "{q}" is replaced with the url-encoded query.
  path: string
}

export type Registry = {
  generatedAt: string | null
  trackers: { source: string; list: string[] }
  directory: { source: string; entries: DirectoryEntry[] }
  defs: ProviderDef[]
  bespoke: BespokeDef[]
}

const EMPTY: Registry = {
  generatedAt: null,
  trackers: { source: "", list: [] },
  directory: { source: "", entries: [] },
  defs: [],
  bespoke: [],
}

// Refresh from the sync URL at most once per this interval.
const SYNC_TTL_MS = 6 * 60 * 60 * 1000

// Decode a wrapper into a Registry, or null. Empty payloads are rejected so a bad sync
// can't wipe the working registry.
function decode(wrapper: { data: string }): Registry | null {
  const json = unseal(wrapper.data)
  if (!json) return null
  try {
    const parsed = JSON.parse(json) as Registry
    if (!parsed.defs?.length) return null
    return { ...EMPTY, ...parsed }
  } catch {
    return null
  }
}

let cached: Registry | null = null
let syncing = false
let started = false

async function fetchText(url: string): Promise<string | null> {
  if (!/^https?:\/\//.test(url)) return null
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) })
    return res.ok ? await res.text() : null
  } catch {
    return null
  }
}

// (1) Freshen trackers + directory from the upstream URLs the registry carries. Returns
// true if upstream was reachable (so the mirror can be skipped), false if not.
async function refreshFromUpstream(): Promise<boolean> {
  const base = cached
  if (!base) return false
  const [trackerText, directoryMd] = await Promise.all([
    fetchText(base.trackers.source),
    fetchText(base.directory.source),
  ])
  const list = trackerText ? parseTrackerList(trackerText) : []
  const entries = directoryMd ? parseDirectory(directoryMd) : []
  if (!list.length && !entries.length) return false
  cached = {
    ...base,
    trackers: list.length ? { ...base.trackers, list } : base.trackers,
    directory: entries.length ? { ...base.directory, entries } : base.directory,
    generatedAt: new Date().toISOString(),
  }
  return true
}

// (2) Fall back to the encoded mirror, replacing the whole registry (also how provider
// changes arrive). Returns true if the mirror was reachable and valid.
async function syncFromMirror(): Promise<boolean> {
  const url = env.REGISTRY_SYNC_URL
  if (!/^https?:\/\//.test(url)) return false
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) })
    if (!res.ok) return false
    const next = decode((await res.json()) as { data: string })
    if (!next) return false
    cached = next
    return true
  } catch {
    return false
  }
}

// One refresh cycle: upstream first, then the mirror, else keep the last good registry.
// Never throws.
async function refresh(): Promise<void> {
  if (syncing) return
  syncing = true
  try {
    if (await refreshFromUpstream()) return
    await syncFromMirror()
  } finally {
    syncing = false
  }
}

// Start the background refresh loop (immediate check, then every SYNC_TTL_MS). Idempotent.
// The timer is unref'd so it never keeps the process alive.
export function startRegistrySync(): void {
  if (started) return
  started = true
  if (!cached) cached = decode(encoded as { data: string }) ?? EMPTY
  void refresh()
  const timer = setInterval(() => void refresh(), SYNC_TTL_MS)
  ;(timer as { unref?: () => void }).unref?.()
}

export function registry(): Registry {
  if (!cached) cached = decode(encoded as { data: string }) ?? EMPTY
  startRegistrySync()
  return cached
}
