# Media playback roadmap

Follow-up work for in-app video playback. The current state and the deferred items live here so the
next session can pick up without re-deriving the research. See the design skill "Media player" for how
the shipped pieces fit together.

## Current state (branch `libmedia-player`)

Playback is adaptive (`web/next/src/lib/playback/`): `detectCapabilities()` probes the machine's decode
support (WebCodecs `VideoDecoder`/`AudioDecoder` + a native `<video>`), and `pickStrategy(name, caps)`
routes each file to the cheapest path that works:

- **native** - browser-safe (mp4/webm + H.264/AAC) -> the Vidstack full-screen player.
- **libmedia** - mkv/HEVC/AC3/E-AC3/DTS -> an in-browser [@libmedia](https://github.com/zhaohappy/libmedia)
  player (FFmpeg-to-WASM + hardware WebCodecs when available). Decodes container + codecs a plain
  `<video>` can't, streaming from our Range endpoint. `enableWorker: true` keeps decode off the main
  thread (verified: MKV/H.264/E-AC3 and MKV/HEVC-10bit/E-AC3-Atmos both play).
- **handoff** - a native player (VLC) via `@tauri-apps/plugin-opener`, as the desktop fallback and the
  runtime fallback when libmedia errors.

## Follow-ups (roughly by value)

### 1. Self-host libmedia (offline, self-contained)

libmedia's ESM entry + numbered chunks and the codec WASM currently load from the **jsdelivr CDN**
(`components/torrents/libmedia-player.tsx`). PeerZero is offline/self-contained, so the desktop build
(`NEXT_OUTPUT=export`) must serve them locally:

- Copy `node_modules/@libmedia/avplayer-ui/dist/esm/*` (entry + `*.avplayer.js` chunks) into
  `web/next/public/libmedia/esm/`, and the codec WASM (`decode/*.wasm`, `resample/*.wasm`,
  `stretchpitch/*.wasm`) into `web/next/public/libmedia/`. WASM come from the libmedia repo `dist`
  (jsdelivr `gh/zhaohappy/libmedia@1.3.1/dist/...`), not the npm package - fetch once via a build/
  postinstall script rather than committing ~2 MB binaries.
- Load the entry from `/libmedia/esm/avplayer.js` and set `wasmBaseUrl: '/libmedia'`. Same-origin also
  sidesteps any cross-origin worker concern.
- Keep both `-simd`/`-atomic`/baseline variants of each codec used (libmedia picks one per device).

### 2. Native ffmpeg remux - best desktop performance (the Jellyfin model)

The most performant path on the desktop is **not** in-browser WASM: bundle a native ffmpeg in the Tauri
sidecar and, for files the WebView can natively decode, **remux MKV -> fragmented MP4 by stream-copy**
(no re-encode, near-zero CPU), then play via the native `<video>`/Vidstack with the **OS hardware
decoders**. On macOS WebKit, HEVC and AC3/E-AC3 are OS-native, so `mkv(HEVC+AC3)` -> `fMP4(HEVC+AC3)`
Direct-Plays hardware-accelerated with no main-thread jank.

Extend `pickStrategy` into the full ladder: **direct-play -> remux (desktop) -> transcode-audio-only
-> full-transcode/handoff**, probing with `MediaSource.isTypeSupported` / `VideoDecoder.isConfigSupported`.
libmedia stays the fallback for the web/dev build (no native ffmpeg there) and rare codecs.

Caveats: AC3-in-fMP4 plays on macOS WKWebView but **not** Windows WebView2 (no AC3) - Windows needs an
AC3->AAC audio transcode. DTS and VVC decode nowhere natively -> transcode or libmedia. ffmpeg adds a
few MB/platform to the installer (fine for self-contained) plus the remux/transcode pipeline + serving.

### 3. Replace the @libmedia demo chrome

`@libmedia/avplayer-ui` ships a demo control bar with "Open Fold / Open File / Input Url" + a GitHub
icon, which don't belong in an embedded player. Either CSS-hide them, or drop to the headless
`@libmedia/avplayer` and render our own controls (cleaner, more work).

### 4. Subtitles + audio-track UX

libmedia already exposes audio/subtitle track pickers (seen on the multi-track Obsession file). Wire
external `.srt`/`.ass` sidecars from the torrent (`externalSubtitles` in `load()`), and persist the
chosen audio/subtitle track across opens.

### 5. Smaller items

- **Configurable external player** for the handoff (Settings: VLC/mpv/IINA path) - currently hardcoded
  to `"VLC"` in `lib/play-file.ts`.
- **Exact codec metadata from the engine** so `pickStrategy` routes on real stream info instead of the
  filename `hintsHevc` heuristic (`lib/playback/strategy.ts`).
