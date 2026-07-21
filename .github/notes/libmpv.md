# libmpv: prebuild, pin, bundle

How PeerZero ships a self-contained native mpv player without a live Homebrew dependency at build
time. This is a decision record; the mechanics live in `desktop/scripts/*` and `desktop/README.md`.

## Decision

**Prebuild libmpv once into a pinned, `@rpath`-relocated dylib closure, publish it as a checksummed
artifact, and consume that in the build.** Homebrew is used only to _produce_ the closure, never to
_consume_ it. Tauri's `bundle.macOS.frameworks` copies the (already-relocated) closure into the
`.app` during bundling, so the `.dmg` + updater come out self-contained with no post-processing.

## Why (research-backed)

A deep-research pass (unanimous 3-0 verifier votes on primary sources) established:

- **Every major mpv GUI player builds libmpv from source** (IINA, mpv-iina-avs, media-kit, karelrooted,
  mpv-build-macOS) via Meson - but **Homebrew is only needed to _produce_ libmpv, not to consume it.**
- **Redistributable prebuilt libmpv for macOS arm64 exists** (media-kit `libmpv-libs_*.tar.gz`, IINA's
  `iina.io/dylibs/arm64` closure), so a pinned download is viable. (MPVKit/karelrooted ship
  _xcframeworks_ - static, SwiftPM-shaped - which are NOT a `-lmpv` dylib drop-in, so we don't use them.)
- **The canonical bundling recipe is IINA's `change_lib_dependencies`**: `otool -L` the closure →
  `install_name_tool -change/-id` to `@rpath` → re-sign. `desktop/scripts/vendor-libmpv-closure.py` is
  exactly this.
- **Tauri copies vendored dylibs but does NOT rewrite their linking** (PR #12711, unmerged). We sidestep
  this by relocating the closure to `@rpath` _ourselves_ first, so Tauri's copy-only `macOS.frameworks`
  is sufficient - no unmerged Tauri feature needed.
- **The macOS updater ships `.app.tar.gz` + `.sig`, not the `.dmg`**, so any `.app` change must happen
  _before_ the tarball is generated. Bundling via `macOS.frameworks` happens _during_ `.app` assembly
  (before the tarball), so this constraint is satisfied automatically - no updater re-signing.

Ranked options (research): (1) self-produced pinned closure [chosen]; (2) third-party prebuilt -
faster but external dep + render-API/version-currency risk; (3) build-from-source-cached - slow;
(4) vendor-in-repo via git-lfs - bloats the repo; (5) live brew - worst for reproducibility.

## Flow

| Step                                                                        | Script                                                       | When                                |
| --------------------------------------------------------------------------- | ------------------------------------------------------------ | ----------------------------------- |
| Produce the closure + pin it                                                | `prebuild-libmpv.sh` → `vendor-libmpv-closure.py`            | maintainer, once per libmpv version |
| Consume (download pinned, or produce as bootstrap) + emit frameworks config | `fetch-libmpv.sh`                                            | every build + CI                    |
| Link against the closure                                                    | `build.rs` (prefers `vendor/libmpv/lib`)                     | every build                         |
| Bundle into the `.app`                                                      | Tauri `macOS.frameworks` (`--config libmpv.frameworks.json`) | every build                         |

Pinned in `desktop/libmpv.lock.json` (`mpvVersion`, `arch`, `sha256`, `url`). `vendor/` and
`libmpv.frameworks.json` are generated (gitignored); the lock is committed.

## Publishing a new libmpv (maintainer)

```bash
desktop/scripts/prebuild-libmpv.sh                 # produces vendor/libmpv.tar.gz + updates the lock
gh release create deps-libmpv-<ver> \
  desktop/src-tauri/vendor/libmpv.tar.gz --title "libmpv <ver>"
# set "url" in desktop/libmpv.lock.json to the asset's download URL, commit the lock
```

Until `url` is set, `fetch-libmpv.sh` produces the closure locally from Homebrew (dev/CI bootstrap);
once set, the build is fully Homebrew-free and reproducible (sha256-verified download).

## Open items

- **Codesigning/notarization**: the closure is ad-hoc signed (`codesign -s -`); releases currently
  ship unsigned (no Apple Developer ID wired). A Developer-ID + notarization pass (hardened runtime,
  sign each nested dylib, staple) is a separate future step - see the research caveats.
- **Prebuilt currency**: if adopting a third-party prebuilt later, verify it exports the OpenGL render
  API symbols (`mpv_render_context_*`) and covers the codecs we stream.
