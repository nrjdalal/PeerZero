"use client"

import { RiCheckLine, RiDownloadLine, RiExternalLinkLine, RiRefreshLine } from "@remixicon/react"
import { useEffect, useState } from "react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { type Channel, useReleases } from "@/lib/use-releases"
import { cn } from "@/lib/utils"

// Paired light/dark badge colors, per the STATUS_BADGE convention in torrents-grid.tsx.
const CANARY_BADGE =
  "border-current bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300"
const CURRENT_BADGE =
  "border-current bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-300"

function fmtDate(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })
}

// Desktop-only "Software update" control for Settings > Advanced. Lists published releases (stable +
// canary) from GitHub and lets you install ANY of them - forward or back - via the Rust
// install_release command, which points the updater at that release's own manifest and bypasses the
// newer-only gate. The running version is marked "Current". A release on the OTHER channel can't be
// swapped in place (its .app bundle name differs), so it links out to its release page instead. In a
// plain browser (no Tauri) this collapses to a one-line hint.
export function UpdaterSetting() {
  const [desktop, setDesktop] = useState(false)
  const [version, setVersion] = useState<string | null>(null)
  const [installing, setInstalling] = useState<string | null>(null)

  // Resolve desktop + running version after mount (never during render) so the static export does not
  // hydrate-mismatch on the window/Tauri globals.
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

  const { data: releases, isLoading, isError, refetch, isFetching } = useReleases(desktop)

  // The running build's channel, inferred from its version (canary versions carry a prerelease
  // suffix, e.g. "0.0.23-142"). Decides which rows update in place vs link out.
  const currentChannel: Channel = version?.includes("-") ? "canary" : "stable"

  const install = async (tag: string) => {
    if (installing) return
    setInstalling(tag)
    try {
      const { invoke } = await import("@tauri-apps/api/core")
      // Download + install + relaunch run in Rust (install_release); this invoke usually never
      // resolves because the app relaunches out from under it. That is expected.
      await invoke("install_release", { tag })
    } catch (e) {
      setInstalling(null)
      toast.error(e instanceof Error ? e.message : "Could not install that version")
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex flex-col gap-0.5">
          <span className="text-sm font-medium">Software update</span>
          <span className="text-muted-foreground text-sm">
            {desktop
              ? version
                ? `You're running v${version}. Install any version below.`
                : "Install any version below."
              : "Updates are delivered through the desktop app."}
          </span>
        </div>
        {desktop && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            disabled={isFetching}
            aria-label="Refresh releases"
          >
            {isFetching ? <Spinner /> : <RiRefreshLine />}
          </Button>
        )}
      </div>

      {desktop && (
        <div className="overflow-hidden rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Version</TableHead>
                <TableHead>Released</TableHead>
                <TableHead className="text-right" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow>
                  <TableCell colSpan={3} className="text-center">
                    <Spinner className="mx-auto" />
                  </TableCell>
                </TableRow>
              )}
              {isError && (
                <TableRow>
                  <TableCell colSpan={3} className="text-muted-foreground text-center">
                    Couldn&apos;t load releases.
                  </TableCell>
                </TableRow>
              )}
              {releases?.length === 0 && (
                <TableRow>
                  <TableCell colSpan={3} className="text-muted-foreground text-center">
                    No releases available.
                  </TableCell>
                </TableRow>
              )}
              {releases?.map((r) => {
                const isCurrent = version != null && r.version === version
                const sameChannel = r.channel === currentChannel
                return (
                  <TableRow key={r.tag}>
                    <TableCell className="font-medium tabular-nums">
                      <span className="flex items-center gap-2">
                        v{r.version}
                        {r.channel === "canary" && (
                          <Badge className={cn("border-[0.5px] font-normal", CANARY_BADGE)}>
                            canary
                          </Badge>
                        )}
                      </span>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {fmtDate(r.publishedAt)}
                    </TableCell>
                    <TableCell className="text-right">
                      {isCurrent ? (
                        <Badge className={cn("border-[0.5px] font-normal", CURRENT_BADGE)}>
                          <RiCheckLine />
                          Current
                        </Badge>
                      ) : sameChannel ? (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => install(r.tag)}
                          disabled={installing != null}
                        >
                          {installing === r.tag ? <Spinner /> : <RiDownloadLine />}
                          {installing === r.tag ? "Installing…" : "Install"}
                        </Button>
                      ) : (
                        <Button
                          variant="ghost"
                          size="sm"
                          render={<a href={r.url} target="_blank" rel="noreferrer" />}
                        >
                          <RiExternalLinkLine />
                          Get
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
