"use client"

import type { TorrentSnapshot } from "@api/hono"
import {
  RiDeleteBinFill,
  RiFolderOpenFill,
  RiInboxFill,
  RiPauseFill,
  RiPlayFill,
} from "@remixicon/react"
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
import { Spinner } from "@/components/ui/spinner"
import { apiClient, unwrap } from "@/lib/api/client"
import { formatAge, formatBytes, formatEta, formatPercent, formatSpeed } from "@/lib/format"
import { usePrefs } from "@/lib/prefs-store"
import { cn } from "@/lib/utils"

type Torrent = TorrentSnapshot

// Stable references (the DataGrid falls back to these when nothing's stored yet).
const DEFAULT_SORTING: SortingState = [{ id: "addedAt", desc: true }]
// Up (upload speed) is off by default since we don't seed; enable it via Columns.
const DEFAULT_COLUMN_VISIBILITY: VisibilityState = { uploadSpeed: false }

const STATUSES = ["Downloading", "Completed", "Paused", "Fetching"] as const
type Status = (typeof STATUSES)[number]

// Status shown as a shadcn "Custom Colors" badge (ui.shadcn.com/docs/components/base/
// badge#custom-colors): a soft palette fill with matching text, paired light/dark. This is
// the one documented exception to semantic-tokens-only (see the design skill); Paused stays
// neutral on the muted token.
// border-current makes each badge's border match its text color (see the design skill).
const STATUS_BADGE: Record<Status, string> = {
  Downloading: "border-current bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
  Completed: "border-current bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-300",
  Paused: "border-current bg-muted text-muted-foreground",
  // Same muted look as Paused; the pulse (added in the cell) is what sets Fetching apart.
  Fetching: "border-current bg-muted text-muted-foreground",
}

// Icon color per status. State-action icons use the status they produce (resume =
// Downloading, pause = Paused); the reveal icon follows the row's current status. Delete is
// always destructive, so it isn't here.
const STATUS_ICON: Record<Status, string> = {
  Downloading: "text-blue-600 dark:text-blue-400",
  Completed: "text-green-600 dark:text-green-400",
  Paused: "text-muted-foreground",
  Fetching: "text-muted-foreground",
}

// Human labels for the Columns dropdown so it matches the table headers exactly.
const COLUMN_LABELS: Record<string, string> = {
  name: "Name",
  addedAt: "Added",
  progress: "Progress",
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
  const reveal = useMutation({
    mutationFn: run(() =>
      unwrap(apiClient.torrents[":infoHash"].reveal.$post({ param: { infoHash: t.infoHash } })),
    ),
    onError: (e) => toast.error(e.message),
  })
  const busy = pause.isPending || resume.isPending || remove.isPending || reveal.isPending
  const [confirmOpen, setConfirmOpen] = useState(false)

  return (
    <div className="flex justify-end gap-1">
      {/* Pause/resume slot - a hidden placeholder keeps the columns aligned when done. */}
      {t.done ? (
        <Button size="icon-sm" variant="ghost" className="invisible" tabIndex={-1} aria-hidden>
          <RiPauseFill className="size-4" />
        </Button>
      ) : t.paused ? (
        <Button
          size="icon-sm"
          variant="ghost"
          disabled={busy}
          title="Resume"
          onClick={() => resume.mutate()}
        >
          <RiPlayFill className={cn("size-4", STATUS_ICON.Downloading)} />
        </Button>
      ) : (
        <Button
          size="icon-sm"
          variant="ghost"
          disabled={busy}
          title="Pause"
          onClick={() => pause.mutate()}
        >
          <RiPauseFill className={cn("size-4", STATUS_ICON.Paused)} />
        </Button>
      )}
      {/* Reveal slot - placeholder before files exist so delete stays in a fixed column. */}
      {t.ready ? (
        <Button
          size="icon-sm"
          variant="ghost"
          disabled={busy}
          title="Reveal in folder"
          onClick={() => reveal.mutate()}
        >
          <RiFolderOpenFill className={cn("size-4", STATUS_ICON[torrentStatus(t)])} />
        </Button>
      ) : (
        <Button size="icon-sm" variant="ghost" className="invisible" tabIndex={-1} aria-hidden>
          <RiFolderOpenFill className="size-4" />
        </Button>
      )}
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogTrigger
          render={<Button size="icon-sm" variant="ghost" disabled={busy} title="Remove" />}
        >
          <RiDeleteBinFill className="text-destructive size-4" />
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
    size: 176,
    minSize: 160,
    meta: { align: "center" },
    accessorFn: (t) => t.progress,
    header: ({ column, table }) => (
      <SortHeader column={column} table={table} label="Progress" align="center" />
    ),
    // Progress doubles as Status: the Status facet filters this column by stage.
    filterFn: (row, _id, value: string[]) =>
      !value?.length || value.includes(torrentStatus(row.original)),
    cell: ({ row }) => {
      const t = row.original
      const s = torrentStatus(t)
      // Percent while downloading; the stage word otherwise (Fetching / Paused / Completed).
      const label = s === "Downloading" ? formatPercent(t.progress) : s
      return (
        <Badge
          className={cn(
            // Fixed width so every stage badge is equal width and lines up down the column.
            "w-36 justify-center border-[0.5px] font-normal tabular-nums",
            STATUS_BADGE[s],
            s === "Fetching" && "animate-pulse",
          )}
        >
          {label}
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
    // Hide the value when idle (paused/completed/stalled) instead of showing "0 B/s".
    cell: ({ getValue }) => {
      const v = getValue() as number
      return <span className="font-mono text-xs tabular-nums">{v > 0 ? formatSpeed(v) : null}</span>
    },
  },
  {
    accessorKey: "uploadSpeed",
    size: 96,
    meta: { align: "right" },
    header: ({ column, table }) => (
      <SortHeader column={column} table={table} label="Up" align="right" />
    ),
    cell: ({ getValue }) => {
      const v = getValue() as number
      return (
        <span className="text-muted-foreground font-mono text-xs tabular-nums">
          {v > 0 ? formatSpeed(v) : null}
        </span>
      )
    },
  },
  {
    id: "eta",
    size: 80,
    meta: { align: "right" },
    accessorFn: (t) => t.timeRemaining ?? Number.POSITIVE_INFINITY,
    header: () => <div className="text-right">ETA</div>,
    // Blank (not "-") when there's no live ETA: paused, completed, or stalled.
    cell: ({ row }) => {
      const ms = row.original.timeRemaining
      const hasEta = ms != null && Number.isFinite(ms) && ms > 0
      return (
        <span className="text-muted-foreground font-mono text-xs tabular-nums">
          {hasEta ? formatEta(ms) : null}
        </span>
      )
    },
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
    // Peers/Seeds matter only while active; show the live count (even 0), hide once completed.
    cell: ({ row }) => {
      const t = row.original
      return <span className="font-mono text-xs tabular-nums">{t.done ? null : t.numPeers}</span>
    },
  },
  {
    accessorKey: "seeders",
    size: 78,
    meta: { align: "right" },
    header: ({ column, table }) => (
      <SortHeader column={column} table={table} label="Seeds" align="right" />
    ),
    cell: ({ row }) => {
      const t = row.original
      return (
        <span className="text-success font-mono text-xs tabular-nums">
          {t.done ? null : t.seeders}
        </span>
      )
    },
  },
  {
    id: "actions",
    size: 128,
    minSize: 128,
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
            <RiInboxFill />
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
      tableClassName="min-w-256"
      initialSorting={DEFAULT_SORTING}
      initialColumnVisibility={DEFAULT_COLUMN_VISIBILITY}
      search={{
        value: searchQuery,
        onChange: setSearchQuery,
        onSubmit: () => {
          // Seed the shared search store, then navigate. Keeping the query in the store
          // (not the URL) lets /search stay a static export with no server searchParams.
          usePrefs.getState().setSearch(searchQuery.trim())
          router.push("/search")
        },
      }}
      facet={{ columnId: "progress", label: "Status", options: STATUSES }}
      empty={empty}
    />
  )
}
