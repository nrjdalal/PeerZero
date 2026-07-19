// Typed seam over the in-process WebTorrent engine (./webtorrent.mjs): the Hono routers call
// these functions, which drive the WebTorrent client running in this same Bun process. It used
// to be a separate sidecar reached over HTTP; now it's in-process, so there is no port, no fetch
// hop, and a torrent operation is a direct call. One module so the backend stays swappable.

import * as wt from "./webtorrent.mjs"

export type TorrentFile = {
  name: string
  path: string
  length: number
  downloaded: number
  progress: number
}

export type TorrentSnapshot = {
  infoHash: string
  name: string
  magnetURI: string
  length: number
  downloaded: number
  uploaded: number
  downloadSpeed: number
  uploadSpeed: number
  progress: number
  numPeers: number
  seeders: number
  timeRemaining: number | null
  ratio: number
  done: boolean
  ready: boolean
  // Restored torrent re-verifying its on-disk pieces on boot (shows as "Syncing" until ready).
  syncing: boolean
  paused: boolean
  addedAt: number // unix seconds the torrent was added, 0 if unknown
  downloadDir: string
  files: TorrentFile[]
}

// Kept for the routers' error mapping: a thrown EngineError carries the HTTP status to return.
export class EngineError extends Error {
  constructor(
    message: string,
    readonly status = 502,
  ) {
    super(message)
  }
}

// Range-capable byte stream of a torrent file, as a Web Response (video player + external-player
// handoff). Returns a 404/416 Response for a missing file or bad range - it does not throw.
export function engineStream(infoHash: string, fileIdx: string | number, range?: string): Response {
  return wt.streamFile(infoHash, Number(fileIdx), range)
}

export const engine = {
  // In-process: the client is always live once this module loaded.
  health(): boolean {
    return true
  },
  list(): TorrentSnapshot[] {
    return wt.list() as TorrentSnapshot[]
  },
  async add(magnet: string): Promise<TorrentSnapshot> {
    try {
      return (await wt.add(magnet)) as TorrentSnapshot
    } catch (err) {
      throw new EngineError((err as Error)?.message || "failed to add torrent", 400)
    }
  },
  pause(infoHash: string): TorrentSnapshot {
    const snap = wt.pause(infoHash)
    if (!snap) throw new EngineError("not found", 404)
    return snap as TorrentSnapshot
  },
  resume(infoHash: string): TorrentSnapshot {
    const snap = wt.resume(infoHash)
    if (!snap) throw new EngineError("not found", 404)
    return snap as TorrentSnapshot
  },
  async remove(infoHash: string, destroyStore: boolean): Promise<boolean> {
    return wt.remove(infoHash, destroyStore)
  },
  getSettings(): { downloadDir: string } {
    return wt.getSettings()
  },
  setSettings(downloadDir: string): { downloadDir: string } {
    try {
      return wt.setSettings(downloadDir)
    } catch (err) {
      throw new EngineError((err as Error)?.message || "failed to set download dir", 400)
    }
  },
  // Open the download folder in the OS file manager.
  openDir(): boolean {
    return wt.openDownloadDir()
  },
  // Reveal (select) a torrent's downloaded folder/file in the OS file manager.
  reveal(infoHash: string): boolean {
    return wt.revealTorrent(infoHash)
  },
  // Open a native folder picker on the host; returns the chosen (and now-active) folder.
  async chooseDir(): Promise<{ downloadDir: string; chosen: boolean }> {
    return wt.chooseDir()
  },
}
