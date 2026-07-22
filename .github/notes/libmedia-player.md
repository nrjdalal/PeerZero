# Removed: the cross-platform libmedia in-app player

PeerZero is a personal, Mac-first tool. In-app video playback is now **macOS-native-only**
(libmpv, `mpv-player.tsx`); Windows and Linux are download-only, with no in-app player. The
cross-platform in-app player that used `@libmedia/avplayer-ui` was removed for that reason. This
note preserves how it worked so it can be re-added if cross-platform playback is ever wanted
again.

Last commit that contained the implementation: `c542918` (canary). Recover any file below with
`git show c542918:<path>`.

## What it was

A second, browser-based in-app player (`LibmediaPlayer` in
`web/next/src/components/torrents/libmedia-player.tsx`) that ran everywhere the native mpv render
layer did not: Windows/Linux desktop and any plain browser. It used
[libmedia](https://github.com/zhaohappy/libmedia)'s `@libmedia/avplayer-ui` (FFmpeg compiled to
WebAssembly, driving WebCodecs when the codec was available) purely as a headless decode engine,
behind PeerZero's own Netflix-style control overlay. On decode/load failure it fell back to the
native-player handoff (open in VLC on desktop, a toast in a plain browser).

Player selection lived in `file-tree.tsx`:

```
{playing && (isMacDesktopApp()
  ? <MpvPlayer .../>          // macOS packaged app: native libmpv
  : <LibmediaPlayer .../>)}   // everything else: libmedia WASM/WebCodecs
```

## How it worked (key implementation points)

- **Decode engine, our chrome.** The library's built-in UI was fully hidden via CSS
  (`.avplayer-ui-*` rules in `libmedia-player.css`, `display:none !important`); only its video
  surface was kept. Our overlay drew every control. The Netflix-style scrubber/volume styles
  (`.nf-scrubber`, `.nf-volume`) were shared with the mpv player and now live in
  `player-controls.css`.
- **Self-hosted, offline.** The ESM chunks + codec WASM were vendored into
  `web/next/public/libmedia/{decode,esm,resample,stretchpitch}` by
  `.github/scripts/vendor-libmedia.ts` (a manual refresh script, not part of the build), so the
  app ran fully offline. It was loaded by a bundler-ignored dynamic import of the vendored ESM
  entry:
  ```
  const entry = "/libmedia/esm/avplayer.js"
  const { default: AVPlayer } = await import(/* turbopackIgnore: true */ entry)
  new AVPlayer({ container, wasmBaseUrl: "/libmedia", enableWorker: canUseWorkers() })
  ```
- **Off-main-thread decode** when the origin allowed Workers (`enableWorker`); the desktop app
  served its UI over `http://127.0.0.1` for exactly that. No COOP/COEP (no SharedArrayBuffer).
- **Events consumed:** `loading` / `loaded` (then `getDuration`, `getSubtitleList`) / `playing` /
  `played` / `paused` / `ended` (clears resume position) / `seeking` / `seeked` / `time`.
- **Load-timeout guard.** libmedia could stall demuxing some large/complex files and never emit
  `loaded`; a 10s timeout fell back to the VLC handoff so the user was never stuck on a spinner.
- **Shared with the mpv player:** `useResumePosition` (`lib/use-resume-position.ts`, per-file
  resume across restarts) and `useScrubbing` (`lib/use-scrubbing.ts`, drag guard). Both remain in
  the tree, still used by `mpv-player.tsx`.

## Files / deps that made it up (all removed)

- `web/next/src/components/torrents/libmedia-player.tsx` - the player component.
- `web/next/src/components/torrents/libmedia-player.css` - library chrome-hiding + the shared
  `.nf-*` control styles (the `.nf-*` styles were split out to `player-controls.css`, kept).
- `web/next/public/libmedia/**` - 45 vendored WASM/ESM assets.
- `.github/scripts/vendor-libmedia.ts` - the vendoring script.
- Dependency `@libmedia/avplayer-ui` (pinned `1.3.1`) in the root catalog + `web/next`.
- The `isMacDesktopApp() ? MpvPlayer : LibmediaPlayer` branch and the off-Mac Play affordance in
  `file-tree.tsx`.

## To re-implement

1. Re-add the dep: `@libmedia/avplayer-ui` to the root `catalog` and `web/next` (`catalog:`),
   then `bun install`.
2. Re-run the vendoring script to refetch assets into `web/next/public/libmedia`
   (restore `.github/scripts/vendor-libmedia.ts` from `c542918` first).
3. Restore `libmedia-player.tsx` and the `.avplayer-ui-*` chrome-hiding CSS (append it back to a
   player CSS file; `player-controls.css` already holds the shared `.nf-*` styles).
4. In `file-tree.tsx`, restore the player-selection branch and re-enable the Play affordance for
   non-Mac (gate playback on "playable" again instead of on `isMacDesktopApp()`).
5. Update README / desktop/README / the `design` skill "Media player" bullet to describe
   cross-platform playback again.
