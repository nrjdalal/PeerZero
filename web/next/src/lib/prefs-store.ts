"use client"

import type { SortingState, Updater, VisibilityState } from "@tanstack/react-table"
import { create } from "zustand"
import { persist } from "zustand/middleware"

// A TanStack change handler receives either the next value or an updater function.
function applyUpdater<T>(updater: Updater<T>, current: T): T {
  return typeof updater === "function" ? (updater as (old: T) => T)(current) : updater
}

type TablePref = { sorting: SortingState; columnVisibility: VisibilityState }

type PrefsState = {
  // The Search tab's query, persisted so it survives tab switches and reloads.
  search: string
  setSearch: (value: string) => void
  // Advanced, off by default: reveals the torrent Search feature (navbar icon, /search page,
  // and the toolbar's "Search torrents…" box). Enabled from Settings > Advanced.
  enableSearch: boolean
  setEnableSearch: (value: boolean) => void
  // Per-grid sort + visible-column preferences, keyed by the grid's storageKey.
  tables: Record<string, TablePref>
  setSorting: (key: string, updater: Updater<SortingState>, fallback: SortingState) => void
  setColumnVisibility: (
    key: string,
    updater: Updater<VisibilityState>,
    fallback: VisibilityState,
  ) => void
}

// Persisted UI preferences. skipHydration keeps SSR and the first client paint on
// the defaults (no hydration mismatch); TorrentsProvider rehydrates after mount.
export const usePrefs = create<PrefsState>()(
  persist(
    (set) => ({
      search: "",
      setSearch: (value) => set({ search: value }),
      enableSearch: false,
      setEnableSearch: (value) => set({ enableSearch: value }),
      tables: {},
      setSorting: (key, updater, fallback) =>
        set((s) => {
          const prev = s.tables[key] ?? { sorting: fallback, columnVisibility: {} }
          return {
            tables: {
              ...s.tables,
              [key]: { ...prev, sorting: applyUpdater(updater, prev.sorting) },
            },
          }
        }),
      setColumnVisibility: (key, updater, fallback) =>
        set((s) => {
          const prev = s.tables[key] ?? { sorting: [], columnVisibility: fallback }
          return {
            tables: {
              ...s.tables,
              [key]: { ...prev, columnVisibility: applyUpdater(updater, prev.columnVisibility) },
            },
          }
        }),
    }),
    { name: "peerzero-prefs", skipHydration: true },
  ),
)
