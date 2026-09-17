# tests

Central test tree for the app. It mirrors the package layout: `tests/api-hono` covers `api/hono`,
`tests/web-next` covers `web/next`, and so on. Tests live here rather than colocated in each
package's `src`, so all suites are in one place.

Run everything from the repo root:

```bash
bun run test          # turbo builds deps, then runs every suite here
```

## api-hono (golden suite)

`tests/api-hono/app.golden.test.ts` drives the real `@api/hono` backend and its in-process
WebTorrent engine through `server.fetch` - the same request path the UI takes - and covers every
reachable route and behavior: health, sources, settings, the torrent lifecycle (add/pause/resume/
delete + dedup + validation), the error envelopes, and the full `/stream` Range surface
(200 / 206 / suffix / 416 / HEAD / 404 + exact bytes).

### The golden "way"

A **golden file** (`tests/api-hono/golden/*.json` and `*.bin`) is the committed, canonical
serialization of a response. The suite asserts every run reproduces it exactly. Volatile fields
(build version, temp paths, magnet tracker lists, timestamps, network stats) are normalized to
tokens like `<version>` / `<downloadDir>` before matching, so a golden only changes when the
contract does.

```bash
UPDATE_GOLDEN=1 bun tests/api-hono/run.ts   # regenerate goldens after an intended change
bun tests/api-hono/run.ts                    # verify against committed goldens
```

Review the golden diff like any other change: an unexpected diff is a caught regression.

### How it runs (fixtures + isolation)

`run.ts` is the entry point. It:

1. makes an **isolated** `HOME` + download dir, so the suite never touches the real
   `~/.peerzero` state or `~/Downloads/PeerZero`;
2. runs `fixtures/seed.ts` in a **separate process** to seed a deterministic **completed** torrent
   into them (writes the bytes to disk + a `state.json`), so the engine's restore-on-boot brings it
   up `ready + done` with no network - this is what backs the `/stream` cases;
3. runs `bun test` with that isolated environment;
4. cleans up.

Two things forced this shape, both worth knowing:

- **`os.homedir()` is cached at process start under Bun.** A JS-set `process.env.HOME` is ignored,
  so the engine's `~/.peerzero` dir can only be isolated by starting the process with `HOME`
  already set (which `run.ts` does when it spawns the children). A test that sets `process.env.HOME`
  in its own body is silently running against the real home.
- **The engine boots once, at import**, and reads its state then - so the fixture has to exist
  before the first `import("@/index")`, which is why it is seeded in a prior process.

The `/stream` goldens guard the Bun streaming fix from #51 (`Readable.toWeb` throws under Bun, so
the engine hands the Node stream to `new Response(...)` directly): that fix shipped with only a
manual check, and this suite is its automated regression coverage.

## web-next (unit suite)

`tests/web-next/mpv-tracks.test.ts` unit-tests the native mpv player's pure logic
(`web/next/src/lib/mpv-tracks.ts`): the subtitle default-pick preference order (CC > SDH > Default >
Forced, English-only, never forcing a foreign sub) and the seconds-based time formatting.
`tests/web-next/pip-geometry.test.ts` covers the picture-in-picture placement math
(`web/next/src/lib/pip-geometry.ts`): the bottom-right corner of the work area, shrinking on a small
screen, and that `MAIN_MIN_SIZE` still mirrors the window's `min_inner_size` in `lib.rs`. Both
modules are dependency-free by design, so the suites import them by relative path and need no
fixture, engine, or bunfig - they run headless and fast.

```bash
bun test web-next            # from tests/ (or the whole tree via `bun run test` at the repo root)
```

### Coverage boundary

The player's other half - the libmpv OpenGL render layer and live playback - needs a GPU, a real
window, bundled libmpv, and a video file, so it cannot run in headless CI. It is verified manually:
launch the packaged app, play a file, and confirm the video renders sharp (retina), play/pause
toggles, controls auto-hide while playing and return on hover, and subtitles/speed/seek/fullscreen
work. For picture-in-picture, press `P`: the window floats as a 480x270 mini player in the
bottom-right corner with the video filling it edge to edge (no letterbox bars on a 16:9 file), a
double-click on it does not zoom it, and `P` again or Esc returns the window to its exact previous
frame. `P` from fullscreen leaves fullscreen first, and exiting PiP then returns to the windowed
frame, not to fullscreen.
