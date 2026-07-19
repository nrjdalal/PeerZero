"use client"

import { RiSearchLine } from "@remixicon/react"

import { Button } from "@/components/ui/button"
import { Kbd } from "@/components/ui/kbd"
import { useCommandPalette } from "@/lib/command-store"

// Visible entry point for the ⌘K palette in the navbar - a shortcut nobody can see gets no use.
// Clicking opens the same palette the keyboard does.
export function CommandHint() {
  const setOpen = useCommandPalette((s) => s.setOpen)
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => setOpen(true)}
      aria-label="Open command palette"
      // Width tuned so the button's left edge lines up with the toolbar's Search box (sm:w-64,
      // right-anchored) directly below it.
      className="text-muted-foreground h-8 w-[7.375rem] justify-between gap-3 px-2.5"
    >
      <RiSearchLine className="size-4" />
      <Kbd>⌘K</Kbd>
    </Button>
  )
}
