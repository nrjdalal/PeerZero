import { create } from "zustand"

// Open state for the "?" keyboard-shortcut cheat sheet. A tiny global store so the "?" key and a
// "Keyboard shortcuts" palette command can both open it. The sheet is mounted once in the (app)
// layout.
type CheatsheetState = {
  open: boolean
  setOpen: (open: boolean) => void
  toggle: () => void
}

export const useCheatsheet = create<CheatsheetState>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
  toggle: () => set((s) => ({ open: !s.open })),
}))
