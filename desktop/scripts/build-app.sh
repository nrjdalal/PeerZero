#!/usr/bin/env bash
# Build a self-contained PeerZero.app for macOS with the native mpv player, in ONE command and with
# NO manual Homebrew / PKG_CONFIG_PATH steps. It: ensures libmpv is installed, builds the backend
# bundle + static UI + Bun sidecar, compiles the Tauri app, vendors libmpv's dylib closure into the
# .app, and verifies no Homebrew paths remain (so the app runs on a Mac without Homebrew).
#
# Usage:  desktop/scripts/build-app.sh   (APP_NAME=... to override the app name)
# Output: desktop/src-tauri/target/<triple>/release/bundle/macos/<APP_NAME>.app
#         <APP_NAME> is the worktree name when building from one (so it can't be confused with the
#         installed PeerZero.app), else "PeerZero".
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
export PATH="$HOME/.cargo/bin:$PATH" # tauri needs cargo on PATH

TARGET="${RUST_TARGET:-aarch64-apple-darwin}"
API_URL="${NEXT_PUBLIC_API_URL:-http://127.0.0.1:9336}"

# --canary builds the AMBER canary variant: a distinct bundle id + icon, but the display name stays
# "PeerZero" (Info.canary.plist), so it installs BESIDE a stable PeerZero.app and is told apart by
# color, not name. env.style's ENV_STYLES_ENV drives the logo/favicon tint - preview (amber) for
# canary, development (blue) for any other local build - so a local build is never mistaken for a
# stable release. (A single flag string, not a bash array, so this stays macOS bash 3.2 safe.)
CANARY=0
for arg in "$@"; do [ "$arg" = "--canary" ] && CANARY=1; done
CANARY_CONFIG=""

if [ "$CANARY" = "1" ]; then
  APP_NAME="PeerZeroCanary"
  IDENTIFIER="com.peerzero.desktop.canary"
  ENV_STYLE="${ENV_STYLES_ENV:-preview}"
  CANARY_CONFIG="--config src-tauri/canary.conf.json"
else
  ENV_STYLE="${ENV_STYLES_ENV:-development}"
  # Name the built .app + bundle id after the worktree (when building from one), so a test build never
  # collides with the installed PeerZero in /Applications - distinct name in the Dock/Finder and a
  # distinct macOS app identity (updater, Launch Services), so the user can tell them apart and the
  # installed app is never mistaken for (or updated by) the build. From the main checkout it stays
  # "PeerZero". The main binary inside the bundle stays "app" (the Cargo crate name), so run paths like
  # Contents/MacOS/app are unchanged. Override APP_NAME to force a name.
  case "$ROOT" in
    */.claude/worktrees/*) APP_NAME="${APP_NAME:-$(basename "$ROOT")}" ;;
    *) APP_NAME="${APP_NAME:-PeerZero}" ;;
  esac
  if [ "$APP_NAME" = "PeerZero" ]; then
    IDENTIFIER="com.peerzero.desktop"
  else
    # bundle ids allow only alnum, hyphen, dot - sanitize the worktree name for the suffix
    IDENTIFIER="com.peerzero.desktop.$(printf '%s' "$APP_NAME" | tr -c 'A-Za-z0-9' '-')"
  fi
fi
echo "==> building app \"$APP_NAME\" ($IDENTIFIER), channel=$ENV_STYLE"

echo "==> 1/4 fetch pinned libmpv closure (or produce from Homebrew)"
bash desktop/scripts/fetch-libmpv.sh

echo "==> 2/4 backend (Hono bundle + in-process engine)"
bunx turbo run build --filter=@api/hono

echo "==> 3/4 static UI (API baked to $API_URL)"
(
  cd web/next && rm -rf out &&
    NODE_ENV=production NEXT_OUTPUT=export ENV_STYLES_ENV="$ENV_STYLE" \
      NEXT_PUBLIC_API_URL="$API_URL" NEXT_PUBLIC_APP_URL="$API_URL" \
      bunx next build
)

echo "==> 4/4 Bun sidecar + Tauri app (libmpv closure bundled via macOS.frameworks)"
mkdir -p desktop/src-tauri/binaries
bun desktop/backend/build.ts "desktop/src-tauri/binaries/peerzero-backend-$TARGET"
# Tauri copies the prebuilt @rpath closure (fetch-libmpv wrote libmpv.frameworks.json) into
# Contents/Frameworks and sets the Frameworks rpath during bundling, so the .app comes out
# self-contained with no post-processing. `--bundles app` + no updater artifacts for a local build.
# $CANARY_CONFIG is intentionally unquoted so it word-splits into two args (--config <path>) when set,
# or nothing when empty; the path has no spaces. It applies the canary icon + Info.canary.plist; the
# inline --config below then pins productName/identifier and disables updater artifacts for a local build.
(cd desktop && bunx @tauri-apps/cli@^2 build --target "$TARGET" --bundles app \
  --config src-tauri/libmpv.frameworks.json \
  $CANARY_CONFIG \
  --config "{\"productName\":\"$APP_NAME\",\"identifier\":\"$IDENTIFIER\",\"bundle\":{\"createUpdaterArtifacts\":false}}")

APP="desktop/src-tauri/target/$TARGET/release/bundle/macos/$APP_NAME.app"
echo
echo "== verify: no Homebrew paths in the app binary or bundled dylibs =="
if otool -L "$APP/Contents/MacOS/app" "$APP/Contents/Frameworks/"*.dylib 2>/dev/null |
  grep -E "/opt/homebrew|/usr/local/(opt|Cellar)"; then
  echo "!! Homebrew paths remain - bundling incomplete" >&2
  exit 1
fi
echo "OK: self-contained -> $APP"
