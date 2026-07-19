"use client"

import { useEffect } from "react"

// In the desktop app an <a target="_blank"> to an external site does nothing in the
// webview. Route external http(s) links to the system browser via the opener plugin
// (needs the opener:allow-default-urls capability). No-op in the browser (no Tauri
// global), where the anchors already work natively.
export function TauriExternalLinks() {
  useEffect(() => {
    const isTauri = "isTauri" in window || "__TAURI_INTERNALS__" in window
    if (!isTauri) return

    const onClick = (e: MouseEvent) => {
      // The social anchors sit inside a base-ui tooltip trigger that preventDefaults the
      // click, so intentionally do NOT bail on e.defaultPrevented here.
      if (e.button !== 0 || e.metaKey || e.ctrlKey) return
      const anchor = (e.target as HTMLElement | null)?.closest?.(
        "a[href]",
      ) as HTMLAnchorElement | null
      if (!anchor) return
      const href = anchor.getAttribute("href") ?? ""
      // Only external http(s) links; internal Next routes are relative and handled normally.
      if (!/^https?:\/\//i.test(href)) return
      e.preventDefault()
      void import("@tauri-apps/plugin-opener").then(({ openUrl }) => openUrl(href)).catch(() => {})
    }

    document.addEventListener("click", onClick)
    return () => document.removeEventListener("click", onClick)
  }, [])

  return null
}
