"use client"

import type { SortingState, Updater, VisibilityState } from "@tanstack/react-table"
import { create } from "zustand"
import { createJSONStorage, persist, type StateStorage } from "zustand/middleware"

import { apiClient, unwrap } from "@/lib/api/client"

// A TanStack change handler receives either the next value or an updater function.
function applyUpdater<T>(updater: Updater<T>, current: T): T {
  return typeof updater === "function" ? (updater as (old: T) => T)(current) : updater
}

// Persist these prefs on the backend (in the app's settings.json, under `ui`), not in the browser.
// localStorage is scoped per origin, and the desktop webview's origin includes the
// backend's ephemeral port, which changes every launch (see desktop/backend/main.ts) - so a
// localStorage-backed store reads empty after each restart and every setting silently reverts to
// its default. The backend file is origin-independent, so settings survive restarts on desktop and
// follow the install on web. Writes are debounced: Zustand persists on every state change (each
// keystroke in the Search box calls setSearch), and we don't want a network + disk write per key.
const WRITE_DEBOUNCE_MS = 300
let writeTimer: ReturnType<typeof setTimeout> | null = null
let pendingWrite: string | null = null

async function flushWrite() {
  writeTimer = null
  if (pendingWrite === null) return
  const value = pendingWrite
  pendingWrite = null
  await unwrap(apiClient.torrents["ui-prefs"].$put({ json: { prefs: JSON.parse(value) } }))
}

const backendStorage: StateStorage = {
  async getItem() {
    const { data } = await unwrap(apiClient.torrents["ui-prefs"].$get())
    // The envelope is { prefs: <the JSON we stored, or null> }; hand Zustand back the serialized
    // string it expects (createJSONStorage parses it), or null so the store keeps its defaults.
    const prefs = data?.prefs
    return prefs == null ? null : JSON.stringify(prefs)
  },
  setItem(_name, value) {
    // Coalesce bursts (typing) into one trailing write that always carries the latest snapshot.
    pendingWrite = value
    if (!writeTimer) writeTimer = setTimeout(() => void flushWrite(), WRITE_DEBOUNCE_MS)
  },
  async removeItem() {
    pendingWrite = null
    if (writeTimer) {
      clearTimeout(writeTimer)
      writeTimer = null
    }
    await unwrap(apiClient.torrents["ui-prefs"].$put({ json: { prefs: null } }))
  },
}

type TablePref = { sorting: SortingState; columnVisibility: VisibilityState }

type PrefsState = {
  // The Search tab's query, persisted so it survives tab switches, reloads, and restarts.
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
      // Persisted so the query survives leaving/returning to the Search tab, reloads, and restarts.
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
    {
      name: "peerzero-prefs",
      skipHydration: true,
      storage: createJSONStorage(() => backendStorage),
    },
  ),
)
