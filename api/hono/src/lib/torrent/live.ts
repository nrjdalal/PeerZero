import type { WSContext } from "hono/ws"

import { engine, type TorrentSnapshot } from "@/lib/torrent/engine"

// One process-wide broadcaster: a single poller caches the snapshot and fans it out
// synchronously. A failed poll keeps the last snapshot, so a poll blip can't freeze the feed.

const clients = new Map<object, WSContext>()
let latest: TorrentSnapshot[] = []
let poller: ReturnType<typeof setInterval> | null = null

async function tick() {
  try {
    latest = await engine.list()
  } catch {
    return // engine blip: keep the last snapshot, keep the feed alive
  }
  const frame = JSON.stringify({ torrents: latest })
  for (const ws of clients.values()) {
    try {
      ws.send(frame)
    } catch {
      /* client already gone; onClose will remove it */
    }
  }
}

// hono/bun hands a fresh WSContext to each event, but ws.raw (the underlying socket) is
// stable for the connection, so it's the identity key.
const key = (ws: WSContext): object => (ws.raw as object) ?? ws

export function addLiveClient(ws: WSContext) {
  clients.set(key(ws), ws)
  if (!poller) poller = setInterval(() => void tick(), 1000)
  ws.send(JSON.stringify({ torrents: latest })) // immediate paint from the cache
}

export function removeLiveClient(ws: WSContext) {
  clients.delete(key(ws))
  if (clients.size === 0 && poller) {
    clearInterval(poller)
    poller = null
  }
}
