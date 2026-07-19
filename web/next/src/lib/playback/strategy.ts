import { isBrowserSafe } from "@/lib/play-file"

import type { Capabilities, PlaybackStrategy } from "./capabilities"

// Filename hints for the video codec: the engine snapshot carries no media metadata, so this is the
// only signal we have before a player opens the container. Coarse but enough to route on - libmedia
// re-derives the real codec from the stream once it loads, and the runtime falls back on error anyway.
function hintsHevc(name: string): boolean {
  return /(^|[^a-z])(hevc|h\.?265|x265)([^a-z]|$)/i.test(name)
}

// Route a single file to the best available playback path for THIS machine. See capabilities.ts for
// what "best" means and why the ladder is ordered native > libmedia > handoff.
export function pickStrategy(name: string, caps: Capabilities): PlaybackStrategy {
  // Easy set: a container + codec a plain <video> decodes. Free hardware, native controls, zero cost.
  if (isBrowserSafe(name) && (caps.native.mp4 || caps.native.webm)) return "native"

  // Hard set (mkv/avi/ts containers, or HEVC/AC3/DTS tracks). libmedia plays all of it: hardware
  // WebCodecs when the probe shows the video codec is decodable, else its own FFmpeg WASM.
  //
  // But if this machine has no hardware decode for the file's video, libmedia would run pure-software
  // WASM, which can stutter on HD/4K. On desktop we have a better option in that case: hand the stream
  // to a native player, which reaches the OS decoders. In a plain browser there's no handoff, so
  // libmedia (best effort) is still the answer.
  const noHardwareVideo = hintsHevc(name) ? !caps.video.hevc : !caps.video.h264
  if (caps.tauri && noHardwareVideo) return "handoff"

  return "libmedia"
}
