"use client"

import { RiExternalLinkFill, RiListCheck2 } from "@remixicon/react"
import { useQuery } from "@tanstack/react-query"
import { useState } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Spinner } from "@/components/ui/spinner"
import { apiClient, unwrap } from "@/lib/api/client"

function relativeTime(iso: string | null): string {
  if (!iso) return "never"
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.round(diff / 60000)
  if (mins < 1) return "just now"
  if (mins < 60) return `${mins}m ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

// Surfaces the active providers plus the auto-synced directory. Read-only.
export function SourcesDialog() {
  const [open, setOpen] = useState(false)

  const { data, isLoading } = useQuery({
    queryKey: ["torrent-sources"],
    enabled: open,
    queryFn: async () => {
      const { data, error } = await unwrap(apiClient.torrents.sources.$get())
      if (error) throw new Error(error.message)
      return data
    },
  })

  type Entry = NonNullable<typeof data>["directory"]["entries"][number]
  const grouped = (data?.directory.entries ?? []).reduce<Record<string, Entry[]>>((acc, entry) => {
    ;(acc[entry.section] ??= []).push(entry)
    return acc
  }, {})

  type Health = NonNullable<typeof data>["health"][number]
  const healthByName = new Map<string, Health>((data?.health ?? []).map((h) => [h.name, h]))

  // A provider's liveness dot: green up, amber down (failing), red auto-disabled,
  // grey not yet checked. The title carries the detail (results, latency, error).
  function providerDot(name: string): { color: string; title: string } {
    const h = healthByName.get(name)
    if (!h || !h.checkedAt) return { color: "bg-muted-foreground/40", title: "not yet checked" }
    const color = h.disabled
      ? "bg-red-500"
      : h.status === "up"
        ? "bg-emerald-500"
        : h.status === "down"
          ? "bg-amber-500"
          : "bg-muted-foreground/40"
    const state = h.disabled ? "auto-disabled" : h.status
    const detail = [
      state,
      h.lastCount ? `${h.lastCount} results` : null,
      h.latencyMs != null ? `${h.latencyMs}ms` : null,
      h.error ?? null,
    ]
      .filter(Boolean)
      .join(" · ")
    return { color, title: detail }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button variant="ghost" size="sm">
            <RiListCheck2 className="size-4" />
            Sources
          </Button>
        }
      />
      <DialogContent className="max-h-[85svh] gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <DialogHeader className="border-b p-6">
          <DialogTitle>Sources</DialogTitle>
          <DialogDescription>
            Search runs against {data?.providers.length ?? "these"} providers. The directory below
            auto-syncs upstream
            {data ? ` · updated ${relativeTime(data.directory.syncedAt)}` : ""}.
          </DialogDescription>
        </DialogHeader>

        {isLoading || !data ? (
          <div className="flex items-center justify-center p-10">
            <Spinner />
          </div>
        ) : (
          <ScrollArea className="max-h-[60svh]">
            <div className="flex flex-col gap-6 p-6">
              <div className="flex flex-col gap-2">
                <h3 className="text-sm font-semibold">Active search providers</h3>
                <div className="flex flex-wrap gap-2">
                  {data.providers.map((p) => {
                    const dot = providerDot(p.name)
                    return (
                      <Badge key={p.name} variant="secondary" title={dot.title}>
                        <span className={`size-2 shrink-0 rounded-full ${dot.color}`} />
                        {p.name}
                        {p.directoryTracked ? " · directory" : ""}
                      </Badge>
                    )
                  })}
                </div>
                <p className="text-muted-foreground text-xs">
                  Each source is health-checked as you search; a source that keeps failing is
                  auto-disabled and re-probed until it recovers.
                </p>
              </div>

              {data.trackers && (
                <div className="flex flex-col gap-2">
                  <h3 className="text-sm font-semibold">Magnet trackers</h3>
                  <p className="text-muted-foreground text-xs">
                    {data.trackers.count} trackers appended to every magnet
                    {data.trackers.live
                      ? ` · auto-synced ${relativeTime(data.trackers.syncedAt)}`
                      : " · bundled fallback (live sync pending)"}
                    {data.trackers.source ? (
                      <>
                        {" · "}
                        <a
                          href={data.trackers.source}
                          target="_blank"
                          rel="noreferrer"
                          className="underline"
                        >
                          tracker list
                        </a>
                      </>
                    ) : null}
                  </p>
                </div>
              )}

              {Object.entries(grouped).map(([section, entries]) => (
                <div key={section} className="flex flex-col gap-2">
                  <h3 className="text-sm font-semibold">{section}</h3>
                  <ul className="flex flex-col gap-1">
                    {entries.map((entry) => (
                      <li key={`${section}-${entry.name}`}>
                        <a
                          href={entry.url}
                          target="_blank"
                          rel="noreferrer"
                          className="group flex items-baseline gap-2 text-sm"
                        >
                          <span className="group-hover:underline">
                            {entry.starred ? "⭐ " : ""}
                            {entry.name}
                          </span>
                          <RiExternalLinkFill className="text-muted-foreground size-3 shrink-0 self-center" />
                          {entry.description && (
                            <span className="text-muted-foreground truncate text-xs">
                              {entry.description}
                            </span>
                          )}
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </ScrollArea>
        )}
      </DialogContent>
    </Dialog>
  )
}
