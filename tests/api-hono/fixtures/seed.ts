// Seed the completed-torrent fixture in a SEPARATE process (run by run.ts with an isolated HOME +
// TORRENT_DOWNLOAD_DIR), BEFORE the engine boots, so the engine's restore-on-boot re-adds it and
// verifies the on-disk pieces -> the torrent comes up ready + done with no network.
//
// Why a separate process + CLI env: Bun caches os.homedir() at process start, so a JS-set
// process.env.HOME is ignored; the engine's ~/.peerzero state dir can only be isolated by starting
// the process with HOME already set (run.ts does this). See tests/README.md.
import { mkdirSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join, resolve } from "node:path"

import WebTorrent from "webtorrent"

import { FIXTURE_ADDED_AT, FIXTURE_NAME, fixtureContent } from "./constants.ts"

const dl = process.env.TORRENT_DOWNLOAD_DIR
if (!dl) throw new Error("seed fixture requires TORRENT_DOWNLOAD_DIR (run via run.ts)")
const content = fixtureContent()

const client = new WebTorrent({ utp: false })
const seeded: any = await new Promise((res, rej) => {
  client.on("error", rej)
  client.seed(content, { name: FIXTURE_NAME }, res)
})

// Lay the bytes on disk where the engine will look (downloadDir/<name>) so verification passes.
mkdirSync(dl, { recursive: true })
writeFileSync(join(dl, FIXTURE_NAME), content)

// Persist state so restore-on-boot re-adds it. The base64 .torrent makes it instantly ready +
// peerless (no metadata fetch); progress: 1 marks it complete before verification confirms it.
const stateDir = resolve(homedir(), ".peerzero")
mkdirSync(stateDir, { recursive: true })
writeFileSync(
  join(stateDir, "state.json"),
  `${JSON.stringify(
    {
      settings: { downloadDir: dl },
      torrents: [
        {
          infoHash: seeded.infoHash,
          magnetURI: seeded.magnetURI,
          torrentFile: Buffer.from(seeded.torrentFile).toString("base64"),
          name: FIXTURE_NAME,
          path: dl,
          paused: false,
          addedAt: FIXTURE_ADDED_AT,
          length: content.length,
          downloaded: content.length,
          progress: 1,
        },
      ],
    },
    null,
    2,
  )}\n`,
)
console.log(`[seed] ${seeded.infoHash} -> ${stateDir}/state.json (dl ${dl})`)
await new Promise<void>((res) => client.destroy(() => res()))
