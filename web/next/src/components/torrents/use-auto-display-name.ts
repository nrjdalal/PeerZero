"use client"

import type { TorrentSnapshot } from "@api/hono"
import { useEffect, useRef } from "react"

import { apiClient, unwrap } from "@/lib/api/client"
import { torrentNameGenerator } from "@/lib/torrent-name"

// infoHashes added via the UI in this session. Only these are eligible for auto-naming, so
// restored/existing torrents are never renamed (per spec), and app restart / list refresh /
// WebSocket updates / duplicate adds never retrigger generation.
const newlyAdded = new Set<string>()

export function markNewlyAdded(infoHash: string | undefined | null) {
  if (infoHash) newlyAdded.add(infoHash.toLowerCase())
}

// Watches the live torrent list and, once a genuinely-new torrent has meaningful metadata,
// asynchronously generates a clean display name and persists it. Runs at most once per torrent
// (guarded by `attempted`), never blocks the add or the download, and no-ops on any failure.
export function useAutoDisplayName(torrents: TorrentSnapshot[]) {
  const attempted = useRef(new Set<string>())

  useEffect(() => {
    for (const t of torrents) {
      const hash = t.infoHash.toLowerCase()
      if (!newlyAdded.has(hash)) continue // only torrents added via the UI this session
      if (t.displayName) continue // already named
      if (attempted.current.has(hash)) continue // one attempt per torrent
      // Wait for a meaningful original name (metadata resolved); skip restored torrents still
      // re-verifying their pieces (syncing) or ones showing only the infoHash placeholder.
      if (t.syncing || !t.name || t.name === t.infoHash) continue

      attempted.current.add(hash)
      void generateAndPersist(t)
    }
  }, [torrents])
}

async function generateAndPersist(t: TorrentSnapshot) {
  try {
    const displayName = await torrentNameGenerator.generateName({
      originalName: t.name,
      files: t.files,
    })
    if (!displayName) return
    // The torrent may have been removed while we generated; the PATCH then 404s harmlessly and
    // is swallowed below. The live feed picks up the new displayName on its next frame.
    await unwrap(
      apiClient.torrents[":infoHash"].$patch({
        param: { infoHash: t.infoHash },
        json: { displayName },
      }),
    )
  } catch {
    /* generation or persistence failure is harmless: the original name stays. */
  }
}
