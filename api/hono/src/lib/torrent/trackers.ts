// Public tracker list, read from the sealed bundle (refreshed out-of-band, no runtime
// fetch). A bundled fallback ships in-code for when the bundle's list is empty.

import { registry } from "@/lib/torrent/registry"

// Bundled fallback: healthy public trackers used only if the bundle's list is empty.
export const BUNDLED_TRACKERS = [
  "udp://tracker.opentrackr.org:1337/announce",
  "udp://open.demonii.com:1337/announce",
  "udp://open.stealth.si:80/announce",
  "udp://tracker.torrent.eu.org:451/announce",
  "udp://explodie.org:6969/announce",
  "udp://open.tracker.cl:1337/announce",
  "udp://tracker.qu.ax:6969/announce",
  "udp://tracker-udp.gbitt.info:80/announce",
  "udp://opentracker.io:6969/announce",
  "udp://tracker.dler.org:6969/announce",
]

export type TrackerSync = {
  count: number
  syncedAt: string | null
  ok: boolean
  source: string
  // false only when falling back to the bundled list (bundle list empty).
  live: boolean
}

// The current tracker list: the bundle's set, or the bundled fallback if empty.
export function currentTrackers(): string[] {
  const list = registry().trackers.list
  return list.length ? list : BUNDLED_TRACKERS
}

export function getTrackerSync(): TrackerSync {
  const { trackers, generatedAt } = registry()
  const live = trackers.list.length > 0
  return {
    count: live ? trackers.list.length : BUNDLED_TRACKERS.length,
    syncedAt: generatedAt,
    ok: live,
    source: trackers.source,
    live,
  }
}

// Build a magnet URI, appending the current tracker set. Every provider routes through
// here, so a refreshed bundle propagates to all of them at once.
export function buildMagnet(infoHash: string, name?: string): string {
  const params = [`xt=urn:btih:${infoHash}`]
  if (name) params.push(`dn=${encodeURIComponent(name)}`)
  for (const tr of currentTrackers()) params.push(`tr=${encodeURIComponent(tr)}`)
  return `magnet:?${params.join("&")}`
}
