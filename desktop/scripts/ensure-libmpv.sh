#!/usr/bin/env bash
# Ensure libmpv is available from Homebrew, so prebuild-libmpv.sh can PRODUCE the pinned closure (and
# so fetch-libmpv.sh's local-produce bootstrap works before an artifact is published). This is the
# only place Homebrew is needed, and only to produce libmpv once - the shipped app bundles a prebuilt
# closure (see .github/notes/libmpv.md), so end users need nothing.
#
# Idempotent - a no-op when libmpv is already present. Called by prebuild-libmpv.sh and, as a
# bootstrap, by fetch-libmpv.sh.
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
