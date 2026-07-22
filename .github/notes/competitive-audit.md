# PeerZero competitive audit

> Formatted, interactive version (feature matrix + roadmap cards):
> https://claude.ai/code/artifact/31cc4c91-da71-4e14-bc40-f2f11981603b

Date: 2026-07-22. Engine: `webtorrent@3.0.16`. Scope: `api/hono` + `web/next` + `desktop`.
Method: full source read of PeerZero, plus three primary-source research passes over
competitors' open source (qBittorrent, Transmission, Deluge, libtorrent, WebTorrent Desktop
and the webtorrent library, Stremio, Prowlarr, Popcorn Time, OpenSubtitles).

## The one thing to take away

PeerZero already has the plumbing of the best-in-class tools; the leverage is in capabilities
it owns but does not use. Its search engine is a leaner Cardigann/Torznab (declarative
`json`/`rss`/`html` provider defs, parallel fan-out, infohash dedup, health canaries), the
same shape as Prowlarr and Torrentio. Its Bun/Hono + WebSocket backend is the same "one engine,
many thin clients" model as Transmission's daemon. And `webtorrent@3.0.16` already ships rate
limiting, per-file priority, a streaming read-ahead window, bitfield fast-resume and swarm
scrape, none of which PeerZero has wired up. The highest-value work is an enrichment layer on
discovery plus turning on library capabilities that are one call away, not catching up on
protocol features.

## Positioning: what PeerZero is (and deliberately is not)

A local-only, streaming-first BitTorrent downloader with a keyboard-first UX, shipped as a
self-updating Tauri desktop app with a single in-process Bun/Hono backend running `webtorrent`.
It is deliberately not a seeding/ratio power tool, has no accounts or cloud, and does not chase
anonymity. It competes on streaming quality, discovery and ergonomics, not on being qBittorrent.

Already in the tree (verified in code): multi-provider search with a data-driven def engine,
health auto-disable + canary, directory-tracked origins, infohash dedup, seeder sort; transfers
grid with live WebSocket stats, bulk actions and full keyboard nav; per-file tree with per-file
play; native mpv streaming (MKV/HEVC/AV1/AC3, embedded subs, resume position) with a browser +
VLC fallback; a Command-K palette and shortcuts; local-only, no seeding, per-torrent folders.

One caveat that shapes the roadmap: native any-codec mpv playback is macOS-only (the render layer
is macOS-only); Windows and Linux desktop are download-only, with no in-app player. (A browser-codec
libmedia fallback covered them at audit time but has since been removed; see
`.github/notes/libmedia-player.md`.)

## The reframing: webtorrent 3.0.16 capabilities PeerZero owns but does not use

The client is built with only `{ maxConns: 25, utp: false }`, so every library default below is
already active.

| Capability                               | Status in PeerZero | What it takes                                                                                                   |
| ---------------------------------------- | ------------------ | --------------------------------------------------------------------------------------------------------------- |
| Global bandwidth caps                    | unused             | `client.throttleDownload/throttleUpload` exist (index.js:439/452). Add two Settings fields.                     |
| Per-file skip and priority               | unused             | `file.select(priority)` / `file.deselect()` exist; engine calls bare `file.select()` (priority 0) only.         |
| Streaming read-ahead window              | automatic          | `FileIterator` calls `critical()` for a 2-piece window per read; PeerZero gets it free by re-opening per Range. |
| Sequential strategy                      | on (default)       | Ideal for streaming already; a per-torrent `rarest` toggle would help bulk completion.                          |
| Encryption (MSE/PE)                      | on (secure=1)      | `secure ?? 1` = allow. Not a gap. `secure=2` (require) needs native RC4.                                        |
| UPnP / NAT-PMP / LSD / PEX               | on (default)       | All default-on, not overridden. Worth verifying they actually bind under Bun.                                   |
| IP blocklist                             | unused             | `opts.blocklist` maps to `load-ip-set` (index.js:172). Add a settings URL/file.                                 |
| Bitfield fast-resume                     | unused             | Full re-hash on every boot. Persist bitfield, then spot-check instead (torrent.js:1261).                        |
| Swarm scrape (real seeder counts)        | unused             | `bittorrent-tracker` `Client.scrape()` (already a transitive dep).                                              |
| Super-seeding / ratio / per-torrent caps | hard / N/A         | No primitive in webtorrent, and out of scope for a no-seed client. Honest limit.                                |
| Peer-level SOCKS proxy / uTP             | hard               | No peer-conn proxy; uTP crashes Bun (`utp:false`); WebRTC stubbed. Honest limits.                               |

## Feature comparison

Y present, ~ partial/unexposed, N absent. Last column is the realistic path for PeerZero.

| Feature                          |  qBit   | Transmission | Deluge  | WT Desktop | Stremio | PeerZero  | Path for us                     |
| -------------------------------- | :-----: | :----------: | :-----: | :--------: | :-----: | :-------: | ------------------------------- |
| **Discovery and streaming**      |         |              |         |            |         |           |                                 |
| Multi-provider search            | plugins |      N       | plugins |     N      | addons  |     Y     | Already strong (def engine)     |
| Filename to quality/SxE/codec    |    N    |      N       |    N    |     ~      |    Y    |     N     | P0: parse-torrent-title         |
| Poster / IMDb / TMDB metadata    |    N    |      N       |    N    |     N      |    Y    |     N     | P2: Cinemeta/TMDB               |
| Subtitle search and fetch        |    N    |      N       |    N    |   embed    |    Y    |   embed   | P1: OpenSubtitles by hash       |
| Play while downloading           |    N    |      N       |    N    |     Y      |    Y    |     Y     | Core strength (native mpv)      |
| User-pluggable providers         |    Y    |      N       |    Y    |     N      |    Y    |     N     | P1: load defs from file/URL     |
| Watchlist / continue-watching    |    N    |      N       |    N    |     ~      |    Y    |  resume   | P2: reuse prefs store           |
| **Download control**             |         |              |         |            |         |           |                                 |
| Sequential / streaming order     |    Y    |      Y       |    Y    |     Y      |    ~    |  default  | On by default; surface a toggle |
| Per-file select / skip           |    Y    |      Y       |    Y    |     Y      |    N    |    N*     | P1: deselect + rescanFiles      |
| Bandwidth caps (global)          |    Y    |      Y       |    Y    |     Y      |    N    |     N     | P0: throttleDownload/Upload     |
| Queueing (max active)            |    Y    |      Y       |    Y    |     ~      |    N    |     N     | P1: app-layer gate              |
| Bandwidth scheduler              |    Y    |      Y       | plugin  |     N      |    N    |     N     | P2: timer over caps             |
| Completion hook (run / webhook)  |    ~    |      Y       | plugin  |     N      |    N    |     N     | P1: fan out done-event          |
| **Engine and resume**            |         |              |         |            |         |           |                                 |
| Fast-resume (no full re-hash)    |    Y    |      Y       |    Y    |     Y      |    N    |     N     | P0: persist bitfield            |
| Real swarm health (scrape)       |    Y    |      Y       |    Y    |     ~      |    N    | connected | P0: tracker scrape              |
| DHT / PEX / LSD / WebSeed        |    Y    |      Y       |    Y    |     Y      |    N    | on/no WS  | On by default; add `urlList`    |
| Peer / tracker inspector         |    Y    |      Y       |    Y    |     Y      |    N    |     N     | P1: read `t.wires`              |
| **UX and control surface**       |         |              |         |            |         |           |                                 |
| Keyboard-first / command palette |    N    |      N       |    N    |     N      |    ~    |     Y     | Clear differentiator            |
| .torrent file add (drop/picker)  |    Y    |      Y       |    Y    |     Y      |    N    |     N     | P0: README claims it; ship it   |
| Remote / web / daemon control    |    Y    |      Y       |    Y    |     N      |    N    | local API | P2: expose + token              |
| RSS auto-download                |    Y    |      N       | plugin  |     N      |    N    |     N     | P2: rss def + rules             |
| Casting (DLNA / Chromecast)      |    N    |      N       |    N    |     Y      |    Y    |     N     | P2: reuse Range server          |

\* Selective per-file download landed in #77 after this audit was drafted; re-scope P1 item 9
against what shipped (see the WebTorrent per-file delete note).

## Prioritized roadmap

Ranked by value x low friction x fit with PeerZero's identity.

### P0: cheap, high-value, on-identity (mostly turning on what is already there)

1. **Parse the release name into structured metadata.** Effort S, no new network. Derive
   quality/resolution/codec/season/episode from the name (trackers do not provide it). Highest
   visibility: makes results scannable, unlocks "one title, many qualities" grouping, feeds the
   existing faceted grid. Sketch: run a parse-torrent-title port in `assemble()`, add
   `SearchResult.parsed`, render badges + a Quality/Resolution facet. Learned from Torrentio,
   Stremio addons, Prowlarr; lib `clement-escolano/parse-torrent-title`.

2. **Bitfield fast-resume.** Effort S, ~15 lines. On boot PeerZero full-hashes every piece
   (the reason for the "Syncing" fallback). Persist `torrent.bitfield` and pass it back on add
   so the engine spot-checks instead. Sketch: `saveState()` adds
   `bitfield: Buffer.from(t.bitfield.buffer).toString('base64')`; `restoreOnBoot()` passes
   `{ bitfield: Buffer.from(saved.bitfield,'base64') }`; keep the `restored` snapshot as a
   safety net (webtorrent full-verifies on a size mismatch). Ref webtorrent torrent.js:1261.

3. **Give the streamed file real priority.** Effort XS, 1 line. Streaming already gets a
   2-piece read-ahead from webtorrent's `FileIterator`, but the engine's `file.select()` passes
   priority 0, so a playing video does not outrank other active torrents. Fix
   `webtorrent.mjs:485` to `file.select(1_000_000)`; optionally `torrent.critical(...)` at a
   seek target. Ref lib/file-iterator.js:27/50, lib/torrent.js:1408.

4. **Real swarm health via tracker scrape.** Effort S, ~1 file. The current seeder count only
   counts connected peers whose bitfield is complete; it undercounts and shows 0 before any peer
   connects. A UDP/HTTP scrape returns swarm-wide counts. Sketch: new
   `api/hono/src/lib/torrent/scrape.ts` calling `Client.scrape({ announce, infoHash:[hash] })`,
   cache in the meta Map on add + a slow interval, surface in `snapshot()`. `bittorrent-tracker`
   is already a transitive dep; `trackers.ts` already curates a tracker list.

5. **Bandwidth caps in Settings.** Effort S, ~20 lines. `client.throttleDownload/throttleUpload`
   applied on boot and on change, persisted in `settings.json`, two number fields beside the
   download folder. A gentler, more legible lever than the fixed `maxConns=25`. Ref
   webtorrent index.js:439/452.

6. **Accept .torrent files (and fix the doc drift).** Effort S-M. The README promises "drop a
   .torrent" but the add path is magnet-only with no drop handler. The engine already accepts a
   Buffer source (it does on restore), so wire a drop zone + file picker: `torrents.ts` accepts
   a file/base64 body to `engine.add(buffer)`; web adds a drag-drop target and an
   "Open .torrent" palette entry.

### P1: differentiators worth the build

7. **Fetch subtitles from OpenSubtitles.** Effort M. mpv only renders embedded subs. PeerZero
   has the video bytes on disk, so compute the OpenSubtitles moviehash (filesize + first/last
   64 KiB), fetch an exact-match track (`moviehash_match`), fall back to filename to title/SxE,
   and `sub-add` it in mpv (external subs already supported). Learned from Popcorn Time
   (`vankasteelj/opensubtitles-api` ranking: hash > filename > imdb).

8. **Audio-track picker in the player.** Effort S. Multi-audio MKVs are common and the mpv
   player already parses the full `track-list` for its subtitle menu; point the same plumbing at
   `aid` instead of `sid`.

9. **Per-file selection wired to the engine.** Effort M. WebTorrent Desktop's pattern: deselect
   the whole torrent then select wanted files; for a true byte delete, pair unlink with
   `rescanFiles()` to correct the bitfield. (Selective download shipped in #77; re-scope against
   that.) Ref WT Desktop renderer/webtorrent.js:258.

10. **Group results by title + quality tiers.** Effort S-M, needs item 1. Collapse rows sharing
    a normalized title into one card with per-resolution children (YTS/Torrentio UX), reusing
    the existing infohash dedup and seeder sort.

11. **Completion hook (run a command / webhook).** Effort S. Transmission's `script-torrent-done`
    and Deluge's Execute plugin are small and popular. PeerZero already fires an internal
    complete event (it auto-stops on done); fan it out to an optional user command or webhook.

12. **Make providers user-pluggable.** Effort M-L. The defs are already declarative; load them
    from a user file or URL (how Jackett/Prowlarr ship YAML separately from the binary), add an
    `imdbId` field for metadata joins, optionally a torznab adapter or a Stremio-style
    install-by-URL provider.

### P2: bigger bets and platform work

13. **Native mpv on Windows and Linux.** Effort L. The biggest cross-platform quality gap: bring
    the mpv render layer to the other desktops so any-codec playback is standard everywhere.

14. **Metadata enrichment + a library rail.** Effort M-L. With an `imdbId`/`tmdbId` join key,
    hydrate posters/plot/rating from TMDB or Cinemeta and add a Continue-watching / Library rail
    on the existing server-side prefs and resume-position. Weigh against the no-account ethos.

15. **Binge/next-episode, RSS auto-download, casting.** Effort M-H. Next-episode auto-advance
    (needs parsed SxE), a qBittorrent-style plain-text RSS rule engine (OR-of-ANDs, no regex
    required), and DLNA/Chromecast over the existing Range server. Coherent extensions, none on
    the critical path.

## Deliberately out of scope, and honest engine limits

Skipping these is a feature, not a shortfall.

- Seeding, ratio and super-seeding: webtorrent has no ratio/super-seed primitive, and PeerZero
  auto-stops on complete by design.
- Per-torrent bandwidth caps: only a global throttle group is exposed; per-torrent needs a fork.
  Ship global caps instead.
- Peer-level SOCKS proxy / anonymous mode: trackers can proxy, peer TCP/uTP cannot without a fork.
- Graded 0-7 piece priority: webtorrent offers binary select + `critical`; present a 2-3 level
  control, not libtorrent's eight.
- uTP and in-process WebRTC: uTP crashes Bun (`utp:false`) and WebRTC is stubbed; TCP + DHT +
  trackers cover a local client.
- Do not swap to `torrent.createServer()`: the hand-rolled Range handler is deliberate (it
  sidesteps Bun's `Readable.toWeb` bug) and the built-in server adds no extra prioritization
  over `FileIterator`.

## Drift and correctness notes found during the audit

- README over-promises `.torrent` support: it lists "drop a .torrent" but no drop handler exists
  and the add path is magnet-only. Either ship it (P0 item 6) or correct the docs.
- Streamed video runs at default priority: `webtorrent.mjs:485` calls `file.select()` with no
  priority (0), so the playing file does not outrank concurrent torrents. One-character fix
  (P0 item 3).
- Native mpv is macOS-only: Windows/Linux desktop are download-only (no in-app player), so the "any
  codec, native subs" pitch only holds on Mac. (P2 item 13 proposed porting mpv to Win/Linux; the
  project instead dropped playback there - the browser-codec libmedia fallback was removed; see
  `.github/notes/libmedia-player.md`.)

## Primary sources read

Engine: `webtorrent/webtorrent@3.0.16`, `webtorrent/webtorrent-desktop`, `bittorrent-tracker`.
Clients: `qbittorrent/qBittorrent` (nova3 search, rss autodownloader), `transmission/transmission`
(rpc-spec), `deluge-torrent/deluge`, `arvidn/libtorrent`. Discovery: `Stremio/stremio-addon-sdk`,
`Prowlarr/Prowlarr` (Cardigann), `clement-escolano/parse-torrent-title`, OpenSubtitles REST,
`popcorn-official/popcorn-desktop`. PeerZero code:
`api/hono/src/lib/torrent/{webtorrent.mjs,engine.ts,search.ts,defs.ts,shared.ts}`,
`web/next/src/components/torrents/*`.
