"use client"

import { useRouter } from "next/navigation"
import { useEffect, useRef } from "react"

import { usePrefs } from "@/lib/prefs-store"

// Direct keyboard navigation between views: press `g` then `t` (Transfers) or `s` (Search, only
// when the advanced Search feature is enabled). The "go to" sequence Linear/GitHub/Gmail use -
// reliable in a browser and the Tauri webview, unlike Ctrl+Tab which the browser swallows. Ignored
// while typing. ⌘K exposes the same jumps for discovery.
export function GlobalShortcuts() {
  const router = useRouter()
  const enableSearch = usePrefs((s) => s.enableSearch)
  const armed = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const disarm = () => {
      armed.current = false
      if (timer.current) clearTimeout(timer.current)
    }
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable))
        return
      // The native mpv player is an immersive surface (it sets .mpv-active on <html>). Don't let the
      // g-then-t/s nav fire while it's open - a stray key would navigate away and tear the player down
      // mid-playback. The ⌘K palette (a separate listener) intentionally still works.
      if (document.documentElement.classList.contains("mpv-active")) return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const k = e.key.toLowerCase()
      if (armed.current) {
        disarm()
        const dest = k === "t" ? "/" : k === "s" && enableSearch ? "/search" : null
        if (dest) {
          e.preventDefault()
          router.push(dest)
        }
        return
      }
      if (k === "g") {
        armed.current = true
        timer.current = setTimeout(disarm, 1200)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => {
      window.removeEventListener("keydown", onKey)
      disarm()
    }
  }, [router, enableSearch])

  return null
}
