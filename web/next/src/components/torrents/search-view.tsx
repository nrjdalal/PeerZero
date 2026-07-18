"use client"

import type { SearchResult } from "@api/hono"
import { RiCheckFill, RiDownloadFill, RiSearchFill } from "@remixicon/react"
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { ColumnDef, SortingState, VisibilityState } from "@tanstack/react-table"
import Link from "next/link"
import { useEffect, useMemo, useState } from "react"
import { toast } from "sonner"

import { DataGrid, SortHeader } from "@/components/torrents/data-grid"
import { useTorrents } from "@/components/torrents/torrents-context"
import { TORRENTS_QUERY_KEY } from "@/components/torrents/use-torrents-live"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Spinner } from "@/components/ui/spinner"
import { apiClient, unwrap } from "@/lib/api/client"
import { formatAge, formatBytes } from "@/lib/format"
import { usePrefs } from "@/lib/prefs-store"

// Human labels for the Columns dropdown so it matches the table headers exactly.
const COLUMN_LABELS: Record<string, string> = {
  name: "Name",
  added: "Added",
  sizeBytes: "Size",
  leechers: "Peers",
  seeders: "Seeds",
}

// Stable references for the DataGrid's fallback state (no stored preference yet).
const DEFAULT_SORTING: SortingState = [{ id: "seeders", desc: true }]
const HIDDEN_COLUMNS: VisibilityState = { source: false }

// The row's download control. Self-contained so nothing here is closed over by the
// columns array, which stays a stable module constant (so the table never rebuilds).
function AddAction({ result }: { result: SearchResult }) {
  const { torrents } = useTorrents()
  const queryClient = useQueryClient()
  const added = torrents.some((t) => t.infoHash === result.infoHash)
  const add = useMutation({
    mutationFn: async () => {
      const { data, error } = await unwrap(
        apiClient.torrents.$post({ json: { magnet: result.magnet } }),
      )
      if (error) throw new Error(error.message)
      return data
    },
    onSuccess: (d) => {
      queryClient.invalidateQueries({ queryKey: TORRENTS_QUERY_KEY })
      toast.success(`Added: ${d.torrent.name}`)
    },
    onError: (e) => toast.error(e.message),
  })
  return (
    <div className="flex justify-end">
      <Button
        size="icon-sm"
        variant="ghost"
        disabled={added || add.isPending}
        title={added ? "Added" : "Download"}
        onClick={() => add.mutate()}
      >
        {added ? (
          <RiCheckFill className="text-success size-4" />
        ) : (
          <RiDownloadFill className="size-4" />
        )}
      </Button>
    </div>
  )
}

// Stable module-level definition so the table never sees a new columns reference.
const columns: ColumnDef<SearchResult>[] = [
  {
    accessorKey: "name",
    header: ({ column, table }) => <SortHeader column={column} table={table} label="Name" />,
    cell: ({ row }) => (
      <div className="flex min-w-0 items-center gap-2">
        <span className="truncate" title={row.original.name}>
          {row.original.name}
        </span>
        <Badge variant="secondary" className="shrink-0 font-normal">
          {row.original.source}
        </Badge>
      </div>
    ),
  },
  {
    // Shown as a label on the name; this column exists only to back the faceted Source
    // filter. Hidden via initialColumnVisibility and can't be toggled on.
    accessorKey: "source",
    enableHiding: false,
    filterFn: (row, id, value: string[]) =>
      !value?.length || value.includes(row.getValue(id) as string),
  },
  {
    accessorKey: "added",
    size: 78,
    meta: { align: "right" },
    header: ({ column, table }) => (
      <SortHeader column={column} table={table} label="Added" align="right" />
    ),
    cell: ({ getValue }) => (
      <span className="text-muted-foreground font-mono text-xs tabular-nums">
        {formatAge(getValue() as number)}
      </span>
    ),
  },
  {
    accessorKey: "sizeBytes",
    size: 96,
    meta: { align: "right" },
    header: ({ column, table }) => (
      <SortHeader column={column} table={table} label="Size" align="right" />
    ),
    cell: ({ getValue }) => (
      <span className="text-muted-foreground font-mono text-xs tabular-nums">
        {formatBytes(getValue() as number)}
      </span>
    ),
  },
  {
    accessorKey: "leechers",
    size: 78,
    meta: { align: "right" },
    header: ({ column, table }) => (
      <SortHeader column={column} table={table} label="Peers" align="right" />
    ),
    cell: ({ getValue }) => (
      <span className="font-mono text-xs tabular-nums">{getValue() as number}</span>
    ),
  },
  {
    accessorKey: "seeders",
    size: 78,
    meta: { align: "right" },
    header: ({ column, table }) => (
      <SortHeader column={column} table={table} label="Seeds" align="right" />
    ),
    cell: ({ getValue }) => (
      <span className="text-success font-mono text-xs tabular-nums">{getValue() as number}</span>
    ),
  },
  {
    id: "actions",
    size: 128,
    minSize: 128,
    enableHiding: false,
    header: () => <span className="sr-only">Get</span>,
    cell: ({ row }) => <AddAction result={row.original} />,
  },
]

// Debounce before firing a search; long-ish because each search fans out to ~10 providers.
const SEARCH_DEBOUNCE_MS = 500

// The Search tab: the same DataGrid as Transfers, fed by live search results. The
// search box here filters inline (debounced) rather than navigating.
export function SearchView({ initialQuery = "" }: { initialQuery?: string }) {
  // Query is persisted in the store so it survives leaving/returning to the tab and reloads.
  const query = usePrefs((s) => s.search)
  const setQuery = usePrefs((s) => s.setSearch)
  const [debounced, setDebounced] = useState(query.trim() || initialQuery.trim())
  const isMagnet = query.trim().toLowerCase().startsWith("magnet:")

  // Seed the persisted query from a ?q= deep link (the Transfers box navigates here).
  useEffect(() => {
    if (initialQuery) setQuery(initialQuery)
  }, [initialQuery, setQuery])

  // Debounce real input, but clear instantly when the box is emptied/too short so stale
  // results and the spinner don't linger.
  useEffect(() => {
    const trimmed = query.trim()
    if (trimmed.length < 2) {
      setDebounced(trimmed)
      return
    }
    const t = setTimeout(() => setDebounced(trimmed), SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [query])

  const { data, isFetching } = useQuery({
    queryKey: ["search", debounced],
    enabled: debounced.length >= 2 && !debounced.toLowerCase().startsWith("magnet:"),
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const { data, error } = await unwrap(
        apiClient.torrents.search.$get({ query: { q: debounced } }),
      )
      if (error) throw new Error(error.message)
      return data
    },
  })

  // Only used by the "add this magnet" empty-state button (row downloads live in AddAction).
  const queryClient = useQueryClient()
  const addMagnet = useMutation({
    mutationFn: async (magnet: string) => {
      const { data, error } = await unwrap(apiClient.torrents.$post({ json: { magnet } }))
      if (error) throw new Error(error.message)
      return data
    },
    onSuccess: (d) => {
      queryClient.invalidateQueries({ queryKey: TORRENTS_QUERY_KEY })
      toast.success(`Added: ${d.torrent.name}`)
    },
    onError: (e) => toast.error(e.message),
  })

  const results = useMemo(() => data?.results ?? [], [data])
  const sources = useMemo(() => [...new Set(results.map((r) => r.source))], [results])

  const empty = isMagnet ? (
    <div className="flex h-64 items-center justify-center">
      <Button onClick={() => addMagnet.mutate(query.trim())}>
        <RiDownloadFill className="size-4" />
        Add this magnet link
      </Button>
    </div>
  ) : isFetching ? (
    <div className="flex h-64 items-center justify-center">
      <Spinner />
    </div>
  ) : (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <RiSearchFill />
        </EmptyMedia>
        <EmptyTitle>{debounced.length < 2 ? "No search yet" : "No torrents found"}</EmptyTitle>
        <EmptyDescription>
          {debounced.length < 2 ? (
            <>
              Head to the <Link href="/">Transfers</Link> tab to manage torrents.
            </>
          ) : (
            "Try a different search term."
          )}
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  )

  return (
    <DataGrid
      data={results}
      columns={columns}
      columnLabels={COLUMN_LABELS}
      getRowId={(r) => r.infoHash}
      storageKey="search"
      tableClassName="min-w-256"
      initialSorting={DEFAULT_SORTING}
      initialColumnVisibility={HIDDEN_COLUMNS}
      search={{ value: query, onChange: setQuery, pending: isFetching }}
      facet={{ columnId: "source", label: "Source", options: sources }}
      empty={empty}
    />
  )
}
