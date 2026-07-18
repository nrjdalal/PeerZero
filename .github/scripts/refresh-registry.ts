// Refresh the dynamic half of the encoded registry (trackers + directory) in place from
// the upstream URLs it records, re-encoding only when the data changed (see codec.ts).

import { resolve } from "node:path"

import { seal, unseal } from "../../api/hono/src/lib/torrent/codec"
import { parseDirectory, parseTrackerList } from "../../api/hono/src/lib/torrent/parse"

const DIR = resolve(import.meta.dir, "../../api/hono/src/lib/torrent")
const ENCODED = resolve(DIR, "registry.json")
const PLAIN = resolve(DIR, "registry.plain.json")
const FETCH_TIMEOUT_MS = 20_000

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
  if (!res.ok) throw new Error(`${url} -> ${res.status}`)
  return res.text()
}

// Load the current registry: decode the committed file, or fall back to the local
// plaintext on the first run (before an encoded file exists).
async function loadRegistry(): Promise<Record<string, unknown>> {
  const wrapper = await Bun.file(ENCODED)
    .json()
    .catch(() => null)
  if (wrapper?.data) {
    const plain = unseal(wrapper.data)
    if (plain) return JSON.parse(plain)
  }
  return Bun.file(PLAIN).json()
}

const current = await loadRegistry()
const trackerUrl = (current.trackers as { source?: string } | undefined)?.source
const directoryUrl = (current.directory as { source?: string } | undefined)?.source
if (!trackerUrl || !directoryUrl) throw new Error("registry is missing its upstream source URLs")

const [trackerText, directoryMd] = await Promise.all([
  fetchText(trackerUrl),
  fetchText(directoryUrl),
])

const trackers = parseTrackerList(trackerText)
const entries = parseDirectory(directoryMd)

// Guard against a partial/empty upstream response overwriting a good registry.
if (!trackers.length) throw new Error("upstream returned no trackers")
if (!entries.length) throw new Error("upstream returned no directory entries")

const next: Record<string, unknown> = {
  ...current,
  trackers: { source: trackerUrl, list: trackers },
  directory: { source: directoryUrl, entries },
}

// Compare ignoring generatedAt so an unchanged run leaves the file untouched.
const stable = (r: Record<string, unknown>) => JSON.stringify({ ...r, generatedAt: null })

if (stable(next) === stable(current)) {
  console.log(`[refresh] no changes (${trackers.length} trackers, ${entries.length} indexes)`)
} else {
  next.generatedAt = new Date().toISOString()
  const encoded = seal(JSON.stringify(next))
  await Bun.write(ENCODED, `${JSON.stringify({ data: encoded }, null, 2)}\n`)
  console.log(`[refresh] wrote ${trackers.length} trackers, ${entries.length} indexes`)
}
