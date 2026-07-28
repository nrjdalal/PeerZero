// Which desktop platform the UI is running on. The same static export ships inside every OS build, so
// the platform can only be read at runtime - and only AFTER mount (window/navigator), or the static
// export hydrate-mismatches. Call these from a useEffect, never during render.

// Are we inside the Tauri desktop shell (as opposed to a plain browser)?
export const isDesktopApp = () =>
  typeof window !== "undefined" && ("__TAURI_INTERNALS__" in window || "isTauri" in window)

// Are we inside the desktop shell ON macOS? Gates every macOS-only Rust command, because the
// non-macOS builds don't register them (src-tauri/src/lib.rs) and invoking one only yields an error:
//   - in-app playback: the mpv render layer (src-tauri/src/mpv_render.rs) is macOS-only and there is
//     no browser-codec fallback, so Windows/Linux reveal a playable file on disk instead.
//   - side-by-side install (install_dmg): implemented with hdiutil/ditto into /Applications.
export const isMacDesktopApp = () => isDesktopApp() && /Mac/i.test(navigator.userAgent)
