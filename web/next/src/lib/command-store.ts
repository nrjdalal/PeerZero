import { create } from "zustand"

// Open state for the ⌘K command palette. A tiny global store so anything (a navbar hint, a
// keyboard shortcut, a future "open palette" command) can toggle it regardless of where it sits
// in the tree. The palette itself is mounted once in the (app) layout.
type CommandPaletteState = {
  open: boolean
  setOpen: (open: boolean) => void
  toggle: () => void
}

export const useCommandPalette = create<CommandPaletteState>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
  toggle: () => set((s) => ({ open: !s.open })),
}))
