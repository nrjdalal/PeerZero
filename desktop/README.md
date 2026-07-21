# PeerZero desktop

Packages PeerZero as a self-contained desktop app. A [Tauri v2](https://tauri.app) shell
loads the static UI in the OS webview and runs the whole backend as **one Bun sidecar
binary** (Hono API + WebTorrent engine, in-process). No Node, no database, nothing to
install.

The sidecar binds an **ephemeral loopback port** (OS-assigned, so multiple instances never
collide) and prints `PZ_API_PORT=<port>`. The Rust shell reads that line, then creates the
window with `window.__PEERZERO_API_URL__` injected before any app JS runs, so the static UI
learns the port at runtime instead of having it baked in.

```
desktop/
  backend/            one Bun binary = Hono API + engine + optional static UI
    main.ts           entry: picks a free port, sets env, serves the API (+ optional UI)
    serve-static.ts   serves the Next static export
    build.ts          bun build --compile  (optional cross-compile target arg)
  src-tauri/          the Tauri app (Rust shell, config, icons, capabilities)
    binaries/         compiled sidecar, named peerzero-backend-<target-triple> (gitignored)
  .keys/              updater signing private key (gitignored — add it as a secret)
```

## Build locally (macOS example)

From the repo root:

```bash
# 1. backend bundle + static UI + native sidecar
# NEXT_OUTPUT=export makes the web build a static SPA; without it the web app stays standalone.
# NEXT_PUBLIC_API_URL here is only a fallback: at runtime the shell injects the real (ephemeral)
# port via window.__PEERZERO_API_URL__, which the UI prefers.
NODE_ENV=production bunx turbo run build --filter=@api/hono
NEXT_OUTPUT=export NEXT_PUBLIC_API_URL=http://127.0.0.1:9336 NEXT_PUBLIC_APP_URL=http://127.0.0.1:9336 \
  bunx turbo run build --filter=@web/next
bun desktop/backend/build.ts desktop/src-tauri/binaries/peerzero-backend-$(rustc -Vv | sed -n 's/host: //p')

# 2. the app (.app + .dmg). PKG_CONFIG_PATH lets the build find libmpv (see "Native video" below).
#    The updater key is required because the config signs updater artifacts (createUpdaterArtifacts).
cd desktop
PKG_CONFIG_PATH=/opt/homebrew/lib/pkgconfig \
TAURI_SIGNING_PRIVATE_KEY="$(cat .keys/peerzero-updater.key)" \
TAURI_SIGNING_PRIVATE_KEY_PASSWORD="" \
  bunx @tauri-apps/cli build

# 3. make the .app self-contained (vendor libmpv + its dylib closure, repoint to @rpath) so no
#    `brew install mpv` is needed at runtime. Run BEFORE packaging the .dmg/updater from the .app.
python3 desktop/scripts/bundle-libmpv.py \
  desktop/src-tauri/target/release/bundle/macos/PeerZero.app
```

Output: `desktop/src-tauri/target/release/bundle/`. The Bun sidecar cross-compiles for any
OS (no native addons), e.g. `bun desktop/backend/build.ts out bun-windows-x64`.

## Native video (mpv)

On desktop, video plays through **native [mpv](https://mpv.io)** (via `libmpv`) for real
VLC/IINA-class playback: hardware decode of every codec and every embedded subtitle format.
mpv runs headless (`vo=libmpv`) and is rendered through the libmpv **OpenGL render API** into a
`CAOpenGLLayer` inserted **behind the transparent webview** (`src-tauri/src/mpv_render.rs`,
macOS); the HTML control overlay (`web/.../mpv-player.tsx`) composites on top. The Rust side
(`src-tauri/src/mpv.rs`) exposes `mpv_*` commands + re-emits mpv properties as `mpv://property`
events. In a plain browser the app falls back to the in-browser libmedia player.

**Build prereq:** system `libmpv` (`brew install mpv` on macOS; `libmpv-dev` on Linux). `build.rs`
resolves its link path via `pkg-config`, so set `PKG_CONFIG_PATH` if mpv is not on the default path.
**Runtime:** the shipped app is self-contained - `scripts/bundle-libmpv.py` vendors libmpv + its full
dependency closure (~48 dylibs) into `Contents/Frameworks/` and repoints everything to `@rpath`, so end
users install nothing.

## Release via CI

Desktop installers are built **automatically as part of a release**. When the auto-created
`canary -> main` PR is merged, `auto-release.yml` bumps the version, tags `v<x.y.z>`, and
creates the GitHub release, then it calls `desktop-release.yml` (a reusable workflow) which
builds macOS (arm64), Windows, and Linux in parallel and attaches the installers to
that release. It runs as a called job in the same run rather than on a separate `on: release`
event, because a release created with `GITHUB_TOKEN` cannot trigger another workflow.

The desktop app version is synced to the release tag at build time, so no separate version
bump is needed here. To (re)build installers for an existing tag by hand: **Actions ->
Desktop Release -> Run workflow**, and enter the tag (e.g. `v0.0.2`).

## GitHub secrets

| Secret                               | Needed for        | Notes                                                                                                        |
| ------------------------------------ | ----------------- | ------------------------------------------------------------------------------------------------------------ |
| `TAURI_SIGNING_PRIVATE_KEY`          | updater artifacts | Contents of `desktop/.keys/peerzero-updater.key`. The matching public key is committed in `tauri.conf.json`. |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | updater artifacts | Empty (the key was generated without a password).                                                            |

Only the updater key is wired, so builds are currently **unsigned**: macOS is ad-hoc (first
launch needs right-click -> Open), Windows triggers SmartScreen, Linux needs no signing. To
enable signed + notarized macOS later, add the Apple Developer ID secrets (`APPLE_CERTIFICATE`,
`APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`, `APPLE_ID`, `APPLE_PASSWORD`,
`APPLE_TEAM_ID`) and pass them through in `desktop-release.yml`.

## Auto-updater

The app ships the [Tauri updater](https://v2.tauri.app/plugin/updater/); it checks
`https://github.com/nrjdalal/PeerZero/releases/latest/download/latest.json` (generated and
signed by the release workflow). Rotating the key means regenerating it
(`bunx @tauri-apps/cli signer generate`), updating `pubkey` in `tauri.conf.json`, and
replacing the `TAURI_SIGNING_PRIVATE_KEY` secret.
