"use client"

import { useEffect } from "react"

import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Kbd } from "@/components/ui/kbd"
import { useCheatsheet } from "@/lib/cheatsheet-store"
import { usePrefs } from "@/lib/prefs-store"

// The "?" cheat sheet: a discoverability layer for the keyboard-first surface (the ⌘K palette,
// view jumps, and the per-row grid keys). Opened by "?" or the "Keyboard shortcuts" palette
// command. Mounted once in the (app) layout. A "then" token renders a two-key sequence (g, then t).
export function ShortcutCheatsheet() {
  const open = useCheatsheet((s) => s.open)
  const setOpen = useCheatsheet((s) => s.setOpen)
  const toggle = useCheatsheet((s) => s.toggle)
  const enableSearch = usePrefs((s) => s.enableSearch)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "?") return
      const el = e.target as HTMLElement | null
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable))
        return
      if (el?.closest('[role="dialog"]')) return
      e.preventDefault()
      toggle()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [toggle])

  const groups: { heading: string; rows: { label: string; keys: string[] }[] }[] = [
    {
      heading: "General",
      rows: [
        { label: "Command palette", keys: ["⌘", "K"] },
        { label: "This cheat sheet", keys: ["?"] },
        { label: "Close / step back", keys: ["Esc"] },
      ],
    },
    {
      heading: "Navigate",
      rows: [
        { label: "Go to Transfers", keys: ["G", "then", "T"] },
        ...(enableSearch ? [{ label: "Go to Search", keys: ["G", "then", "S"] }] : []),
      ],
    },
    {
      heading: "Transfers list",
      rows: [
        { label: "Move the cursor", keys: ["↑", "↓"] },
        { label: "Extend selection", keys: ["⇧", "↑", "↓"] },
        { label: "Select row", keys: ["Space"] },
        { label: "Select all", keys: ["⌘", "A"] },
        { label: "Play / expand", keys: ["↵"] },
        { label: "Pause / resume", keys: ["P", "R"] },
        { label: "Open folder", keys: ["O"] },
        { label: "Remove (with undo)", keys: ["⌫"] },
      ],
    },
  ]

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription className="sr-only">
            Every keyboard shortcut in PeerZero.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="grid gap-5">
          {groups.map((g) => (
            <div key={g.heading} className="grid gap-2">
              <h3 className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                {g.heading}
              </h3>
              {g.rows.map((row) => (
                <div key={row.label} className="flex items-center justify-between gap-4 text-sm">
                  <span className="text-foreground">{row.label}</span>
                  <span className="flex items-center gap-1">
                    {row.keys.map((k, i) =>
                      k === "then" ? (
                        <span
                          key={`${row.label}-${i}`}
                          className="text-muted-foreground px-0.5 text-xs"
                        >
                          then
                        </span>
                      ) : (
                        <Kbd key={`${row.label}-${i}`}>{k}</Kbd>
                      ),
                    )}
                  </span>
                </div>
              ))}
            </div>
          ))}
        </DialogBody>
      </DialogContent>
    </Dialog>
  )
}
