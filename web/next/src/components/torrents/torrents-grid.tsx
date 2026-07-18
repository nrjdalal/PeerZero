"use client"

import type { TorrentSnapshot } from "@api/hono"
import { RiDeleteBinLine, RiInboxLine, RiPauseLine, RiPlayLine } from "@remixicon/react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import type { ColumnDef, SortingState, VisibilityState } from "@tanstack/react-table"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState } from "react"
import { toast } from "sonner"

import { DataGrid, SortHeader } from "@/components/torrents/data-grid"
import { useTorrents } from "@/components/torrents/torrents-context"
import { TORRENTS_QUERY_KEY } from "@/components/torrents/use-torrents-live"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Progress } from "@/components/ui/progress"
import { Spinner } from "@/components/ui/spinner"
import { apiClient, unwrap } from "@/lib/api/client"
import { formatAge, formatBytes, formatEta, formatPercent, formatSpeed } from "@/lib/format"
import { cn } from "@/lib/utils"

type Torrent = TorrentSnapshot

// Stable references (the DataGrid falls back to these when nothing's stored yet).
const DEFAULT_SORTING: SortingState = [{ id: "addedAt", desc: true }]
// Up (upload speed) is off by default since we don't seed; enable it via Columns.
const DEFAULT_COLUMN_VISIBILITY: VisibilityState = { uploadSpeed: false }

const STATUSES = ["Downloading", "Completed", "Paused", "Fetching"] as const
type Status = (typeof STATUSES)[number]

const STATUS_DOT: Record<Status, string> = {
  Downloading: "bg-primary",
  Completed: "bg-success",
  Paused: "bg-muted-foreground",
  Fetching: "bg-muted-foreground animate-pulse",
}

// Human labels for the Columns dropdown so it matches the table headers exactly.
const COLUMN_LABELS: Record<string, string> = {
  name: "Name",
  addedAt: "Added",
  progress: "Progress",
  status: "Status",
  length: "Size",
  numPeers: "Peers",
  seeders: "Seeds",
  downloadSpeed: "Down",
  uploadSpeed: "Up",
  eta: "ETA",
}

// Completed torrents are auto-stopped (we don't seed), so "Completed" covers done.
// "Fetching" means the torrent is still resolving metadata/peers (not yet ready).
function torrentStatus(t: Torrent): Status {
  if (t.done) return "Completed"
  if (t.paused) return "Paused"
  if (t.ready) return "Downloading"
  return "Fetching"
}

function RowActions({ torrent: t }: { torrent: Torrent }) {
  const queryClient = useQueryClient()
  // Refresh the live list immediately after an action instead of waiting for the poll.
  const invalidate = () => queryClient.invalidateQueries({ queryKey: TORRENTS_QUERY_KEY })
  // Throw on error so a mutation's onSuccess never fires on a failed request.
  const run = (fn: () => Promise<{ error: { message: string } | null }>) => async () => {
    const { error } = await fn()
    if (error) throw new Error(error.message)
  }
  const pause = useMutation({
    mutationFn: run(() =>
      unwrap(apiClient.torrents[":infoHash"].pause.$post({ param: { infoHash: t.infoHash } })),
    ),
    onSuccess: invalidate,
    onError: (e) => toast.error(e.message),
  })
  const resume = useMutation({
    mutationFn: run(() =>
      unwrap(apiClient.torrents[":infoHash"].resume.$post({ param: { infoHash: t.infoHash } })),
    ),
    onSuccess: invalidate,
    onError: (e) => toast.error(e.message),
  })
  const remove = useMutation({
    mutationFn: async (destroyStore: boolean) => {
      const { error } = await unwrap(
        apiClient.torrents[":infoHash"].$delete({
          param: { infoHash: t.infoHash },
          query: { destroyStore: destroyStore ? "true" : "false" },
        }),
      )
      if (error) throw new Error(error.message)
    },
    onSuccess: () => {
      invalidate()
      toast.success("Removed")
    },
    onError: (e) => toast.error(e.message),
  })
  const busy = pause.isPending || resume.isPending || remove.isPending
  const [confirmOpen, setConfirmOpen] = useState(false)

  return (
    <div className="flex justify-end gap-1">
      {!t.done &&
        (t.paused ? (
          <Button
            size="icon-sm"
            variant="ghost"
            disabled={busy}
            title="Resume"
            onClick={() => resume.mutate()}
          >
            <RiPlayLine className="size-4" />
          </Button>
        ) : (
          <Button
            size="icon-sm"
            variant="ghost"
            disabled={busy}
            title="Pause"
            onClick={() => pause.mutate()}
          >
            <RiPauseLine className="size-4" />
          </Button>
        ))}
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogTrigger
          render={<Button size="icon-sm" variant="ghost" disabled={busy} title="Remove" />}
        >
          <RiDeleteBinLine className="size-4" />
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove torrent?</AlertDialogTitle>
            <AlertDialogDescription>
              Remove this torrent from PeerZero. You can keep the downloaded files or delete them
              from disk.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="outline"
              onClick={() => {
                remove.mutate(false)
                setConfirmOpen(false)
              }}
            >
              Keep files
            </AlertDialogAction>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                remove.mutate(true)
                setConfirmOpen(false)
              }}
            >
              Delete files
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

// Stable module-level definition so the table never sees a new columns reference.
const columns: ColumnDef<Torrent>[] = [
  {
    accessorKey: "name",
    enableResizing: false,
    header: ({ column, table }) => <SortHeader column={column} table={table} label="Name" />,
    cell: ({ row }) => (
      <span className="block truncate font-medium" title={row.original.name}>
        {row.original.name}
      </span>
    ),
  },
  {
    id: "progress",
    size: 220,
    minSize: 160,
    meta: { align: "center" },
    accessorFn: (t) => t.progress,
    header: ({ column, table }) => (
      <SortHeader column={column} table={table} label="Progress" align="center" />
    ),
    cell: ({ row }) => (
      <div className="relative">
        <Progress
          value={row.original.progress * 100}
          className="[&_[data-slot=progress-indicator]]:bg-green-400 dark:[&_[data-slot=progress-indicator]]:bg-green-700 [&_[data-slot=progress-track]]:h-5 [&_[data-slot=progress-track]]:border [&_[data-slot=progress-track]]:bg-transparent"
        />
        <span className="absolute inset-0 flex items-center justify-center font-mono text-xs font-medium tabular-nums">
          {formatPercent(row.original.progress)}
        </span>
      </div>
    ),
  },
  {
    id: "status",
    size: 130,
    minSize: 110,
    meta: { align: "center" },
    accessorFn: torrentStatus,
    header: () => <div className="text-center">Status</div>,
    filterFn: (row, id, value: string[]) =>
      !value?.length || value.includes(row.getValue(id) as string),
    cell: ({ getValue }) => {
      const s = getValue() as Status
      return (
        <Badge variant="outline" className="gap-1.5 font-normal">
          <span className={cn("size-1.5 rounded-full", STATUS_DOT[s])} aria-hidden />
          {s}
        </Badge>
      )
    },
  },
  {
    accessorKey: "downloadSpeed",
    size: 96,
    meta: { align: "right" },
    header: ({ column, table }) => (
      <SortHeader column={column} table={table} label="Down" align="right" />
    ),
    cell: ({ getValue }) => (
      <span className="font-mono text-xs tabular-nums">{formatSpeed(getValue() as number)}</span>
    ),
  },
  {
    accessorKey: "uploadSpeed",
    size: 96,
    meta: { align: "right" },
    header: ({ column, table }) => (
      <SortHeader column={column} table={table} label="Up" align="right" />
    ),
    cell: ({ getValue }) => (
      <span className="text-muted-foreground font-mono text-xs tabular-nums">
        {formatSpeed(getValue() as number)}
      </span>
    ),
  },
  {
    id: "eta",
    size: 80,
    meta: { align: "right" },
    accessorFn: (t) => t.timeRemaining ?? Number.POSITIVE_INFINITY,
    header: () => <div className="text-right">ETA</div>,
    cell: ({ row }) => (
      <span className="text-muted-foreground font-mono text-xs tabular-nums">
        {formatEta(row.original.timeRemaining)}
      </span>
    ),
  },
  {
    accessorKey: "addedAt",
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
  // Size, Peers, Seeds sit last (before actions) and share Search's widths so the
  // two tables' rightmost columns line up exactly.
  {
    accessorKey: "length",
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
    accessorKey: "numPeers",
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
    size: 96,
    minSize: 96,
    enableResizing: false,
    enableHiding: false,
    header: () => <span className="sr-only">Actions</span>,
    cell: ({ row }) => <RowActions torrent={row.original} />,
  },
]

export function TorrentsGrid() {
  const { torrents, status } = useTorrents()
  const router = useRouter()
  const [searchQuery, setSearchQuery] = useState("")

  const empty =
    status === "connecting" && torrents.length === 0 ? (
      <div className="flex h-64 items-center justify-center">
        <Spinner />
      </div>
    ) : (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <RiInboxLine />
          </EmptyMedia>
          <EmptyTitle>
            {torrents.length === 0 ? "No torrents yet" : "Nothing matches your filters"}
          </EmptyTitle>
          <EmptyDescription>
            Head to the <Link href="/search">Search</Link> tab to find torrents.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    )

  return (
    <DataGrid
      data={torrents}
      columns={columns}
      columnLabels={COLUMN_LABELS}
      getRowId={(t) => t.infoHash}
      storageKey="transfers"
      primaryInput="filter"
      tableClassName="min-w-[66rem]"
      initialSorting={DEFAULT_SORTING}
      initialColumnVisibility={DEFAULT_COLUMN_VISIBILITY}
      search={{
        value: searchQuery,
        onChange: setSearchQuery,
        onSubmit: () => {
          const q = searchQuery.trim()
          router.push(q ? `/search?q=${encodeURIComponent(q)}` : "/search")
        },
      }}
      facet={{ columnId: "status", label: "Status", options: STATUSES }}
      empty={empty}
    />
  )
}
