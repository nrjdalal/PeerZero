# Native video player

**Status:** on ice (undecided). Related work lives in the `libmedia-player` / `play-videos`
worktree.

In-app native video playback for downloaded (and streaming) media, instead of handing off to
an external player.

## Goal

Play a completed torrent's video directly in the app - seek, subtitle and audio-track
selection - via a hardware-accelerated / native path, rather than the browser `<video>`
element, which fails on codecs the system webview cannot decode (e.g. HEVC / 10-bit, which
the current library already contains).

## Open questions

- Decode path: WebCodecs vs a libmedia/WASM decoder vs a native sidecar.
- Codec coverage that actually matters for real torrents (HEVC, 10-bit, AV1).
- How playback integrates with the Tauri system webviews across macOS (WKWebView), Windows
  (WebView2), and Linux (WebKitGTK), which differ in codec support.
- Whether it streams the torrent engine's pieces (play while downloading) or only plays
  completed files.
