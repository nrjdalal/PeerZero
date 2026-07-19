import type { WSContext } from "hono/ws"

import { engine, type TorrentSnapshot } from "@/lib/torrent/engine"

// One process-wide broadcaster: a single poller caches the snapshot and fans it out
// synchronously. A failed poll keeps the last snapshot, so a poll blip can't freeze the feed.

const clients = new Map<object, WSContext>()
let latest: TorrentSnapshot[] = []
// Only true once a real poll has landed. Until then `latest` is just the empty seed, which we
// must never broadcast: the client can't tell a placeholder-empty from a genuine-empty list, so
// it would flash "No torrents yet" before the first real frame arrives.
let primed = false
let poller: ReturnType<typeof setInterval> | null = null

async function tick() {
  try {
    latest = await engine.list()
    primed = true
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
  if (!poller) {
    poller = setInterval(() => void tick(), 1000)
    void tick() // poll now so the first real frame lands in ms, not after the 1s interval
  }
  // Paint immediately only from a real snapshot; if not primed yet, the imminent tick() delivers
  // the first frame, so the client waits on the loader instead of flashing the empty state.
  if (primed) ws.send(JSON.stringify({ torrents: latest }))
}

export function removeLiveClient(ws: WSContext) {
  clients.delete(key(ws))
  if (clients.size === 0 && poller) {
    clearInterval(poller)
    poller = null
  }
}
