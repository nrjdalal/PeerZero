import { config } from "@/lib/config"

// The API's Range-capable byte stream for a torrent file, by its position in `torrent.files`.
// Absolute origin (not a relative /api path): the browser talks to the API cross-origin, and the
// player fetches it directly. The route bypasses the JSON envelope.
export function streamUrl(infoHash: string, fileIndex: number): string {
  return `${config.api.url}/api/torrents/${infoHash}/stream/${fileIndex}`
}

// In the desktop (Tauri) app, hand the stream to a native media player (VLC) - the fallback when the
// in-browser player can't load/decode a file. Returns true when it opened externally; false in a plain
// browser (or on failure), where the caller shows a toast instead.
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
