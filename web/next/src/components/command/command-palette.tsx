"use client"

import {
  RiArrowLeftRightLine,
  RiDownloadLine,
  RiFolderOpenLine,
  RiPauseLine,
  RiPlayLine,
  RiSearchLine,
} from "@remixicon/react"
import { useQueryClient } from "@tanstack/react-query"
import { useRouter } from "next/navigation"
import { useEffect, useState } from "react"
import { toast } from "sonner"

import { useTorrents } from "@/components/torrents/torrents-context"
import { TORRENTS_QUERY_KEY } from "@/components/torrents/use-torrents-live"
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command"
import { apiClient, unwrap } from "@/lib/api/client"
import { useCommandPalette } from "@/lib/command-store"
import { usePrefs } from "@/lib/prefs-store"

// The ⌘K command palette: one keyboard surface for navigation + the core actions. Mounted once in
// the (app) layout (so it can read the live torrent list). This is the seed of a fuller command
// registry - keep commands declarative and grouped so tooltips and a "?" cheatsheet can render
// from the same source later.
export function CommandPalette() {
  const open = useCommandPalette((s) => s.open)
  const setOpen = useCommandPalette((s) => s.setOpen)
  const toggle = useCommandPalette((s) => s.toggle)
  const [query, setQuery] = useState("")
  const router = useRouter()
  const { torrents } = useTorrents()
  const queryClient = useQueryClient()
  // Search is an off-by-default advanced feature; the palette mirrors the navbar - "Go to Search"
  // only appears when it's enabled.
  const enableSearch = usePrefs((s) => s.enableSearch)

  // ⌘K / Ctrl+K toggles the palette from anywhere - it's a global accelerator, so it fires even
  // while typing in a field (⌘K is never a text-editing key).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault()
        toggle()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [toggle])

  // Start each open with an empty query.
  useEffect(() => {
    if (open) setQuery("")
  }, [open])

  const invalidate = () => queryClient.invalidateQueries({ queryKey: TORRENTS_QUERY_KEY })

  // Close the palette, then run - so the UI updates behind the closing dialog.
  const run = (fn: () => unknown) => {
    setOpen(false)
    void Promise.resolve().then(fn)
  }
  const go = (href: string) => run(() => router.push(href))

  const magnet = query.trim()
  const isMagnet = magnet.toLowerCase().startsWith("magnet:")

  const addMagnet = () =>
    run(async () => {
      const { data, error } = await unwrap(apiClient.torrents.$post({ json: { magnet } }))
      if (error) return toast.error(error.message)
      toast.success(`Added: ${data.torrent.name}`)
      invalidate()
    })

  const pauseAll = () =>
    run(async () => {
      const targets = torrents.filter((t) => !t.done && !t.paused)
      if (!targets.length) return toast("Nothing to pause")
      await Promise.all(
        targets.map((t) =>
          unwrap(apiClient.torrents[":infoHash"].pause.$post({ param: { infoHash: t.infoHash } })),
        ),
      )
      toast.success(`Paused ${targets.length}`)
      invalidate()
    })

  const resumeAll = () =>
    run(async () => {
      const targets = torrents.filter((t) => t.paused && !t.done)
      if (!targets.length) return toast("Nothing to resume")
      await Promise.all(
        targets.map((t) =>
          unwrap(apiClient.torrents[":infoHash"].resume.$post({ param: { infoHash: t.infoHash } })),
        ),
      )
      toast.success(`Resumed ${targets.length}`)
      invalidate()
    })

  const openFolder = () =>
    run(async () => {
      const { error } = await unwrap(apiClient.torrents.open.$post())
      if (error) toast.error(error.message)
    })

  return (
    <CommandDialog open={open} onOpenChange={setOpen} className="sm:max-w-2xl">
      <Command shouldFilter={!isMagnet}>
        <CommandInput
          placeholder="Type a command, or paste a magnet link…"
          value={query}
          onValueChange={setQuery}
        />
        <CommandList>
          {isMagnet ? (
            <CommandGroup heading="Add">
              <CommandItem onSelect={addMagnet}>
                <RiDownloadLine />
                Add magnet
                <span className="text-muted-foreground ml-auto max-w-[55%] truncate text-xs">
                  {magnet.slice(8, 60)}
                </span>
              </CommandItem>
            </CommandGroup>
          ) : (
            <>
              <CommandEmpty>No matching command.</CommandEmpty>
              <CommandGroup heading="Go to">
                <CommandItem onSelect={() => go("/")}>
                  <RiArrowLeftRightLine />
                  Transfers
                  <CommandShortcut>G T</CommandShortcut>
                </CommandItem>
                {enableSearch && (
                  <CommandItem onSelect={() => go("/search")}>
                    <RiSearchLine />
                    Search
                    <CommandShortcut>G S</CommandShortcut>
                  </CommandItem>
                )}
              </CommandGroup>
              <CommandSeparator />
              <CommandGroup heading="Transfers">
                <CommandItem onSelect={resumeAll}>
                  <RiPlayLine />
                  Resume all
                </CommandItem>
                <CommandItem onSelect={pauseAll}>
                  <RiPauseLine />
                  Pause all
                </CommandItem>
                <CommandItem onSelect={openFolder}>
                  <RiFolderOpenLine />
                  Open download folder
                </CommandItem>
              </CommandGroup>
            </>
          )}
        </CommandList>
      </Command>
    </CommandDialog>
  )
}
