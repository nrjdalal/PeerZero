---
name: desktop
description: Build and run the packaged PeerZero desktop app - Tauri v2 shell + the single Bun backend (Hono API with the in-process WebTorrent engine). Use when asked to build, run, or test the desktop app, produce installers, or debug the compiled sidecar. For the hot-reload web+API dev stack, use the `dev` skill instead.
---

# Desktop App

Tauri v2 (system webview) wrapping ONE self-contained Bun backend
(`desktop/backend/main.ts`) that serves the Hono API with the **in-process WebTorrent engine**,
and (standalone) the static UI. One process, one port - there is no separate engine sidecar.

## Pieces

- `desktop/backend/main.ts` - the sidecar: serves `/api/*` (the pre-built Hono bundle, which embeds the engine) + the static UI; binds `PZ_PORT` (default 9336).
- `desktop/backend/build.ts` - compiles `main.ts` into one Bun executable (the Tauri `externalBin`). Optional 2nd arg is a cross-compile target (`bun-windows-x64`, `bun-linux-x64`, `bun-darwin-arm64`, ...).
- `desktop/src-tauri/` - the Tauri shell. `tauri.conf.json`: `frontendDist: ../../web/next/out`, `externalBin: binaries/peerzero-backend`.
- The frontend is a **static export** (`NEXT_OUTPUT=export`) with `NEXT_PUBLIC_API_URL` **baked at build time**, so it must match the port the sidecar binds.

## Build + run (isolated, for testing)

Use an isolated `PZ_PORT` + a temp `HOME` so it never collides with an installed `PeerZero.app`
or another worktree, and never touches your real `~/.peerzero` state or downloads. `cargo` must be
on PATH.

```bash
PORT=9400                                    # isolated; NOT the default 9336
export PATH="$HOME/.cargo/bin:$PATH"          # tauri needs cargo

# 1. Hono bundle (embeds the engine + the baked-in WebRTC stub)
bunx turbo run build --filter=@api/hono       # add --force if you changed engine/hono code (cache)

# 2. Static UI, with the API URL baked to the chosen port
( cd web/next && rm -rf out && \
  NEXT_OUTPUT=export NEXT_PUBLIC_API_URL=http://127.0.0.1:$PORT NEXT_PUBLIC_APP_URL=http://127.0.0.1:$PORT \
  bunx next build )

# 3. Compile the sidecar into the Tauri binaries dir (arm64 mac; change the triple for other targets)
bun desktop/backend/build.ts desktop/src-tauri/binaries/peerzero-backend-aarch64-apple-darwin

# 4. Build the app - no installer, just the runnable binary at target/release/app
( cd desktop && bunx @tauri-apps/cli@^2 build --no-bundle )

# 5. Run it isolated
H=$(mktemp -d /tmp/pz-desk-XXXX)
HOME="$H" PZ_PORT=$PORT nohup ./desktop/src-tauri/target/release/app > /tmp/pz-desk.log 2>&1 &
for i in $(seq 1 50); do curl -sf http://127.0.0.1:$PORT/api/health >/dev/null 2>&1 && break; sleep 0.3; done
curl -sS http://127.0.0.1:$PORT/api/health          # {"data":{"message":"ok",...}}
```

The Tauri window opens behind other apps when launched from a terminal; bring it forward with
`osascript -e 'tell application "System Events" to set frontmost of (first process whose name is "app") to true'`.

## Run just the sidecar (no Tauri shell)

The compiled sidecar serves the UI too when `PZ_FRONTEND_DIR` points at the static export - handy
for driving the real backend + UI in a scriptable browser (`agent-browser`), since Tauri's WKWebView
can't be click-scripted. Same-origin, so no CORS to fight:

```bash
HOME=$H PZ_PORT=$PORT PZ_FRONTEND_DIR="$PWD/web/next/out" \
  ./desktop/src-tauri/binaries/peerzero-backend-aarch64-apple-darwin
# then: agent-browser open http://127.0.0.1:$PORT   (drive Settings, add a torrent, screenshot)
```

## Gotchas

- **Fixed ports collide.** An installed `PeerZero.app` and other worktrees squat 9336. Always test on an isolated `PZ_PORT` with a matching baked `NEXT_PUBLIC_API_URL`, or you get `EADDRINUSE`, or a stale backend answers with the wrong version + CORS and the UI shows "Network request failed".
- **Orphaned sidecar.** `pkill` on the app can leave the child sidecar running (SIGTERM doesn't fire the Tauri cleanup). Kill both: `pkill -f "target/release/app"; pkill -f peerzero-backend`.
- **Turbo cache.** A cached `turbo run build` replays a stale bundle after an engine/hono edit - re-run with `--force` if the change isn't taking.
- **Can't script clicks.** No Accessibility for the dev binary; verify with `screencapture -x out.png` (whole screen) + the API over curl, or drive the UI via the sidecar-standalone + `agent-browser` path above.
- **macOS quarantine.** A downloaded (not locally built) `.app` needs `xattr -dr com.apple.quarantine /Applications/PeerZero.app` on first launch.

For the hot-reload dev stack (web + API on portless `.localhost` URLs), use the `dev` skill.
