"use client"

import { RiDownloadLine } from "@remixicon/react"
import { useEffect, useState } from "react"

import { Badge } from "@/components/ui/badge"
import { Spinner } from "@/components/ui/spinner"

// Minimal shape of the updater plugin's Update handle (avoids importing the type eagerly).
type UpdateHandle = { version: string; downloadAndInstall: () => Promise<void> }

// Desktop-only. On launch it asks the Tauri updater whether a newer signed release exists
// (endpoint + pubkey live in tauri.conf.json). If so, a small yellow badge in the corner
// offers to install it; clicking downloads, swaps in the new version, and relaunches. No-op
// in the browser.
export function UpdateNotice() {
  const [update, setUpdate] = useState<UpdateHandle | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const isTauri = "isTauri" in window || "__TAURI_INTERNALS__" in window
    if (!isTauri) return
    let cancelled = false
    import("@tauri-apps/plugin-updater")
      .then(({ check }) => check())
      .then((found) => {
        if (!cancelled && found) setUpdate(found as unknown as UpdateHandle)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  if (!update) return null

  const install = async () => {
    if (busy) return // guard re-clicks without disabling (which would fade the badge out)
    setBusy(true)
    try {
      await update.downloadAndInstall()
      const { relaunch } = await import("@tauri-apps/plugin-process")
      await relaunch()
    } catch {
      setBusy(false)
    }
  }

  // A status-badge-style pill (see torrents-grid) in yellow, made clickable.
  return (
    <Badge
      render={<button type="button" onClick={install} />}
      title={`Update to v${update.version}`}
      className="fixed right-4 bottom-4 z-50 cursor-pointer border-current bg-rose-50 text-rose-700 shadow-sm hover:bg-rose-100 dark:bg-rose-950 dark:text-rose-300 dark:hover:bg-rose-900"
    >
      {busy ? <Spinner /> : <RiDownloadLine />}
      {busy ? "Updating..." : `Update v${update.version}`}
    </Badge>
  )
}
