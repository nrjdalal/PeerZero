#!/usr/bin/env bash
# Ensure a pinned, self-contained libmpv closure is present at desktop/src-tauri/vendor/libmpv (with
# NO live Homebrew when a pinned artifact is configured), and emit the Tauri `frameworks` config that
# bundles it. Consumed by build.rs (linking) and by `tauri build --config` (bundling). Idempotent.
#
# Because the closure is pre-@rpath-relocated (vendor-libmpv-closure.py), Tauri's copy-only
# `bundle.macOS.frameworks` is sufficient to make the .app self-contained - no post-build dylib
# rewriting, and therefore no updater-tarball re-signing (the .dmg + updater come out self-contained
# straight from `tauri build`).
#
# Resolution order:
#   1. lock.json has a "url" -> download the pinned tarball, verify sha256 vs the lock, extract
#      (reproducible, no Homebrew). The CI path once the artifact is published.
#   2. otherwise (artifact not published yet) -> produce locally from Homebrew (ensure-libmpv +
#      vendor-libmpv-closure.py). Dev/bootstrap path; publish the artifact for reproducible CI.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

[ "$(uname -s)" = "Darwin" ] || {
  echo "fetch-libmpv: non-macOS host, skipping (no native mpv render path yet)"
  exit 0
}

LOCK="desktop/libmpv.lock.json"
VENDOR="desktop/src-tauri/vendor/libmpv"
FRAMEWORKS_CFG="desktop/src-tauri/libmpv.frameworks.json"
get() { python3 -c "import json;print(json.load(open('$LOCK')).get('$1',''))" 2>/dev/null || echo ""; }

WANT_VER="$(get mpvVersion)"
URL="$(get url)"
SHA="$(get sha256)"

present() { [ -f "$VENDOR/VERSION" ] && [ "$(cat "$VENDOR/VERSION")" = "$WANT_VER" ] && [ -f "$VENDOR/lib/libmpv.dylib" ]; }

if present; then
  echo "fetch-libmpv: vendor/libmpv present (mpv $WANT_VER)"
elif [ -n "$URL" ]; then
  echo "fetch-libmpv: downloading pinned libmpv $WANT_VER"
  rm -rf "$VENDOR"
  mkdir -p "$(dirname "$VENDOR")"
  tmp="$(mktemp -d)"
  curl -fSL "$URL" -o "$tmp/libmpv.tar.gz"
  got="$(shasum -a 256 "$tmp/libmpv.tar.gz" | awk '{print $1}')"
  if [ "$got" != "$SHA" ]; then
    echo "fetch-libmpv: sha256 mismatch (want $SHA, got $got)" >&2
    exit 1
  fi
  tar -xzf "$tmp/libmpv.tar.gz" -C "$(dirname "$VENDOR")"
  rm -rf "$tmp"
  echo "fetch-libmpv: verified + extracted (sha256 $got)"
else
  echo "fetch-libmpv: no pinned 'url' in $LOCK; producing locally from Homebrew (publish the artifact for reproducible CI)"
  rm -rf "$VENDOR"
  mkdir -p "$(dirname "$VENDOR")"
  bash desktop/scripts/ensure-libmpv.sh
  python3 desktop/scripts/vendor-libmpv-closure.py "$(brew --prefix mpv)/lib/libmpv.2.dylib" "$VENDOR"
  got="$(cat "$VENDOR/VERSION" 2>/dev/null || echo unknown)"
  if [ -n "$WANT_VER" ] && [ "$got" != "$WANT_VER" ]; then
    echo "fetch-libmpv: WARNING Homebrew shipped mpv $got but the lock pins $WANT_VER - this build is not reproducible; publish an artifact and set 'url' to pin exactly" >&2
  fi
fi

# Emit the Tauri frameworks config: every real dylib in the closure (skip the libmpv.dylib linker
# symlink), as paths relative to src-tauri (Tauri's requirement). Merged in via `tauri build --config`.
python3 - "$VENDOR/lib" "$FRAMEWORKS_CFG" <<'PY'
import json, os, sys
libdir, out = sys.argv[1], sys.argv[2]
rel = os.path.relpath(libdir, "desktop/src-tauri")  # -> vendor/libmpv/lib
paths = sorted(f"{rel}/{n}" for n in os.listdir(libdir)
               if n.endswith(".dylib") and not os.path.islink(os.path.join(libdir, n)))
json.dump({"bundle": {"macOS": {"frameworks": paths}}}, open(out, "w"), indent=2)
print(f"fetch-libmpv: wrote {out} ({len(paths)} frameworks)")
PY
