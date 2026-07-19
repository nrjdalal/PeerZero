import { config } from "@/lib/config"

// Formats browsers (and desktop WebViews) reliably decode - container AND likely codecs. Everything
// else (mkv/avi/flv/wmv containers, or HEVC/AC3/E-AC3/DTS tracks) is handed to a native player,
// because a browser plays the video but drops the audio, or nothing at all.
const BROWSER_SAFE = new Set([
  "mp4",
  "m4v",
  "webm",
  "ogv",
  "mov",
  "mp3",
  "m4a",
  "aac",
  "ogg",
  "opus",
  "wav",
  "flac",
])

export function isBrowserSafe(name: string): boolean {
  return BROWSER_SAFE.has(name.slice(name.lastIndexOf(".") + 1).toLowerCase())
}

const MIME: Record<string, string> = {
  mp4: "video/mp4",
  m4v: "video/mp4",
  mov: "video/mp4",
  webm: "video/webm",
  ogv: "video/ogg",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  aac: "audio/aac",
  ogg: "audio/ogg",
  opus: "audio/ogg",
  wav: "audio/wav",
  flac: "audio/flac",
}

// The stream carries no file extension, so give the player an explicit MIME to pick its provider.
export function mimeFor(name: string): string {
  return MIME[name.slice(name.lastIndexOf(".") + 1).toLowerCase()] ?? "video/mp4"
}

// The API's Range-capable byte stream for a torrent file, by its position in `torrent.files`.
// Absolute origin (not a relative /api path): the browser already talks to the API cross-origin,
// and a plain <video src> needs no credentials/CORS. The route bypasses the JSON envelope.
export function streamUrl(infoHash: string, fileIndex: number): string {
  return `${config.api.url}/api/torrents/${infoHash}/stream/${fileIndex}`
}

// In the desktop (Tauri) app, hand the stream to a native media player (VLC), which decodes any
// codec (MKV/HEVC/AC3/DTS) that a browser can't. Returns true when it opened externally; false in a
// plain browser (or on failure), where the caller falls back to the inline <video> player - which
// only plays browser-native codecs (MP4/WebM), fine for previews and dev.
export async function openInExternalPlayer(url: string): Promise<boolean> {
  const isTauri = "__TAURI_INTERNALS__" in window || "isTauri" in window
  if (!isTauri) return false
  try {
    const { openUrl } = await import("@tauri-apps/plugin-opener")
    await openUrl(url, "VLC") // macOS: `open -a VLC <url>`. A configurable player is a fast-follow.
    return true
  } catch {
    return false
  }
}
