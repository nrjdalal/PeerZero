#!/usr/bin/env bash
# Build a self-contained PeerZero.app for macOS with the native mpv player, in ONE command and with
# NO manual Homebrew / PKG_CONFIG_PATH steps. It: ensures libmpv is installed, builds the backend
# bundle + static UI + Bun sidecar, compiles the Tauri app, vendors libmpv's dylib closure into the
# .app, and verifies no Homebrew paths remain (so the app runs on a Mac without Homebrew).
#
# Usage:  desktop/scripts/build-app.sh
# Output: desktop/src-tauri/target/<triple>/release/bundle/macos/PeerZero.app
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
export PATH="$HOME/.cargo/bin:$PATH" # tauri needs cargo on PATH

TARGET="${RUST_TARGET:-aarch64-apple-darwin}"
API_URL="${NEXT_PUBLIC_API_URL:-http://127.0.0.1:9336}"

echo "==> 1/4 fetch pinned libmpv closure (or produce from Homebrew)"
bash desktop/scripts/fetch-libmpv.sh

echo "==> 2/4 backend (Hono bundle + in-process engine)"
bunx turbo run build --filter=@api/hono

echo "==> 3/4 static UI (API baked to $API_URL)"
(
  cd web/next && rm -rf out &&
    NODE_ENV=production NEXT_OUTPUT=export \
      NEXT_PUBLIC_API_URL="$API_URL" NEXT_PUBLIC_APP_URL="$API_URL" \
      bunx next build
)

echo "==> 4/4 Bun sidecar + Tauri app (libmpv closure bundled via macOS.frameworks)"
mkdir -p desktop/src-tauri/binaries
bun desktop/backend/build.ts "desktop/src-tauri/binaries/peerzero-backend-$TARGET"
# Tauri copies the prebuilt @rpath closure (fetch-libmpv wrote libmpv.frameworks.json) into
# Contents/Frameworks and sets the Frameworks rpath during bundling, so the .app comes out
# self-contained with no post-processing. `--bundles app` + no updater artifacts for a local build.
(cd desktop && bunx @tauri-apps/cli@^2 build --target "$TARGET" --bundles app \
  --config src-tauri/libmpv.frameworks.json \
  --config '{"bundle":{"createUpdaterArtifacts":false}}')

APP="desktop/src-tauri/target/$TARGET/release/bundle/macos/PeerZero.app"
echo
echo "== verify: no Homebrew paths in the app binary or bundled dylibs =="
if otool -L "$APP/Contents/MacOS/app" "$APP/Contents/Frameworks/"*.dylib 2>/dev/null |
  grep -E "/opt/homebrew|/usr/local/(opt|Cellar)"; then
  echo "!! Homebrew paths remain - bundling incomplete" >&2
  exit 1
fi
echo "OK: self-contained -> $APP"
