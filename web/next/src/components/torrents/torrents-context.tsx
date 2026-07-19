"use client"

import type { TorrentSnapshot } from "@api/hono"
import { createContext, useContext, useEffect } from "react"

import { useTorrentsLive } from "@/components/torrents/use-torrents-live"
import { usePrefs } from "@/lib/prefs-store"

type TorrentsContextValue = {
  torrents: TorrentSnapshot[]
  status: "connecting" | "online" | "offline"
  loaded: boolean
}

const TorrentsContext = createContext<TorrentsContextValue | null>(null)

// One WebSocket for the whole app: mounted in the (app) layout so switching between
// the Transfers / Search tabs never drops the live feed or reconnects.
export function TorrentsProvider({ children }: { children: React.ReactNode }) {
  const value = useTorrentsLive()
  // Rehydrate persisted prefs after mount (store uses skipHydration to avoid a hydration
  // mismatch between SSR and first client paint).
  useEffect(() => {
    usePrefs.persist.rehydrate()
  }, [])
  return <TorrentsContext.Provider value={value}>{children}</TorrentsContext.Provider>
}

export function useTorrents() {
  const ctx = useContext(TorrentsContext)
  if (!ctx) throw new Error("useTorrents must be used within a TorrentsProvider")
  return ctx
}
