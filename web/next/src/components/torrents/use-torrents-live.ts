"use client"

import type { TorrentSnapshot } from "@api/hono"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useEffect, useState } from "react"

import { apiClient, unwrap } from "@/lib/api/client"

type Status = "connecting" | "online" | "offline"

// The query key the whole app shares for the live torrent list. The WebSocket pushes
// snapshots into this cache; mutations (add, remove, pause, resume) invalidate it so
// the table updates instantly.
export const TORRENTS_QUERY_KEY = ["torrents"] as const

// Live torrent list: each WebSocket frame is pushed straight into the TanStack Query
// cache, whose refetchInterval acts as a poll fallback only while the socket is down.
export function useTorrentsLive(): { torrents: TorrentSnapshot[]; status: Status } {
  const queryClient = useQueryClient()
  const [connected, setConnected] = useState(false)

  const { data, isError } = useQuery({
    queryKey: TORRENTS_QUERY_KEY,
    queryFn: async () => {
      const { data, error } = await unwrap(apiClient.torrents.$get())
      if (error) throw new Error(error.message)
      return data.torrents
    },
    // Poll only when the socket isn't delivering (initial load or a dropped connection).
    refetchInterval: connected ? false : 1000,
    refetchIntervalInBackground: true,
    staleTime: 0,
  })

  useEffect(() => {
    let socket: WebSocket | null = null
    let retry: ReturnType<typeof setTimeout> | null = null
    let closed = false

    const connect = () => {
      if (closed) return
      socket = apiClient.torrents.ws.$ws() as unknown as WebSocket
      socket.addEventListener("open", () => setConnected(true))
      socket.addEventListener("message", (e: MessageEvent) => {
        try {
          const { torrents } = JSON.parse(e.data as string) as { torrents: TorrentSnapshot[] }
          queryClient.setQueryData(TORRENTS_QUERY_KEY, torrents)
        } catch {
          /* ignore malformed frame */
        }
      })
      socket.addEventListener("close", () => {
        setConnected(false)
        if (!closed) retry = setTimeout(connect, 2000) // reconnect with a small backoff
      })
      socket.addEventListener("error", () => socket?.close())
    }

    connect()
    return () => {
      closed = true
      if (retry) clearTimeout(retry)
      socket?.close()
    }
  }, [queryClient])

  const status: Status = connected ? "online" : isError ? "offline" : data ? "online" : "connecting"
  return { torrents: data ?? [], status }
}
