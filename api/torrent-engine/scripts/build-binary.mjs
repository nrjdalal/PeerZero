// Compile the torrent engine into a single self-contained Bun executable for desktop
// packaging (shipped as a Tauri sidecar). The WebRTC stub is applied here at build time
// because `bun build --compile` does not honor the bunfig `preload`; without it the binary
// bundles the node_datachannel native addon and crashes at boot. uTP stays disabled via
// `{ utp: false }` in the client options, so no native addons end up in the binary.
//
// Usage: bun scripts/build-binary.mjs [outfile]   (run from api/torrent-engine)
import { webrtcStubPlugin } from "../src/webrtc-stub-plugin.mjs"

const outfile = process.argv[2] || "dist/pz-torrent-engine"

const result = await Bun.build({
  entrypoints: ["src/index.mjs"],
  target: "bun",
  plugins: [webrtcStubPlugin],
  compile: { outfile },
})

if (!result.success) {
  for (const log of result.logs) console.error(log)
  process.exit(1)
}

console.log(`compiled torrent engine -> ${outfile}`)
