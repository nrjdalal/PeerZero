# AI-assisted media naming (machine-native, on-device)

**Status:** on ice (undecided). Prototype done; blocked on the platform AI being enabled.

Auto-generate clean display names for torrents and lay finished video out in a
Jellyfin-friendly library, using an on-device model - no cloud, no API keys, nothing bundled
or downloaded by us.

## History

A deterministic (regex) version of both features shipped in v0.0.10 and was **reverted**
(`9fc6dec`, PR #38) because it mis-parsed real content: anime absolute-episode numbering
(`S4 - 08`) went unrecognized, and movie extras inherited the film's year and became bogus
separate movies. The lesson: hand-rolled parsing loses on the long tail, and bundling or
downloading an LLM is too heavy for a ~40MB self-contained app.

## Direction (from the research + prototype)

**Machine-native, on-device AI** - use the model the OS already has, so there is nothing to
bundle or download:

- **macOS:** Apple Foundation Models (macOS 26+), reachable from a tiny Swift helper the
  engine shells out to (the same pattern it already uses for the folder picker). Prototype
  confirmed: a 59 KB Swift binary compiles, links `FoundationModels`, and reaches the model -
  it only returned `appleIntelligenceNotEnabled` because Apple Intelligence was off on the
  test Mac.
- **Windows:** the Windows AI / Phi Silica APIs are the equivalent (later; more work).
- **Linux / older macOS / AI off:** no OS model -> fall back to a deterministic parser.

Ruled out, and why: a bundled/downloaded LLM (SmolLM2-360M ~230 MB, Qwen2.5-0.5B ~450 MB) is
too big for the installer and breaks "offline / self-contained"; browser-native (Chrome's
Prompt API) is absent from the Tauri system webviews (WKWebView / WebKitGTK), and the naming
runs in the headless engine anyway.

## Open questions

- The deterministic fallback: mature parsers (`guessit-js` for movies/TV, `anitomy` for anime -
  though its 6-year-old WASM did not load under Bun) vs a patched regex. This is the floor for
  everyone without OS AI, and the label source / eval baseline for the model.
- Coverage is Mac-first and gated on Apple Intelligence being enabled, so it is an enhancement
  for a subset of users, not universal.
- Carry over the reverted design that was sound: keep `displayName` separate from the canonical
  name, and never rename files on disk except via the hardlink library.
