"use client"

import { useEffect } from "react"

// macOS overlay title bar (see .tauri-mac in globals.css): the traffic-light buttons hide in
// fullscreen, so the brand inset that clears them should drop too - otherwise the logo sits
// pushed-in for no reason. Mirror the window's fullscreen state onto <html> as .tauri-fullscreen;
// the CSS then only insets the brand when NOT fullscreen. No-op in the browser (no Tauri global).
export function TauriFullscreen() {
  useEffect(() => {
    const isTauri = "isTauri" in window || "__TAURI_INTERNALS__" in window
    if (!isTauri) return

    let cancelled = false
    let unlisten: (() => void) | undefined
    void (async () => {
      const { getCurrentWindow } = await import("@tauri-apps/api/window")
      const win = getCurrentWindow()
      const sync = async () => {
        try {
          document.documentElement.classList.toggle("tauri-fullscreen", await win.isFullscreen())
        } catch {
          /* window unavailable (teardown) */
        }
      }
      await sync()
      // Entering/leaving macOS fullscreen resizes the window, so onResized covers the transition.
      const un = await win.onResized(() => void sync())
      if (cancelled) un()
      else unlisten = un
    })()

    return () => {
      cancelled = true
      unlisten?.()
    }
  }, [])

  return null
}
