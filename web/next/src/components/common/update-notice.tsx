"use client"

import { RiCheckLine, RiDownloadLine } from "@remixicon/react"
import { useEffect, useState } from "react"

import { Badge } from "@/components/ui/badge"
import { Spinner } from "@/components/ui/spinner"

// Minimal shape of the updater plugin's Update handle (avoids importing the type eagerly).
type UpdateHandle = { version: string; downloadAndInstall: () => Promise<void> }

// Desktop-only. On launch it asks the Tauri updater whether a newer signed release exists
// (endpoint + pubkey live in tauri.conf.json). If one does, a clickable rose badge in the corner
// offers to install it (downloads, swaps in the new version, relaunches). If the app is up to date,
// a blue badge shows the running version instead. No-op in the browser.
export function UpdateNotice() {
  const [update, setUpdate] = useState<UpdateHandle | null>(null)
  const [version, setVersion] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const isTauri = "isTauri" in window || "__TAURI_INTERNALS__" in window
    if (!isTauri) return
    let cancelled = false
    // Running version, shown in the up-to-date badge.
    import("@tauri-apps/api/app")
      .then(({ getVersion }) => getVersion())
      .then((v) => {
        if (!cancelled) setVersion(v)
      })
      .catch(() => {})
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

  const install = async () => {
    if (busy) return // guard re-clicks without disabling (which would fade the badge out)
    setBusy(true)
    try {
      const { invoke } = await import("@tauri-apps/api/core")
      // The whole download + install + relaunch runs in Rust (install_update). It has to: replacing
      // the .app bundle kills WKWebView's WebContent process, so no JS runs after the swap - the
      // relaunch can't be driven from here. This invoke typically never resolves (the app relaunches
      // out from under it), which is expected.
      await invoke("install_update")
    } catch {
      setBusy(false)
    }
  }

  // Update available: a clickable rose pill to install it (status-badge style, see torrents-grid).
  if (update) {
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

  // Up to date: a blue badge with the running version. Nothing to install, so not clickable.
  if (version) {
    return (
      <Badge
        title="Up to date"
        className="fixed right-4 bottom-4 z-50 border-current bg-blue-50 text-blue-700 shadow-sm dark:bg-blue-950 dark:text-blue-300"
      >
        <RiCheckLine />v{version}
      </Badge>
    )
  }

  return null
}
