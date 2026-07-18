// Bun preload: register the shared WebRTC stub plugin so webtorrent runs under Bun.
//
// Preloaded via bunfig.toml for every `bun` invocation in this package (dev, start, or a
// bare `bun src/index.mjs`). The compiled-binary build applies the same plugin explicitly
// through Bun.build (scripts/build-binary.mjs), because `bun build --compile` does not run
// bunfig preload. See webrtc-stub-plugin.mjs for the full rationale.
import { plugin } from "bun"

import { webrtcStubPlugin } from "./webrtc-stub-plugin.mjs"

plugin(webrtcStubPlugin)
