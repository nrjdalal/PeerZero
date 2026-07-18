// Compile the combined desktop backend (Hono API + WebTorrent engine) into one
// self-contained Bun executable, shipped as the Tauri sidecar. The WebRTC stub is applied
// as a build-time plugin because `bun build --compile` ignores the bunfig preload; without
// it the binary bundles the node_datachannel native addon and crashes at boot.
//
// Prereq: the Hono bundle must exist (bunx turbo run build --filter=@api/hono), since
// main.ts imports api/hono/bundle/index.mjs.
//
// Usage: bun desktop/backend/build.ts [outfile]   (run from the repo root)
import { webrtcStubPlugin } from "../../api/torrent-engine/src/webrtc-stub-plugin.mjs"

const outfile = process.argv[2] || "desktop/dist/peerzero-backend"

const result = await Bun.build({
  entrypoints: ["desktop/backend/main.ts"],
  target: "bun",
  plugins: [webrtcStubPlugin],
  compile: { outfile },
})

if (!result.success) {
  for (const log of result.logs) console.error(log)
  process.exit(1)
}

console.log(`compiled desktop backend -> ${outfile}`)
