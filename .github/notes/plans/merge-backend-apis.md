# Merge the two backend APIs into one

**Status:** on ice (undecided). An idea, not scheduled.

Fold the `api/torrent-engine` WebTorrent engine into `api/hono` as an in-process module,
collapsing the backend to `api-hono` + `web-next` (two packages instead of three).

## Why it's now possible

The engine was originally a separate sidecar because WebTorrent needed Node while the rest
ran on Bun. That reason is gone: the engine runs under Bun now (the WebRTC/uTP native addons
are stubbed out via `api/torrent-engine/src/webrtc-stub.mjs`). And the shipped desktop build
(`desktop/backend/main.ts`) already runs Hono + the engine in one Bun process, so merging
only aligns dev with what production already does.

## What would change

- Replace the HTTP seam (`api/hono/src/lib/torrent/engine.ts` -> `http://127.0.0.1:6339`)
  with direct in-process calls; keep the WebTorrent logic as its own module
  (`lib/torrent/engine`) for a clean boundary.
- Drop the engine port and the separate dev process (its portless entry).
- Move the WebRTC-stub preload onto `api-hono` (bunfig / the desktop build plugin).
- Update `desktop/backend/main.ts` (one import, no dual serve) and the e2e test that spawns
  the engine subprocess.

## Open question / tradeoff

Losing process-level crash isolation: a bad torrent could take the whole backend down, not
just the engine. This is already true in the shipped desktop build; the
`uncaughtException`/`unhandledRejection` guards catch the common cases and the crash-prone
native addons are stubbed off, so the risk is low. The undecided part is whether that
isolation is worth keeping the split for.
