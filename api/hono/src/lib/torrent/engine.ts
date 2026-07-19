// Thin HTTP client to the WebTorrent sidecar (api/torrent-engine): a separate Bun process
// so a crashing torrent can't take the backend down. One module so the backend is swappable.

import { env } from "@packages/env/api-hono"

const BASE = env.TORRENT_ENGINE_URL.replace(/\/$/, "")

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
  // Optional locally-generated clean name (AI/parser). The UI shows `displayName ?? name`;
  // reveal/delete and all on-disk paths always use the canonical `name`.
  displayName?: string
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

export class EngineError extends Error {
  constructor(
    message: string,
    readonly status = 502,
  ) {
    super(message)
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${BASE}${path}`, init)
  } catch {
    throw new EngineError("torrent engine unreachable (is the sidecar running?)", 503)
  }
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (!res.ok) {
    const message = typeof body.error === "string" ? body.error : `engine ${res.status}`
    throw new EngineError(message, res.status)
  }
  return body as T
}

export const engine = {
  async health(): Promise<boolean> {
    try {
      await call("/health")
      return true
    } catch {
      return false
    }
  },
  async list(): Promise<TorrentSnapshot[]> {
    const { torrents } = await call<{ torrents: TorrentSnapshot[] }>("/torrents")
    return torrents
  },
  async add(magnet: string): Promise<TorrentSnapshot> {
    const { torrent } = await call<{ torrent: TorrentSnapshot }>("/torrents", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ magnet }),
    })
    return torrent
  },
  async pause(infoHash: string): Promise<TorrentSnapshot> {
    const { torrent } = await call<{ torrent: TorrentSnapshot }>(`/torrents/${infoHash}/pause`, {
      method: "POST",
    })
    return torrent
  },
  async resume(infoHash: string): Promise<TorrentSnapshot> {
    const { torrent } = await call<{ torrent: TorrentSnapshot }>(`/torrents/${infoHash}/resume`, {
      method: "POST",
    })
    return torrent
  },
  async remove(infoHash: string, destroyStore: boolean): Promise<boolean> {
    const { ok } = await call<{ ok: boolean }>(
      `/torrents/${infoHash}?destroyStore=${destroyStore ? "true" : "false"}`,
      { method: "DELETE" },
    )
    return ok
  },
  // Persist a locally-generated display name. Cosmetic only: the engine never renames files
  // on disk or touches the canonical torrent name, so reveal/delete stay correct.
  async setDisplayName(infoHash: string, displayName: string): Promise<TorrentSnapshot> {
    const { torrent } = await call<{ torrent: TorrentSnapshot }>(`/torrents/${infoHash}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ displayName }),
    })
    return torrent
  },
  async getSettings(): Promise<{ downloadDir: string }> {
    return call<{ downloadDir: string }>("/settings")
  },
  async setSettings(downloadDir: string): Promise<{ downloadDir: string }> {
    return call<{ downloadDir: string }>("/settings", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ downloadDir }),
    })
  },
  // Open the download folder in the OS file manager.
  async openDir(): Promise<boolean> {
    const { ok } = await call<{ ok: boolean }>("/open", { method: "POST" })
    return ok
  },
  // Reveal (select) a torrent's downloaded folder/file in the OS file manager.
  async reveal(infoHash: string): Promise<boolean> {
    const { ok } = await call<{ ok: boolean }>(`/torrents/${infoHash}/reveal`, { method: "POST" })
    return ok
  },
  // Open a native folder picker on the host; returns the chosen (and now-active) folder.
  async chooseDir(): Promise<{ downloadDir: string; chosen: boolean }> {
    return call<{ downloadDir: string; chosen: boolean }>("/choose-dir", { method: "POST" })
  },
}
