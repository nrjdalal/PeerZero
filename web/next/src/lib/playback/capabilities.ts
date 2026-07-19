// Hardware/engine capability detection: probe what THIS runtime (browser engine + GPU) can actually
// decode, so playback routes each file to the best available path instead of guessing. "Best" is the
// cheapest path that works:
//
//   native   - a plain <video> element decodes it (free hardware + native controls, zero overhead).
//   libmedia - an in-browser WASM/WebCodecs player (@libmedia). It uses the hardware WebCodecs decoder
//              when the probe says the codec is available (e.g. HEVC in a macOS WebView), and falls
//              back to its own FFmpeg-compiled WASM for what the browser can't (AC3/E-AC3/DTS, or HEVC
//              where there's no hardware decoder). So libmedia itself is "use what's best" for decode.
//   handoff  - hand the stream to a native player (VLC/mpv) on desktop. The escape hatch for content a
//              software WASM decode would stutter on (large 4K), or codecs nothing above covers.
//
// The probe is async (WebCodecs isConfigSupported is async) and memoized: it reflects the machine, not
// the file, so it only needs to run once per session. See the design skill "Media player".

export type PlaybackStrategy = "native" | "libmedia" | "handoff"

export interface Capabilities {
  /** Inside the Tauri desktop shell, so the native-player handoff is available. */
  tauri: boolean
  /** WebCodecs VideoDecoder (hardware/native decode) per codec. */
  video: { hevc: boolean; h264: boolean; av1: boolean; vp9: boolean }
  /** WebCodecs AudioDecoder per codec. AC3/E-AC3/DTS are never here (no browser ships them). */
  audio: { aac: boolean; opus: boolean; flac: boolean }
  /** A native <video> element can direct-play these (no decoder wiring needed). */
  native: { mp4: boolean; webm: boolean; hevcInMp4: boolean }
}

// Representative codec strings for isConfigSupported. Kept narrow on purpose: a "can you decode HEVC
// Main/Main10 at a common level" probe generalises to real files well enough to route on.
const VIDEO_PROBE = {
  hevc: "hvc1.1.6.L93.B0",
  h264: "avc1.42E01E",
  av1: "av01.0.05M.08",
  vp9: "vp09.00.10.08",
} as const

const AUDIO_PROBE = { aac: "mp4a.40.2", opus: "opus", flac: "flac" } as const

async function canDecodeVideo(codec: string): Promise<boolean> {
  if (typeof VideoDecoder === "undefined") return false
  try {
    const { supported } = await VideoDecoder.isConfigSupported({ codec })
    return supported === true
  } catch {
    return false
  }
}

async function canDecodeAudio(codec: string): Promise<boolean> {
  if (typeof AudioDecoder === "undefined") return false
  try {
    const { supported } = await AudioDecoder.isConfigSupported({
      codec,
      sampleRate: 48000,
      numberOfChannels: 2,
    })
    return supported === true
  } catch {
    return false
  }
}

function canPlayNative(type: string): boolean {
  if (typeof document === "undefined") return false
  return document.createElement("video").canPlayType(type) !== ""
}

function isTauri(): boolean {
  return typeof window !== "undefined" && ("__TAURI_INTERNALS__" in window || "isTauri" in window)
}

let cached: Promise<Capabilities> | null = null

// Run the probes once and memoize. Safe to call from many components; they share the one result.
export function detectCapabilities(): Promise<Capabilities> {
  if (cached) return cached
  cached = (async () => {
    const [hevc, h264, av1, vp9, aac, opus, flac] = await Promise.all([
      canDecodeVideo(VIDEO_PROBE.hevc),
      canDecodeVideo(VIDEO_PROBE.h264),
      canDecodeVideo(VIDEO_PROBE.av1),
      canDecodeVideo(VIDEO_PROBE.vp9),
      canDecodeAudio(AUDIO_PROBE.aac),
      canDecodeAudio(AUDIO_PROBE.opus),
      canDecodeAudio(AUDIO_PROBE.flac),
    ])
    return {
      tauri: isTauri(),
      video: { hevc, h264, av1, vp9 },
      audio: { aac, opus, flac },
      native: {
        mp4: canPlayNative('video/mp4; codecs="avc1.42E01E, mp4a.40.2"'),
        webm: canPlayNative('video/webm; codecs="vp9, opus"'),
        hevcInMp4: canPlayNative('video/mp4; codecs="hvc1.1.6.L93.B0"'),
      },
    }
  })()
  return cached
}
