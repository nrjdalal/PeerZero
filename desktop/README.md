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
NODE_ENV=production bunx turbo run build --filter=@api/hono
NEXT_PUBLIC_API_URL=http://127.0.0.1:47821 NEXT_PUBLIC_APP_URL=http://127.0.0.1:47821 \
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

`.github/workflows/desktop-release.yml` builds macOS (arm64 + Intel), Windows, and Linux in
parallel and uploads the installers to a **draft** GitHub release. Trigger it by pushing a
tag `desktop-v<version>` (matching `version` in `src-tauri/tauri.conf.json`) or by running
the workflow manually. Review the draft release, then publish it.

## Required GitHub secrets

| Secret                                          | Needed for        | Notes                                                                                                        |
| ----------------------------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------ |
| `TAURI_SIGNING_PRIVATE_KEY`                     | updater artifacts | Contents of `desktop/.keys/peerzero-updater.key`. The matching public key is committed in `tauri.conf.json`. |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`            | updater artifacts | Empty string (the key was generated without a password).                                                     |
| `APPLE_CERTIFICATE`                             | signed macOS      | base64 of the Developer ID Application `.p12`.                                                               |
| `APPLE_CERTIFICATE_PASSWORD`                    | signed macOS      | password for the `.p12`.                                                                                     |
| `APPLE_SIGNING_IDENTITY`                        | signed macOS      | e.g. `Developer ID Application: Your Name (TEAMID)`.                                                         |
| `APPLE_ID` / `APPLE_PASSWORD` / `APPLE_TEAM_ID` | notarization      | Apple ID + an app-specific password + team id.                                                               |

Without the Apple secrets the macOS build is **unsigned** (ad-hoc): first launch needs
right-click -> Open. Windows is currently unsigned too (SmartScreen warning) — Authenticode
signing is a follow-up. Linux (`.AppImage`/`.deb`) needs no signing.

## Auto-updater

The app ships the [Tauri updater](https://v2.tauri.app/plugin/updater/); it checks
`https://github.com/nrjdalal/PeerZero/releases/latest/download/latest.json` (generated and
signed by the release workflow). Rotating the key means regenerating it
(`bunx @tauri-apps/cli signer generate`), updating `pubkey` in `tauri.conf.json`, and
replacing the `TAURI_SIGNING_PRIVATE_KEY` secret.
