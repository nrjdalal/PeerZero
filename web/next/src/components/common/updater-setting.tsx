"use client"

import { RiDownloadLine, RiRefreshLine } from "@remixicon/react"
import { useEffect, useState } from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Field, FieldContent, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Spinner } from "@/components/ui/spinner"

// Minimal shape of the updater plugin's Update handle (avoids importing the type eagerly).
type UpdateHandle = { version: string }

type Status = "idle" | "checking" | "uptodate" | "available" | "installing"

// Desktop-only manual update control for Settings > Advanced. It mirrors the corner UpdateNotice
// badge, but is user-driven: it shows the running version and a "Check for updates" button; when the
// Tauri updater reports a newer signed release (endpoint + pubkey in tauri.conf.json) the button
// turns into "Update & restart", which runs the whole download + install + relaunch in Rust
// (install_update) - replacing the .app kills the webview, so the relaunch can't be driven from JS.
// In a plain browser (no Tauri) the button is inert with a hint, since updates only apply to the
// installed app.
export function UpdaterSetting() {
  const [desktop, setDesktop] = useState(false)
  const [version, setVersion] = useState<string | null>(null)
  const [next, setNext] = useState<string | null>(null)
  const [status, setStatus] = useState<Status>("idle")

  // Resolve desktop + running version after mount (never during render) so the static export does
  // not hydrate-mismatch on the window/Tauri globals.
  useEffect(() => {
    const isTauri = "isTauri" in window || "__TAURI_INTERNALS__" in window
    setDesktop(isTauri)
    if (!isTauri) return
    let cancelled = false
    import("@tauri-apps/api/app")
      .then(({ getVersion }) => getVersion())
      .then((v) => {
        if (!cancelled) setVersion(v)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  const checkNow = async () => {
    setStatus("checking")
    try {
      const { check } = await import("@tauri-apps/plugin-updater")
      const found = (await check()) as unknown as UpdateHandle | null
      if (found) {
        setNext(found.version)
        setStatus("available")
      } else {
        setStatus("uptodate")
      }
    } catch (e) {
      setStatus("idle")
      toast.error(e instanceof Error ? e.message : "Could not check for updates")
    }
  }

  const install = async () => {
    setStatus("installing")
    try {
      const { invoke } = await import("@tauri-apps/api/core")
      // The whole download + install + relaunch runs in Rust (install_update). It has to: replacing
      // the .app bundle kills the webview, so no JS runs after the swap. This invoke typically never
      // resolves (the app relaunches out from under it), which is expected.
      await invoke("install_update")
    } catch (e) {
      setStatus("available")
      toast.error(e instanceof Error ? e.message : "Could not install the update")
    }
  }

  const description = !desktop
    ? "Updates are delivered through the desktop app."
    : status === "checking"
      ? "Checking for updates…"
      : status === "installing"
        ? "Downloading and installing the update…"
        : status === "available"
          ? `Version ${next} is available.`
          : status === "uptodate"
            ? `You're on the latest version${version ? ` (v${version})` : ""}.`
            : version
              ? `You're running v${version}.`
              : "See whether a newer version is available."

  return (
    <Field orientation="horizontal">
      <FieldContent>
        <FieldLabel>Software update</FieldLabel>
        <FieldDescription>{description}</FieldDescription>
      </FieldContent>
      {status === "available" || status === "installing" ? (
        <Button onClick={install} disabled={status === "installing"}>
          {status === "installing" ? <Spinner /> : <RiDownloadLine />}
          {status === "installing" ? "Updating…" : "Update & restart"}
        </Button>
      ) : (
        <Button variant="outline" onClick={checkNow} disabled={!desktop || status === "checking"}>
          {status === "checking" ? <Spinner /> : <RiRefreshLine />}
          Check for updates
        </Button>
      )}
    </Field>
  )
}
