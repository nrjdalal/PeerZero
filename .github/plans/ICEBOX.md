# Icebox

Deferred work and known issues, newest first. Pick from here when there's time; move an item into a
real plan/PR when you start it. The larger media roadmap lives in [media-playback.md](./media-playback.md).

## Known issues

### libmedia stalls on large multi-track MKVs (e.g. the Obsession main movie)

**Symptom:** the in-browser player spins forever on `Obsession (2026) (1080p BluRay x265 Ghost).mkv`
(the 6 GB main movie) - it never plays. Smaller files from the same torrent (e.g. `Behind the Scenes
B-Roll.mkv`, 364 MB) play fine.

**Diagnosis (confirmed 2026-07-19):**

- The Range stream is fine: a `bytes=6000000000-...` request on the 6 GB file returns `206` instantly
  with the right `content-range`, so the engine/API are not the problem.
- The self-hosted HEVC/EAC3/etc. wasm all fetch `200`.
- libmedia's `load()` logs its init (`setVolume`/`setLoop`/`setPlaybackRate`) but **never** emits
  `Input #0` / `loaded` - it hangs during demux/probe. Still hung after 40s, so it's a **true hang**,
  not slow decode.
- **Not** the workers: it hangs with `enableWorker` both `true` and `false`.
- It fetches `mjpeg-simd.wasm` - the file has an mjpeg **attached-pic** (cover art) plus 20+ subtitle
  tracks (PGS + SRT) and multiple audio tracks (AC3/E-AC3). Likely libmedia chokes on the complex
  container (or mis-selects the attached-pic as the video stream via `findBestStream`).

**Mitigation shipped:** a 20s load-timeout in `libmedia-player.tsx` falls back to the native VLC
handoff, so these files open in VLC instead of an infinite spinner.

**Real fix ideas (pick one):**

- Reproduce on real hardware (agent-browser can't HEVC-hardware-decode, so it always software-decodes).
- Try libmedia load options: `maxProbeDuration`, `findBestStream`, `checkUseMSE`; explicitly select the
  HEVC video stream and ignore the attached-pic / PGS subtitles during probe.
- File upstream if it's a libmedia demux bug (repro: multi-GB HEVC MKV with an mjpeg cover + PGS subs).
- Or: route very large HEVC files straight to the native handoff (the VLC path already plays them
  hardware-accelerated), keeping libmedia for the common case.

## Player polish

- **Buffered band** on the scrubber - Netflix shows a lighter-grey buffered segment ahead of the red
  played portion; ours is red -> grey only. Needs libmedia's buffered range wired to a second track layer.
- **Clean up the title** - the player shows the raw filename (`Rick.and.Morty.S09E08...EDITH[E...`).
  Strip the extension + scene tags (`1080p`/`WEB`/`h264`/release group) so it reads like a real title.
- **Next-episode / episodes** buttons for multi-file torrents (seasons) - thread the file list + index
  into the player so the right cluster can advance to the next video file.

## Cleanup

- **Remove `@vidstack/react`** - the Vidstack player (`components/torrents/player.tsx`) was deleted when
  every file moved to the libmedia Netflix player; the dep is now unused. Drop it from the root catalog
  and `web/next/package.json`, then `bun i`.
- Stale doc drift: `isPlayable`'s comment in `file-tree.tsx` still describes the old native/`<video>`
  routing; update it to "plays in the libmedia player."
