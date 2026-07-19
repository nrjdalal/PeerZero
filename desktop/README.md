# PeerZero desktop

Packages PeerZero as a self-contained desktop app. A [Tauri v2](https://tauri.app) shell
loads the static UI in the OS webview and runs the whole backend as **one Bun sidecar
binary** (Hono API + WebTorrent engine, in-process). No Node, no database, nothing to
install.

```
desktop/
  backend/            one Bun binary = Hono API + engine + optional static UI
    main.ts           entry: sets local ports/env, starts engine, serves the app
    serve-static.ts   serves the Next static export
    build.ts          bun build --compile  (optional cross-compile target arg)
  src-tauri/          the Tauri app (Rust shell, config, icons, capabilities)
    binaries/         compiled sidecar, named peerzero-backend-<target-triple> (gitignored)
  .keys/              updater signing private key (gitignored — add it as a secret)
```

## Build locally (macOS example)

From the repo root:

```bash
# 1. backend bundle + static UI (bake the local API url) + native sidecar
# NEXT_OUTPUT=export makes the web build a static SPA; without it the web app stays standalone.
NODE_ENV=production bunx turbo run build --filter=@api/hono
NEXT_OUTPUT=export NEXT_PUBLIC_API_URL=http://127.0.0.1:9336 NEXT_PUBLIC_APP_URL=http://127.0.0.1:9336 \
  bunx turbo run build --filter=@web/next
bun desktop/backend/build.ts desktop/src-tauri/binaries/peerzero-backend-$(rustc -Vv | sed -n 's/host: //p')

# 2. the app (.app + .dmg). The updater key is required because the config signs
#    updater artifacts (createUpdaterArtifacts).
cd desktop
TAURI_SIGNING_PRIVATE_KEY="$(cat .keys/peerzero-updater.key)" \
TAURI_SIGNING_PRIVATE_KEY_PASSWORD="" \
  bunx @tauri-apps/cli build
```

Output: `desktop/src-tauri/target/release/bundle/`. The Bun sidecar cross-compiles for any
OS (no native addons), e.g. `bun desktop/backend/build.ts out bun-windows-x64`.

## Release via CI

Desktop installers are built **automatically as part of a release**. When the auto-created
`canary -> main` PR is merged, `auto-release.yml` bumps the version, tags `v<x.y.z>`, and
creates the GitHub release, then it calls `desktop-release.yml` (a reusable workflow) which
builds macOS (arm64 + Intel), Windows, and Linux in parallel and attaches the installers to
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
