"use client"

import {
  RiArrowDownFill,
  RiArrowUpFill,
  RiCornerDownLeftFill,
  RiExpandUpDownFill,
  RiFilter3Fill,
  RiFilterFill,
  RiSearchFill,
} from "@remixicon/react"
import {
  type Column,
  type ColumnDef,
  type ColumnFiltersState,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  type SortingState,
  type Table as TanstackTable,
  type Updater,
  useReactTable,
  type VisibilityState,
} from "@tanstack/react-table"
import { type ReactNode, useMemo, useState } from "react"

import { SourcesDialog } from "@/components/torrents/sources-dialog"
import { useTorrents } from "@/components/torrents/torrents-context"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { usePrefs } from "@/lib/prefs-store"
import { cn } from "@/lib/utils"

// Sortable column header shared by every grid. Sort direction is read from live table
// state (via `table`), not column.getIsSorted() - that captures a stale table reference.
export function SortHeader<T>({
  column,
  table,
  label,
  align = "left",
}: {
  column: Column<T>
  table: TanstackTable<T>
  label: string
  align?: "left" | "right" | "center"
}) {
  const entry = table.getState().sorting.find((s) => s.id === column.id)
  const sorted: false | "asc" | "desc" = entry ? (entry.desc ? "desc" : "asc") : false
  const icon =
    sorted === "asc" ? (
      <RiArrowUpFill className="size-3.5" />
    ) : sorted === "desc" ? (
      <RiArrowDownFill className="size-3.5" />
    ) : (
      <RiExpandUpDownFill className="text-muted-foreground size-3.5" />
    )
  const justify =
    align === "right" ? "justify-end" : align === "center" ? "justify-center" : "justify-start"
  return (
    <div className={cn("flex", justify)}>
      <Button
        variant="ghost"
        size="sm"
        className={cn("h-7", align === "right" ? "-mr-2" : align === "left" ? "-ml-2" : "")}
        // Reads sort state at click time so it toggles both directions (a captured render
        // value would only ever sort one way).
        onClick={column.getToggleSortingHandler()}
      >
        {/* Right-aligned headers read icon-then-label so the label hugs the edge. */}
        {align === "right" ? (
          <>
            {icon}
            {label}
          </>
        ) : (
          <>
            {label}
            {icon}
          </>
        )}
      </Button>
    </div>
  )
}

// The leftmost search box. When onSubmit is set the box wraps in a <form>
// (Transfers navigates to /search on Enter); otherwise it filters inline (Search).
export type DataGridSearch = {
  value: string
  onChange: (value: string) => void
  onSubmit?: () => void
  pending?: boolean
  placeholder?: string
}

// A faceted (multi-select) filter bound to one column that keeps only rows whose
// value is in the selected set. Transfers uses it for Status, Search for Source.
export type FacetFilter = {
  columnId: string
  label: string
  options: readonly string[]
}

// The single grid used by both tabs. Everything shared lives here once; each tab supplies
// only its columns, data, faceted filter, and empty state.
export function DataGrid<T>({
  data,
  columns,
  columnLabels,
  getRowId,
  search,
  facet,
  storageKey,
  primaryInput = "search",
  initialSorting = [],
  initialColumnVisibility = {},
  tableClassName,
  empty,
}: {
  data: T[]
  columns: ColumnDef<T>[]
  columnLabels: Record<string, string>
  getRowId: (row: T) => string
  search: DataGridSearch
  facet: FacetFilter
  // Namespaces this grid's persisted preferences (sort + visible columns).
  storageKey: string
  // Which input leads the toolbar (leftmost + autofocused). Transfers leads with the
  // name filter (you manage existing torrents); Search leads with the search box.
  primaryInput?: "search" | "filter"
  initialSorting?: SortingState
  initialColumnVisibility?: VisibilityState
  tableClassName?: string
  empty: ReactNode
}) {
  const { status } = useTorrents()
  // Sort + column visibility persist in the store (surviving reloads); column filters stay
  // transient. initialSorting/initialColumnVisibility must be stable references so state doesn't churn.
  const tablePref = usePrefs((s) => s.tables[storageKey])
  const sorting = tablePref?.sorting ?? initialSorting
  // Merge defaults under the stored value: a default still applies to columns the user
  // hasn't toggled, while their choices win.
  const columnVisibility = useMemo(
    () => ({ ...initialColumnVisibility, ...tablePref?.columnVisibility }),
    [initialColumnVisibility, tablePref?.columnVisibility],
  )
  const setSorting = (updater: Updater<SortingState>) =>
    usePrefs.getState().setSorting(storageKey, updater, initialSorting)
  const setColumnVisibility = (updater: Updater<VisibilityState>) =>
    usePrefs.getState().setColumnVisibility(storageKey, updater, initialColumnVisibility)
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([])

  const table = useReactTable({
    data,
    columns,
    getRowId,
    state: { sorting, columnFilters, columnVisibility },
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onColumnVisibilityChange: setColumnVisibility,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  })

  const nameFilter = (table.getColumn("name")?.getFilterValue() as string) ?? ""
  const facetValue = (table.getColumn(facet.columnId)?.getFilterValue() as string[]) ?? []
  const rows = table.getRowModel().rows

  const searchInput = (
    <>
      <RiSearchFill className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2" />
      <Input
        value={search.value}
        onChange={(e) => search.onChange(e.target.value)}
        placeholder={search.placeholder ?? "Search torrents…"}
        className="h-8 w-full pl-9 sm:w-64"
        autoFocus={primaryInput === "search"}
      />
      {search.pending ? (
        <span className="absolute top-1/2 right-3 -translate-y-1/2">
          <Spinner />
        </span>
      ) : (
        // Enter-to-search hint: only when this box submits (Transfers) and has a query, so
        // it's clear that pressing Enter runs the search over on the Search page.
        search.onSubmit &&
        search.value.trim() !== "" && (
          <span className="text-muted-foreground pointer-events-none absolute top-1/2 right-3 -translate-y-1/2">
            <RiCornerDownLeftFill className="size-4" />
          </span>
        )
      )}
    </>
  )
  // Search box: a <form> when onSubmit is set (Transfers navigates to /search on Enter).
  const searchSlot = search.onSubmit ? (
    <form
      className="relative"
      onSubmit={(e) => {
        e.preventDefault()
        search.onSubmit?.()
      }}
    >
      {searchInput}
    </form>
  ) : (
    <div className="relative">{searchInput}</div>
  )
  // Client-side name filter for the current rows.
  const filterSlot = (
    <div className="relative">
      <RiFilterFill className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2" />
      <Input
        value={nameFilter}
        onChange={(e) => table.getColumn("name")?.setFilterValue(e.target.value)}
        placeholder="Filter by name…"
        className="h-8 w-full pl-9 sm:w-64"
        autoFocus={primaryInput === "filter"}
      />
    </div>
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      {/* Toolbar: primary input (leftmost) + sources + engine status; rest on the right */}
      <div className="flex flex-wrap items-center gap-2">
        {primaryInput === "filter" ? filterSlot : searchSlot}

        <SourcesDialog />
        <span className="text-muted-foreground flex items-center gap-2 text-sm">
          <span
            className={cn(
              "size-2 rounded-full",
              status === "online"
                ? "bg-success"
                : status === "offline"
                  ? "bg-destructive"
                  : "bg-muted-foreground",
            )}
            aria-hidden
          />
          <span className="hidden sm:inline">
            {status === "online"
              ? "Engine online"
              : status === "offline"
                ? "Engine offline"
                : "Connecting"}
          </span>
        </span>

        {/* Right: faceted filter + columns + name filter */}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger
              // Nothing to filter (e.g. Source before results) - disable rather than open
              // an empty menu.
              disabled={facet.options.length === 0}
              render={
                <Button variant="outline" size="sm" className="h-8">
                  <RiFilter3Fill className="size-4" />
                  {facet.label}
                  {facetValue.length > 0 && <Badge variant="secondary">{facetValue.length}</Badge>}
                </Button>
              }
            />
            <DropdownMenuContent align="end">
              <DropdownMenuGroup>
                <DropdownMenuLabel>{facet.label}</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {[...facet.options]
                  .sort((a, b) => a.localeCompare(b))
                  .map((o) => (
                    <DropdownMenuCheckboxItem
                      key={o}
                      checked={facetValue.includes(o)}
                      onCheckedChange={(checked) => {
                        const next = checked
                          ? [...facetValue, o]
                          : facetValue.filter((v) => v !== o)
                        table
                          .getColumn(facet.columnId)
                          ?.setFilterValue(next.length ? next : undefined)
                      }}
                    >
                      {o}
                    </DropdownMenuCheckboxItem>
                  ))}
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>

          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button variant="outline" size="sm" className="h-8">
                  Columns
                </Button>
              }
            />
            <DropdownMenuContent align="end">
              {table
                .getAllColumns()
                .filter((c) => c.getCanHide())
                .map((c) => (
                  <DropdownMenuCheckboxItem
                    key={c.id}
                    checked={c.getIsVisible()}
                    onCheckedChange={(v) => c.toggleVisibility(!!v)}
                  >
                    {columnLabels[c.id] ?? c.id}
                  </DropdownMenuCheckboxItem>
                ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => table.resetColumnVisibility()}>
                Reset columns
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Secondary input: the one the primary isn't using. */}
          {primaryInput === "filter" ? searchSlot : filterSlot}
        </div>
      </div>

      {/* Grid - fills the remaining height and scrolls internally so the page doesn't. */}
      <div className="min-h-0 flex-1 overflow-auto rounded-lg border">
        <Table className={cn("table-fixed", tableClassName)}>
          <TableHeader className="bg-background sticky top-0 z-10">
            {table.getHeaderGroups().map((hg) => (
              <TableRow key={hg.id}>
                {hg.headers.map((header) => (
                  <TableHead
                    key={header.id}
                    // Name claims all remaining width (width:100% in a fixed layout), so
                    // every other column stays content-sized and pinned right.
                    style={
                      header.column.id === "name" ? { width: "100%" } : { width: header.getSize() }
                    }
                    className="select-none"
                  >
                    {header.isPlaceholder
                      ? null
                      : flexRender(header.column.columnDef.header, header.getContext())}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={columns.length} className="h-64 p-0">
                  {empty}
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => (
                <TableRow key={row.id}>
                  {row.getVisibleCells().map((cell) => {
                    const align = (cell.column.columnDef.meta as { align?: string } | undefined)
                      ?.align
                    return (
                      <TableCell
                        key={cell.id}
                        className={cn(
                          "truncate",
                          align === "center" && "text-center",
                          (align === "right" || cell.column.id === "actions") && "text-right",
                        )}
                      >
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </TableCell>
                    )
                  })}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
