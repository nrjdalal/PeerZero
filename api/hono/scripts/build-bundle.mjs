// Bundle the Hono API (already type-built into dist/ by tsdown) into a single Bun-target file at
// bundle/index.mjs, applying the WebRTC stub plugin so the in-process webtorrent engine never
// bundles the node-datachannel native addon (which crashes Bun). The plain `bun build` CLI can't
// apply a plugin, so this replaces it. Mirrors desktop/backend/build.ts. Run from api/hono.
import { webrtcStubPlugin } from "../src/lib/torrent/webrtc-stub-plugin.mjs"

const result = await Bun.build({
  entrypoints: ["dist/index.mjs"],
  outdir: "bundle",
  naming: "[name].mjs",
  target: "bun",
  minify: true,
  plugins: [webrtcStubPlugin],
})

if (!result.success) {
  for (const log of result.logs) console.error(log)
  process.exit(1)
}

console.log("bundled api/hono -> bundle/index.mjs")
