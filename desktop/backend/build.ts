// Compile the combined desktop backend (the Hono API, which now embeds the WebTorrent engine
// in-process) into one self-contained Bun executable, shipped as the Tauri sidecar. The Hono
// bundle already had the WebRTC stub applied at build time (api/hono/scripts/build-bundle.mjs),
// so node_datachannel is inert in it; the same plugin is re-applied here as a safety net because
// `bun build --compile` ignores the bunfig preload.
//
// Prereq: the Hono bundle must exist (bunx turbo run build --filter=@api/hono), since
// main.ts imports api/hono/bundle/index.mjs.
//
// Usage: bun desktop/backend/build.ts [outfile] [target]   (run from the repo root)
//   outfile: output path (default desktop/dist/peerzero-backend)
//   target:  optional Bun cross-compile target for CI, e.g. bun-linux-x64,
//            bun-windows-x64, bun-darwin-arm64, bun-darwin-x64. Omit to build native.
import { webrtcStubPlugin } from "../../api/hono/src/lib/torrent/webrtc-stub-plugin.mjs"

const outfile = process.argv[2] || "desktop/dist/peerzero-backend"
const target = process.argv[3] || process.env.PZ_BUILD_TARGET

const result = await Bun.build({
  entrypoints: ["desktop/backend/main.ts"],
  target: "bun",
  plugins: [webrtcStubPlugin],
  compile: target ? { outfile, target } : { outfile },
})

if (!result.success) {
  for (const log of result.logs) console.error(log)
  process.exit(1)
}

console.log(`compiled desktop backend -> ${outfile}`)
