#!/usr/bin/env bash
# MAINTAINER TOOL: prebuild libmpv ONCE into a pinned, publishable artifact. Homebrew is used here
# (only) as the source to produce the closure; the output is a standalone @rpath dylib closure plus a
# checksummed tarball you publish to a GitHub Release and pin in libmpv.lock.json, so the app build
# (fetch-libmpv.sh) and CI consume it with NO live Homebrew.
#
# Usage: desktop/scripts/prebuild-libmpv.sh
# Writes: desktop/src-tauri/vendor/libmpv/{lib,VERSION}, desktop/src-tauri/vendor/libmpv.tar.gz,
#         and updates desktop/libmpv.lock.json (mpvVersion + arch + sha256, preserving any url).
#
# Then, to make CI reproducible:
#   gh release create deps-libmpv-<ver> desktop/src-tauri/vendor/libmpv.tar.gz --title "libmpv <ver>"
#   # set "url" in desktop/libmpv.lock.json to that asset's download URL, commit the lock.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

[ "$(uname -s)" = "Darwin" ] || {
  echo "prebuild-libmpv: macOS only" >&2
  exit 1
}

bash desktop/scripts/ensure-libmpv.sh # produce-time Homebrew dependency (only here)
SYS="$(brew --prefix mpv)/lib/libmpv.2.dylib"

VENDOR="desktop/src-tauri/vendor/libmpv"
rm -rf "$VENDOR"
python3 desktop/scripts/vendor-libmpv-closure.py "$SYS" "$VENDOR"

TARBALL="desktop/src-tauri/vendor/libmpv.tar.gz"
(cd "$(dirname "$VENDOR")" && tar -czf "$ROOT/$TARBALL" libmpv)
SHA="$(shasum -a 256 "$TARBALL" | awk '{print $1}')"
VERSION="$(cat "$VENDOR/VERSION")"
ARCH="$(uname -m)"
URL="$(python3 -c "import json,os;print(json.load(open('desktop/libmpv.lock.json')).get('url','')) if os.path.exists('desktop/libmpv.lock.json') else print('')" 2>/dev/null || echo "")"

cat > desktop/libmpv.lock.json <<EOF
{
  "mpvVersion": "$VERSION",
  "arch": "$ARCH",
  "artifact": "libmpv.tar.gz",
  "sha256": "$SHA",
  "url": "$URL"
}
EOF

echo
echo "prebuilt libmpv $VERSION ($ARCH)"
echo "  tarball: $TARBALL"
echo "  sha256:  $SHA"
echo "  lock:    desktop/libmpv.lock.json"
if [ -z "$URL" ]; then
  echo "  NOTE: 'url' is empty. Publish the tarball to a GitHub Release and set 'url' in the lock so CI"
  echo "        is Homebrew-free + reproducible (see the comment at the top of this script)."
fi
