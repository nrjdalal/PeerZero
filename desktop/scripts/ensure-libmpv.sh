#!/usr/bin/env bash
# Ensure libmpv is available for BUILDING the desktop app (the native mpv player links it on macOS).
# This makes the Homebrew dependency explicit and automatic instead of a manual `brew install mpv` +
# PKG_CONFIG_PATH dance. End users never need this: desktop/scripts/bundle-libmpv.py vendors the
# dylib closure into the .app, so the shipped app is self-contained.
#
# Idempotent - a no-op when libmpv is already discoverable. Run it before `cargo build` / `tauri
# build`; build-app.sh and CI both call it.
set -euo pipefail

if [ "$(uname -s)" != "Darwin" ]; then
  # The render layer (mpv_render.rs) is macOS-only, so there is nothing to link elsewhere yet.
  echo "ensure-libmpv: non-macOS host, skipping (no native mpv render path yet)"
  exit 0
fi

prefix="$(brew --prefix 2>/dev/null || echo /opt/homebrew)"

# Already present? Either pkg-config sees mpv.pc, or the dylib is on disk.
if PKG_CONFIG_PATH="$prefix/lib/pkgconfig:${PKG_CONFIG_PATH:-}" pkg-config --exists mpv 2>/dev/null \
  || [ -f "$prefix/lib/libmpv.dylib" ]; then
  version="$(PKG_CONFIG_PATH="$prefix/lib/pkgconfig:${PKG_CONFIG_PATH:-}" pkg-config --modversion mpv 2>/dev/null || echo installed)"
  echo "ensure-libmpv: libmpv already present ($version)"
  exit 0
fi

if ! command -v brew >/dev/null 2>&1; then
  echo "ensure-libmpv: Homebrew not found. Install it (https://brew.sh) and re-run, or provide libmpv another way." >&2
  exit 1
fi

echo "ensure-libmpv: installing mpv (provides libmpv) via Homebrew..."
brew install mpv
echo "ensure-libmpv: done."
