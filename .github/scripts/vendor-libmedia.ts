import { existsSync } from "node:fs"
import { cp, mkdir, readdir, rm } from "node:fs/promises"
import path from "node:path"

// Vendors libmedia's assets into web/next/public/libmedia so the in-browser player (see
// components/torrents/libmedia-player.tsx) runs fully offline - no CDN - in the packaged desktop build.
// Re-run after bumping @libmedia/avplayer-ui to refresh the vendored copy:
//   bun .github/scripts/vendor-libmedia.ts
//
// It copies the prebuilt ESM player + its code-split chunks from node_modules, and downloads the
// FFmpeg-compiled codec wasm (which the npm package does NOT ship) from the libmedia GitHub dist. Only
// the SIMD variants are fetched: every modern browser and desktop WebView supports WASM SIMD, and
// libmedia falls back to -atomic/baseline only on ancient runtimes we do not target.

const VERSION = "1.3.1"
const CDN = `https://cdn.jsdelivr.net/gh/zhaohappy/libmedia@${VERSION}/dist`

// Decoders the player can be routed (mkv containers, HEVC/AC3/DTS/... tracks). Browser-safe files play
// natively and never reach libmedia. resample is always needed for audio output; stretchpitch is only
// pulled when the user changes playback rate.
const DECODERS = [
  "h264",
  "hevc",
  "av1",
  "aac",
  "ac3",
  "eac3",
  "dca",
  "flac",
  "opus",
  "mp3",
  "vorbis",
]

const scriptDir = path.dirname(Bun.main)
const repoRoot = path.resolve(scriptDir, "../..")
const webNext = path.join(repoRoot, "web/next")
const out = path.join(webNext, "public/libmedia")

// dist/esm isn't in the package's exports map, so resolve via the on-disk path (a bun symlink into
// node_modules/.bun) rather than Bun.resolveSync.
const esmSrc = path.join(webNext, "node_modules/@libmedia/avplayer-ui/dist/esm")
if (!existsSync(esmSrc)) {
  console.error(`vendor-libmedia: ${esmSrc} not found - run \`bun i\` first`)
  process.exit(1)
}

await rm(out, { recursive: true, force: true })
for (const dir of ["esm", "decode", "resample", "stretchpitch"]) {
  await mkdir(path.join(out, dir), { recursive: true })
}

// 1) ESM player + its numbered code-split chunks (and the workers reference them by relative path).
let esmCount = 0
for (const f of await readdir(esmSrc)) {
  if (f.endsWith(".js")) {
    await cp(path.join(esmSrc, f), path.join(out, "esm", f))
    esmCount++
  }
}
console.log(`vendor-libmedia: copied ${esmCount} ESM files from ${esmSrc}`)

// 2) codec wasm (not in the npm package) from the libmedia GitHub dist.
async function download(rel: string) {
  const res = await fetch(`${CDN}/${rel}`)
  if (!res.ok) throw new Error(`${rel}: HTTP ${res.status}`)
  await Bun.write(path.join(out, rel), await res.arrayBuffer())
  console.log(`vendor-libmedia: ${rel}`)
}

for (const c of DECODERS) await download(`decode/${c}-simd.wasm`)
await download("resample/resample-simd.wasm")
await download("stretchpitch/stretchpitch-simd.wasm")

if (!existsSync(path.join(out, "esm/avplayer.js"))) {
  console.error("vendor-libmedia: missing esm/avplayer.js after copy")
  process.exit(1)
}
console.log("vendor-libmedia: done")
