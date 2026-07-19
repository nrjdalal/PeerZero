# Changelog

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
