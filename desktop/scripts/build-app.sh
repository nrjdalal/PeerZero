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

echo "==> 1/5 ensure libmpv (Homebrew)"
bash desktop/scripts/ensure-libmpv.sh

echo "==> 2/5 backend (Hono bundle + in-process engine)"
bunx turbo run build --filter=@api/hono

echo "==> 3/5 static UI (API baked to $API_URL)"
(
  cd web/next && rm -rf out &&
    NODE_ENV=production NEXT_OUTPUT=export \
      NEXT_PUBLIC_API_URL="$API_URL" NEXT_PUBLIC_APP_URL="$API_URL" \
      bunx next build
)

echo "==> 4/5 Bun sidecar + Tauri app"
mkdir -p desktop/src-tauri/binaries
bun desktop/backend/build.ts "desktop/src-tauri/binaries/peerzero-backend-$TARGET"
# Just the .app (no installer). Disable updater artifacts: the config turns them on for releases, but
# they require the signing key - a local self-contained .app for testing does not need them.
(cd desktop && bunx @tauri-apps/cli@^2 build --target "$TARGET" --bundles app \
  --config '{"bundle":{"createUpdaterArtifacts":false}}')

APP="desktop/src-tauri/target/$TARGET/release/bundle/macos/PeerZero.app"
echo "==> 5/5 vendor libmpv into $APP"
python3 desktop/scripts/bundle-libmpv.py "$APP"

echo
echo "== verify: no Homebrew paths left in the app binary or vendored dylibs =="
if otool -L "$APP/Contents/MacOS/app" "$APP/Contents/Frameworks/"*.dylib 2>/dev/null |
  grep -E "/opt/homebrew|/usr/local/(opt|Cellar)"; then
  echo "!! Homebrew paths remain - bundling incomplete" >&2
  exit 1
fi
echo "OK: self-contained -> $APP"
