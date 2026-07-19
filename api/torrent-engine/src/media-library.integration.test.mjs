// Offline integration test: prove the media-library functions consume webtorrent's *real* object
// shapes (t.name, t.files[].path, t.path) correctly and produce a working hardlink. It seeds a
// local file - no network, no peers - so webtorrent builds a genuine torrent whose file paths
// resolve exactly as linkToLibrary relies on (resolve(t.path, file.path) === the real file).
//
// The engine's bunfig.toml preloads the WebRTC stub for every `bun` invocation in this package, so
// importing webtorrent here never loads the node-datachannel native addon.

import { afterAll, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

import WebTorrent from "webtorrent"

import { hardlinkTargets, libraryTargets } from "./media-library.mjs"

// Offline client: no DHT/tracker/LSD/uTP, so seed() just hashes the file and returns a ready,
// done torrent object without touching the network.
const client = new WebTorrent({ utp: false, dht: false, tracker: false, lsd: false })

afterAll(() => client.destroy())

test("real webtorrent object -> libraryTargets -> hardlink into the library", async () => {
  const base = mkdtempSync(join(tmpdir(), "pz-int-base-"))
  const libRoot = mkdtempSync(join(tmpdir(), "pz-int-lib-"))
  try {
    // A realistic movie release: a named folder holding one video file.
    const releaseDir = "The.Matrix.1999.1080p.BluRay.x264-GRP"
    const fileName = `${releaseDir}.mkv`
    mkdirSync(join(base, releaseDir), { recursive: true })
    const realFile = join(base, releaseDir, fileName)
    writeFileSync(realFile, "pretend-video-bytes")

    const torrent = await new Promise((res, rej) => {
      const timer = setTimeout(() => rej(new Error("seed timed out")), 15_000)
      client.seed(join(base, releaseDir), { announce: [] }, (t) => {
        clearTimeout(timer)
        res(t)
      })
    })

    // The invariant linkToLibrary depends on: the source path is resolve(t.path, file.path).
    const files = torrent.files.map((f) => ({ name: f.name, path: f.path }))
    for (const f of files) {
      expect(resolve(torrent.path, f.path)).toBe(realFile)
    }

    const targets = libraryTargets(torrent.name, files)
    expect(targets).toEqual([
      {
        srcRel: files[0].path,
        destRel: join("Movies", "The Matrix (1999)", "The Matrix (1999) - 1080p BluRay x264.mkv"),
      },
    ])

    const linked = hardlinkTargets(resolve(torrent.path), libRoot, targets)
    expect(linked).toBe(1)

    const dest = join(
      libRoot,
      "Movies",
      "The Matrix (1999)",
      "The Matrix (1999) - 1080p BluRay x264.mkv",
    )
    expect(statSync(dest).ino).toBe(statSync(realFile).ino) // same inode == a real hardlink
  } finally {
    rmSync(base, { recursive: true, force: true })
    rmSync(libRoot, { recursive: true, force: true })
  }
}, 20_000)
