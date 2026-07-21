---
name: desktop
description: Build and run the packaged PeerZero desktop app - Tauri v2 shell + the single Bun backend (Hono API with the in-process WebTorrent engine). Use when asked to build, run, or test the desktop app, produce installers, or debug the compiled sidecar. For the hot-reload web+API dev stack, use the `dev` skill instead.
---

# Desktop App

Tauri v2 (system webview) wrapping ONE self-contained Bun backend
(`desktop/backend/main.ts`) that serves the Hono API with the **in-process WebTorrent engine**,
and (standalone) the static UI. One process, one port - there is no separate engine sidecar.

## Pieces

- `desktop/backend/main.ts` - the sidecar: serves `/api/*` (the pre-built Hono bundle, which embeds the engine) + the static UI. Binds an **ephemeral free port** by default and prints `PZ_API_PORT=<port>`; `PZ_PORT` pins it (Docker/tests).
- `desktop/backend/build.ts` - compiles `main.ts` into one Bun executable (the Tauri `externalBin`). Optional 2nd arg is a cross-compile target (`bun-windows-x64`, `bun-linux-x64`, `bun-darwin-arm64`, ...).
- `desktop/src-tauri/` - the Tauri shell. `tauri.conf.json`: `frontendDist: ../../web/next/out`, `externalBin: binaries/peerzero-backend`. `src-tauri/src/lib.rs` waits for the sidecar's `PZ_API_PORT` line, then creates the window with `window.__PEERZERO_API_URL__` injected (before any app JS).
- The frontend is a **static export** (`NEXT_OUTPUT=export`). It prefers the injected `window.__PEERZERO_API_URL__` over the **baked** `NEXT_PUBLIC_API_URL`, so under Tauri it finds the API on a random port. The baked URL is only a fallback - it matters for the sidecar-standalone path (no injection there), where it must match `PZ_PORT`.

## Build + run (isolated, for testing)

Use an isolated `PZ_PORT` + a temp `HOME` so it never collides with an installed `PeerZero.app`
or another worktree, and never touches your real `~/.peerzero` state or downloads. `cargo` must be
on PATH.

For a **self-contained** `.app` (native mpv bundled in, no Homebrew needed to run it), skip the manual
steps and run `desktop/scripts/build-app.sh`. The native mpv player links a **prebuilt, pinned libmpv
closure**, not live Homebrew (see `.github/notes/libmpv.md`): `desktop/scripts/fetch-libmpv.sh`
downloads the pinned, sha256-verified closure into `src-tauri/vendor/libmpv` (or produces it from
Homebrew when no artifact is published) and emits `libmpv.frameworks.json`; `build.rs` links against
it and Tauri bundles it via `macOS.frameworks`. For a quick manual/isolated run (steps below), run
`fetch-libmpv.sh` first so `build.rs` finds the closure, then pass
`--config src-tauri/libmpv.frameworks.json` to `tauri build`.

```bash
PORT=9400                                    # a fixed, known port for scripted testing (the app's default is ephemeral)
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

- **Bun breaks `Readable.toWeb()`.** The engine streams a file by handing the Node `Readable` **straight** to `Response` - never `Readable.toWeb()`, which throws `QueuingStrategyInit.highWaterMark member is required` under Bun ([oven-sh/bun#2935](https://github.com/oven-sh/bun/issues/2935)) and 500s **every** `/stream` request. `/api/health` stays green while every video fails, so verify the stream itself, not just health.
- **Verify streaming, not health.** A `Range` GET must return `206` with real bytes: `curl -o /dev/null -w '%{http_code}' -H 'Range: bytes=0-7' "$API/api/torrents/<hash>/stream/0"`; an MKV starts `1a45 dfa3`. The fastest full check (backend + player) is the sidecar-standalone + `agent-browser` path above: click Play and screenshot the decoded frame.
- **Ports are ephemeral now.** The packaged app binds a random free port and injects it into the webview (`window.__PEERZERO_API_URL__`), so an installed app / other worktrees coexist without `EADDRINUSE` or a stale backend answering. For a scriptable test, pin a KNOWN port with `PZ_PORT`, and (sidecar-standalone) bake `NEXT_PUBLIC_API_URL` to match.
- **Orphaned sidecar.** Force-quitting the app leaves the child sidecar running, **reparented to launchd** (a `ppid` check shows `launchd`, not the app). Kill both by name: `pkill -f "target/release/app"; pkill -f peerzero-backend` (scope the pattern so an installed app is untouched).
- **Turbo cache.** A cached `turbo run build` replays a stale bundle after an engine/hono edit - re-run with `--force` if the change isn't taking.
- **Can't script clicks (Tauri).** No Accessibility for the dev binary; `screencapture -x out.png` + curl the API. To verify PLAYBACK, use the sidecar-standalone + `agent-browser` path (real Chrome decodes what the WKWebView would show).
- **macOS quarantine.** A downloaded (not locally built) `.app` needs `xattr -dr com.apple.quarantine /Applications/PeerZero.app` on first launch.

For the hot-reload dev stack (web + API on portless `.localhost` URLs), use the `dev` skill.
