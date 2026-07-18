// The directory of indexes, read from the registry (refreshed out-of-band, no runtime
// fetch). Used for the UI list and domain-rotation resilience.

import type { DirectoryEntry } from "@/lib/torrent/parse"
import { registry } from "@/lib/torrent/registry"

export type { DirectoryEntry } from "@/lib/torrent/parse"

export type Directory = {
  entries: DirectoryEntry[]
  syncedAt: string | null
  ok: boolean
  error?: string
  source: string
}

function build(): Directory {
  const { directory, generatedAt } = registry()
  return {
    entries: directory.entries,
    // Registry generation time, for the UI's "updated X ago".
    syncedAt: generatedAt,
    ok: directory.entries.length > 0,
    source: directory.source,
  }
}

export function getDirectory(): Directory {
  return build()
}

// Async to preserve the previous signature (callers await it); the data is local now.
export async function ensureDirectory(): Promise<Directory> {
  return build()
}

// Current origin for a named directory entry, so a provider can track a rotating domain.
export function directoryOrigin(name: string): string | undefined {
  const target = name.toLowerCase()
  const hit = registry().directory.entries.find((e) => e.name.toLowerCase() === target)
  if (!hit) return undefined
  try {
    return new URL(hit.url).origin
  } catch {
    return undefined
  }
}
