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

## Build locally (macOS)

One turnkey command builds a **self-contained** `PeerZero.app` with the native mpv player bundled
in - no Homebrew, no `PKG_CONFIG_PATH`, nothing to run it needs from the host:

```bash
desktop/scripts/build-app.sh
```

It fetches the pinned libmpv closure (`fetch-libmpv.sh`), builds the backend bundle + static UI + Bun
sidecar, and compiles the Tauri app - which bundles the closure via `macOS.frameworks` - then verifies
no Homebrew paths remain. Output: `desktop/src-tauri/target/<triple>/release/bundle/macos/PeerZero.app`.
The Bun sidecar cross-compiles for any OS (no native addons), e.g.
`bun desktop/backend/build.ts out bun-windows-x64`.

The signed **`.dmg` + updater** are produced by CI (`.github/workflows/desktop-release.yml`), which
runs `fetch-libmpv.sh` on the runner and passes the frameworks config to the Tauri build - so the
installers come out self-contained straight from `tauri build` (no post-processing, no updater
re-signing): the closure is copied into the `.app` **during** bundling, before the updater tarball is
generated and signed.

## Native video (mpv)

On desktop, video plays through **native [mpv](https://mpv.io)** (via `libmpv`) for real
VLC/IINA-class playback: hardware decode of every codec and every embedded subtitle format.
mpv runs headless (`vo=libmpv`) and is rendered through the libmpv **OpenGL render API** into a
`CAOpenGLLayer` inserted **behind the transparent webview** (`src-tauri/src/mpv_render.rs`,
macOS); the HTML control overlay (`web/.../mpv-player.tsx`) composites on top. The Rust side
(`src-tauri/src/mpv.rs`) exposes `mpv_*` commands + re-emits mpv properties as `mpv://property`
events. In a plain browser the app falls back to the in-browser libmedia player.

**libmpv is prebuilt, pinned, and bundled - not linked from live Homebrew** (see
[`.github/notes/libmpv.md`](../.github/notes/libmpv.md) for the why, backed by research):

- `prebuild-libmpv.sh` (maintainer, run once per libmpv version) produces a self-contained,
  `@rpath`-relocated dylib closure (~48 dylibs) from Homebrew and pins it in `desktop/libmpv.lock.json`
  (mpv version + sha256). Publish the tarball to a GitHub Release and set `url` in the lock.
- `fetch-libmpv.sh` (build + CI) downloads the pinned, sha256-verified closure into
  `src-tauri/vendor/libmpv` (no Homebrew), or produces it locally from Homebrew when no `url` is set
  yet. It also emits `libmpv.frameworks.json`.
- `build.rs` links against the vendored closure (the app binary records `@rpath/libmpv.2.dylib` at
  link time); Tauri's `macOS.frameworks` copies the closure into `Contents/Frameworks` during
  bundling. **Runtime:** the shipped app is self-contained; end users install nothing.

(Linux would use `libmpv-dev`, once that render path exists.)

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
