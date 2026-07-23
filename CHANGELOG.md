# Changelog

## v0.0.26

[compare changes](https://github.com/nrjdalal/PeerZero/compare/v0.0.25...v0.0.26)

### 🩹 Fixes

- **logo:** Main build defaults to stable black, not local blue ([#100](https://github.com/nrjdalal/PeerZero/pull/100))

### ❤️ Contributors

- Neeraj Dalal @nrjdalal

## v0.0.25

[compare changes](https://github.com/nrjdalal/PeerZero/compare/v0.0.24...v0.0.25)

### 🚀 Enhancements

- **settings:** Update to any release from a version table ([#94](https://github.com/nrjdalal/PeerZero/pull/94))
- **desktop:** Canary channel identity + per-channel logo tint ([#96](https://github.com/nrjdalal/PeerZero/pull/96))
- **desktop:** Isolate canary data from stable ([#98](https://github.com/nrjdalal/PeerZero/pull/98))
- **settings:** One-click install for cross-channel releases ([#99](https://github.com/nrjdalal/PeerZero/pull/99))

### ❤️ Contributors

- Neeraj Dalal @nrjdalal

## v0.0.24

[compare changes](https://github.com/nrjdalal/PeerZero/compare/v0.0.23...v0.0.24)

### 🚀 Enhancements

- **transfers:** Slot-1 file Download + hover-to-focus in the file tree ([#90](https://github.com/nrjdalal/PeerZero/pull/90))

### 🏡 Chore

- **registry:** Refresh committed data ([beadf8f](https://github.com/nrjdalal/PeerZero/commit/beadf8f))

### ❤️ Contributors

- Neeraj Dalal @nrjdalal

## v0.0.23

[compare changes](https://github.com/nrjdalal/PeerZero/compare/v0.0.22...v0.0.23)

### 🚀 Enhancements

- **settings:** Check for updates from Advanced ([#92](https://github.com/nrjdalal/PeerZero/pull/92))

### 🩹 Fixes

- **player:** Focus the overlay once the portal mounts, not a render early ([#88](https://github.com/nrjdalal/PeerZero/pull/88))

### ❤️ Contributors

- Neeraj Dalal @nrjdalal

## v0.0.22

[compare changes](https://github.com/nrjdalal/PeerZero/compare/v0.0.21...v0.0.22)

### 🚀 Enhancements

- **transfers:** Deleted file shows a Download button in the progress cell ([#84](https://github.com/nrjdalal/PeerZero/pull/84))

### 🩹 Fixes

- **player:** Forward seeks no longer end playback; hover time + no-seek while downloading ([#85](https://github.com/nrjdalal/PeerZero/pull/85))

### 📖 Documentation

- **player:** Drop stale libmedia mention in resume comment ([#87](https://github.com/nrjdalal/PeerZero/pull/87))

### ❤️ Contributors

- Neeraj Dalal @nrjdalal

## v0.0.21

[compare changes](https://github.com/nrjdalal/PeerZero/compare/v0.0.20...v0.0.21)

### 🚀 Enhancements

- **search:** Search on Enter with hint, 2.5s auto debounce ([#78](https://github.com/nrjdalal/PeerZero/pull/78))
- **desktop:** Per-file actions in the file tree (play/open/download/delete) ([#77](https://github.com/nrjdalal/PeerZero/pull/77))

### 💅 Refactors

- **search:** Name MIN_QUERY_LEN + isMagnetUri, label the Enter hint ([#82](https://github.com/nrjdalal/PeerZero/pull/82))
- **player:** MacOS-native-only playback, remove the libmedia player ([#83](https://github.com/nrjdalal/PeerZero/pull/83))

### 📖 Documentation

- **notes:** Add competitive audit vs qBittorrent/Transmission/Deluge/webtorrent ([#81](https://github.com/nrjdalal/PeerZero/pull/81))

### 🏡 Chore

- **skills:** Remediate drift, worktree-named test builds, release skill ([#79](https://github.com/nrjdalal/PeerZero/pull/79))

### ❤️ Contributors

- Neeraj Dalal @nrjdalal

## v0.0.20

[compare changes](https://github.com/nrjdalal/PeerZero/compare/v0.0.19...v0.0.20)

### 🚀 Enhancements

- **torrents:** Resume video playback + fix flaky player controls ([#76](https://github.com/nrjdalal/PeerZero/pull/76))

### 🩹 Fixes

- **desktop:** Drop navbar brand inset in macOS fullscreen ([fc9ba99](https://github.com/nrjdalal/PeerZero/commit/fc9ba99))

### 🏡 Chore

- **registry:** Refresh committed data ([7a654b6](https://github.com/nrjdalal/PeerZero/commit/7a654b6))

### ❤️ Contributors

- Neeraj Dalal @nrjdalal

## v0.0.19

[compare changes](https://github.com/nrjdalal/PeerZero/compare/v0.0.18...v0.0.19)

### 🩹 Fixes

- **desktop:** Auto-restart after update via a Rust install command ([#73](https://github.com/nrjdalal/PeerZero/pull/73))
- **desktop:** Lift subtitles above the bottom control overlay ([#72](https://github.com/nrjdalal/PeerZero/pull/72))

### ❤️ Contributors

- Neeraj Dalal @nrjdalal

## v0.0.18

[compare changes](https://github.com/nrjdalal/PeerZero/compare/v0.0.17...v0.0.18)

### 🩹 Fixes

- **desktop:** Stop idle mpv rendering + version badge ([#69](https://github.com/nrjdalal/PeerZero/pull/69))
- **desktop:** Black startup splash and cleaner settings dialog ([38aa30b](https://github.com/nrjdalal/PeerZero/commit/38aa30b))

### 🏡 Chore

- **release:** Hand-set version to 0.0.18 ([a5a985d](https://github.com/nrjdalal/PeerZero/commit/a5a985d))

### ❤️ Contributors

- Neeraj Dalal @nrjdalal

## v0.0.17

[compare changes](https://github.com/nrjdalal/PeerZero/compare/v0.0.16...v0.0.17)

### 🚀 Enhancements

- **desktop:** Native in-app mpv video player ([#67](https://github.com/nrjdalal/PeerZero/pull/67))

### 🩹 Fixes

- **desktop:** Persist UI settings server-side so they survive restart ([a83627b](https://github.com/nrjdalal/PeerZero/commit/a83627b))

### 🏡 Chore

- **registry:** Refresh committed data ([c00c1dc](https://github.com/nrjdalal/PeerZero/commit/c00c1dc))
- **release:** Hand-set version to 0.0.17 ([8566227](https://github.com/nrjdalal/PeerZero/commit/8566227))

### ❤️ Contributors

- Neeraj Dalal @nrjdalal

## v0.0.16

[compare changes](https://github.com/nrjdalal/PeerZero/compare/v0.0.15...v0.0.16)

### 🩹 Fixes

- **desktop:** Resolve static file paths with node:path join ([#65](https://github.com/nrjdalal/PeerZero/pull/65))

### ❤️ Contributors

- Biswajeet Das @BiswaViraj

## v0.0.15

[compare changes](https://github.com/nrjdalal/PeerZero/compare/v0.0.14...v0.0.15)

### 🚀 Enhancements

- **web:** Keyboard-first command palette, shortcuts, and grid a11y ([#62](https://github.com/nrjdalal/PeerZero/pull/62))

### ❤️ Contributors

- Neeraj Dalal @nrjdalal

## v0.0.14

[compare changes](https://github.com/nrjdalal/PeerZero/compare/v0.0.13...v0.0.14)

### 🩹 Fixes

- **web:** Keyboard-navigate the Search grid like Transfers ([#59](https://github.com/nrjdalal/PeerZero/pull/59))
- **web:** Make the app chrome non-selectable (desktop feel) ([#61](https://github.com/nrjdalal/PeerZero/pull/61))

### ❤️ Contributors

- Neeraj Dalal @nrjdalal

## v0.0.13

[compare changes](https://github.com/nrjdalal/PeerZero/compare/v0.0.12...v0.0.13)

### 🔥 Performance

- **desktop:** Serve the UI over http so decode runs off the main thread ([#58](https://github.com/nrjdalal/PeerZero/pull/58))

### 🩹 Fixes

- **player:** Draggable top bar + padded controls ([#57](https://github.com/nrjdalal/PeerZero/pull/57))

### 📖 Documentation

- Rewrite the README around the video player + drop stale Intel builds ([#55](https://github.com/nrjdalal/PeerZero/pull/55))

### ✅ Tests

- Golden API suite in a central tests/ tree ([#54](https://github.com/nrjdalal/PeerZero/pull/54))

### ❤️ Contributors

- Neeraj Dalal @nrjdalal

## v0.0.12

[compare changes](https://github.com/nrjdalal/PeerZero/compare/v0.0.11...v0.0.12)

### 🚀 Enhancements

- **files:** Align the expanded file tree to the grid columns ([#52](https://github.com/nrjdalal/PeerZero/pull/52))

### 🩹 Fixes

- **desktop:** Run libmedia on the main thread in the Tauri WebView ([#48](https://github.com/nrjdalal/PeerZero/pull/48))
- **desktop:** Play videos in the packaged app (Bun stream fix + ephemeral ports) ([#51](https://github.com/nrjdalal/PeerZero/pull/51))

### 💅 Refactors

- Fold the torrent-engine into api-hono (in-process) ([#49](https://github.com/nrjdalal/PeerZero/pull/49))

### 📖 Documentation

- **plans:** Icebox machine-native AI media naming ([#45](https://github.com/nrjdalal/PeerZero/pull/45))
- Fix portless/port docs after the random-ports change ([#47](https://github.com/nrjdalal/PeerZero/pull/47))
- **skills:** Add a desktop skill for building and running the app ([#50](https://github.com/nrjdalal/PeerZero/pull/50))

### ❤️ Contributors

- Neeraj Dalal @nrjdalal

## v0.0.11

[compare changes](https://github.com/nrjdalal/PeerZero/compare/v0.0.10...v0.0.11)

### 🚀 Enhancements

- **transfers:** In-browser video playback + Netflix-style player (libmedia) ([#42](https://github.com/nrjdalal/PeerZero/pull/42))

### 🩹 Fixes

- **transfers:** Shorten the libmedia load-timeout to 10s ([#44](https://github.com/nrjdalal/PeerZero/pull/44))

### 📖 Documentation

- **plans:** Icebox the two-API merge and a native video player ([#41](https://github.com/nrjdalal/PeerZero/pull/41))

### ❤️ Contributors

- Neeraj Dalal @nrjdalal

## v0.0.10

[compare changes](https://github.com/nrjdalal/PeerZero/compare/v0.0.9...v0.0.10)

### 🚀 Enhancements

- Local AI display names + Jellyfin media library ([#38](https://github.com/nrjdalal/PeerZero/pull/38))

### ❤️ Contributors

- Neeraj Dalal @nrjdalal

## v0.0.9

[compare changes](https://github.com/nrjdalal/PeerZero/compare/v0.0.8...v0.0.9)

### 🚀 Enhancements

- **transfers:** Expandable per-torrent file tree + WAI-ARIA treegrid nav ([#32](https://github.com/nrjdalal/PeerZero/pull/32))

### 🩹 Fixes

- **api:** Bind dev server to loopback so a port collision fails loud ([#33](https://github.com/nrjdalal/PeerZero/pull/33))

### ❤️ Contributors

- Neeraj Dalal @nrjdalal

## v0.0.8

[compare changes](https://github.com/nrjdalal/PeerZero/compare/v0.0.7...v0.0.8)

### 🩹 Fixes

- **desktop:** 1080x720 window floor and a branded startup splash ([#30](https://github.com/nrjdalal/PeerZero/pull/30))

### ❤️ Contributors

- Neeraj Dalal @nrjdalal

## v0.0.7

[compare changes](https://github.com/nrjdalal/PeerZero/compare/v0.0.6...v0.0.7)

### 🩹 Fixes

- **desktop:** Draggable title bar, external links, and in-app updater ([#28](https://github.com/nrjdalal/PeerZero/pull/28))

### ❤️ Contributors

- Neeraj Dalal @nrjdalal

## v0.0.6

[compare changes](https://github.com/nrjdalal/PeerZero/compare/v0.0.5...v0.0.6)

### 🩹 Fixes

- **torrents:** Kill first-load flash + add a Syncing state for restored torrents ([#25](https://github.com/nrjdalal/PeerZero/pull/25))
- **desktop:** Overlay the macOS title bar so it stops duplicating the brand ([#26](https://github.com/nrjdalal/PeerZero/pull/26))
- **engine:** Default sidecar port to 6339 so PORTLESS=0 works ([#17](https://github.com/nrjdalal/PeerZero/pull/17))

### 🏡 Chore

- Align docker and docs to the canonical 9410/9336/6339 ports ([#27](https://github.com/nrjdalal/PeerZero/pull/27))

### ✅ Tests

- **hono:** End-to-end test for the API → torrent-engine flow ([#21](https://github.com/nrjdalal/PeerZero/pull/21))

### 🎨 Styles

- **web:** Hide scrollbars app-wide ([#22](https://github.com/nrjdalal/PeerZero/pull/22))

### ❤️ Contributors

- Neeraj Dalal @nrjdalal
- Siddharth Gaikwad @sidgaikwad

## v0.0.5

[compare changes](https://github.com/nrjdalal/PeerZero/compare/v0.0.4...v0.0.5)

### 🩹 Fixes

- **engine:** Tolerate existing dirs when setting the download folder ([#19](https://github.com/nrjdalal/PeerZero/pull/19))

### 💅 Refactors

- **env:** Make the app local-first with no env required ([#23](https://github.com/nrjdalal/PeerZero/pull/23))

### ❤️ Contributors

- Neeraj Dalal @nrjdalal
- Siddharth Gaikwad @sidgaikwad

## v0.0.4

[compare changes](https://github.com/nrjdalal/PeerZero/compare/v0.0.3...v0.0.4)

### 🚀 Enhancements

- **desktop:** Self-contained desktop app + cross-platform release CI (Tauri + Bun) ([#10](https://github.com/nrjdalal/PeerZero/pull/10))

### ❤️ Contributors

- Neeraj Dalal @nrjdalal

## v0.0.3

[compare changes](https://github.com/nrjdalal/PeerZero/compare/v0.0.2...v0.0.3)

### 🚀 Enhancements

- **dev:** Run the torrent-engine sidecar under portless with pinned ports ([#11](https://github.com/nrjdalal/PeerZero/pull/11))
- **ui:** Matching header/footer bars + width-stable Browse button ([#13](https://github.com/nrjdalal/PeerZero/pull/13))

### ❤️ Contributors

- Neeraj Dalal @nrjdalal

## v0.0.2

[compare changes](https://github.com/nrjdalal/PeerZero/compare/v0.0.1...v0.0.2)

### 🚀 Enhancements

- Run torrent engine under Bun on webtorrent 3 ([#6](https://github.com/nrjdalal/PeerZero/pull/6))
- Expand search providers + 12-24h failure backoff ([#9](https://github.com/nrjdalal/PeerZero/pull/9))
- Self-contained build, grid selection, Completed tab, gated Search, dialog pattern ([#8](https://github.com/nrjdalal/PeerZero/pull/8))

### 💅 Refactors

- Strip PeerZero to a self-contained local client ([#7](https://github.com/nrjdalal/PeerZero/pull/7))

### 📖 Documentation

- Sync download-dir and maxConns defaults across README and docs ([#4](https://github.com/nrjdalal/PeerZero/pull/4))

### ❤️ Contributors

- Neeraj Dalal @nrjdalal

## v0.0.1

### 🚀 Enhancements

- Local-only bittorrent client with encoded registry ([4b278d8](https://github.com/nrjdalal/PeerZero/commit/4b278d8))
- Download-folder settings, colored status/actions, filled icons ([#1](https://github.com/nrjdalal/PeerZero/pull/1))
- Status-colored reveal icon, picker-only download folder, navbar open-folder ([#2](https://github.com/nrjdalal/PeerZero/pull/2))

### ❤️ Contributors

- Neeraj Dalal @nrjdalal
