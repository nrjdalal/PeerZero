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
  type RowSelectionState,
  type SortingState,
  type Table as TanstackTable,
  type Updater,
  useReactTable,
  type VisibilityState,
} from "@tanstack/react-table"
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react"

import { SourcesDialog } from "@/components/torrents/sources-dialog"
import { useTorrents } from "@/components/torrents/torrents-context"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
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
  selectable = false,
  bulkActions,
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
  // Adds a checkbox column, select-all (header + Cmd/Ctrl+A), and a bulk-actions bar.
  selectable?: boolean
  // Rendered in the bulk bar with the selected rows and a callback to clear the selection.
  bulkActions?: (rows: T[], clear: () => void) => ReactNode
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
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({})
  // Anchor = where a Shift range starts; active = the "cursor" row for arrow-key navigation.
  const [anchorId, setAnchorId] = useState<string | null>(null)
  const [activeId, setActiveId] = useState<string | null>(null)

  // Prepend a checkbox column when the grid is selectable (Transfers manages downloads).
  const allColumns = useMemo<ColumnDef<T>[]>(() => {
    if (!selectable) return columns
    const select: ColumnDef<T> = {
      id: "select",
      size: 40,
      minSize: 40,
      enableSorting: false,
      enableHiding: false,
      header: ({ table }) => (
        <Checkbox
          checked={table.getIsAllRowsSelected()}
          indeterminate={table.getIsSomeRowsSelected() && !table.getIsAllRowsSelected()}
          onCheckedChange={(checked) => table.toggleAllRowsSelected(!!checked)}
          aria-label="Select all"
        />
      ),
      cell: ({ row }) => (
        <Checkbox
          checked={row.getIsSelected()}
          onCheckedChange={(checked) => row.toggleSelected(!!checked)}
          aria-label="Select row"
        />
      ),
    }
    return [select, ...columns]
  }, [selectable, columns])

  const table = useReactTable({
    data,
    columns: allColumns,
    getRowId,
    enableRowSelection: selectable,
    state: { sorting, columnFilters, columnVisibility, rowSelection },
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onColumnVisibilityChange: setColumnVisibility,
    onRowSelectionChange: setRowSelection,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  })

  const nameFilter = (table.getColumn("name")?.getFilterValue() as string) ?? ""
  const facetValue = (table.getColumn(facet.columnId)?.getFilterValue() as string[]) ?? []
  const rows = table.getRowModel().rows
  const rowIds = rows.map((r) => r.id)
  const selectedRows = selectable ? table.getSelectedRowModel().rows.map((r) => r.original) : []

  // Select the ordered range fromId..toId (inclusive), replacing the current selection.
  const selectRange = (ids: string[], fromId: string, toId: string) => {
    const a = ids.indexOf(fromId)
    const b = ids.indexOf(toId)
    if (a === -1 || b === -1) return
    const [lo, hi] = a < b ? [a, b] : [b, a]
    const next: RowSelectionState = {}
    for (let i = lo; i <= hi; i++) next[ids[i]] = true
    setRowSelection(next)
  }

  // The window keydown listener reads live values via a ref so it isn't re-bound each render.
  const navRef = useRef({ rowIds, anchorId, activeId })
  navRef.current = { rowIds, anchorId, activeId }

  // Whole-app keyboard selection: Cmd/Ctrl+A selects all; Up/Down move the active row and
  // Shift+Up/Down extend the range from the anchor. Ignored while typing or inside a menu/dialog.
  useEffect(() => {
    if (!selectable) return
    const onKeyDown = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable))
        return
      if (el?.closest('[role="menu"], [role="dialog"], [role="listbox"], [role="combobox"]')) return
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "a") {
        e.preventDefault()
        table.toggleAllRowsSelected(true)
        return
      }
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return
      const { rowIds, anchorId, activeId } = navRef.current
      if (rowIds.length === 0) return
      e.preventDefault()
      const dir = e.key === "ArrowDown" ? 1 : -1
      const cur = activeId ? rowIds.indexOf(activeId) : -1
      const nextIdx =
        cur === -1
          ? dir === 1
            ? 0
            : rowIds.length - 1
          : Math.min(rowIds.length - 1, Math.max(0, cur + dir))
      const nextId = rowIds[nextIdx]
      if (!nextId) return
      if (e.shiftKey && anchorId) {
        selectRange(rowIds, anchorId, nextId)
      } else {
        setRowSelection({ [nextId]: true })
        setAnchorId(nextId)
      }
      setActiveId(nextId)
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [selectable, table])

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

        {/* Render only once the live connection is confirmed, then fade in via CSS (like
            FadeIn) - so it never flashes from "Connecting" to "Engine online" on load. */}
        {status !== "connecting" && (
          <span className="text-muted-foreground animate-in fade-in-0 flex items-center gap-2 text-sm duration-1000 ease-out">
            <span
              className={cn(
                "size-2 rounded-full",
                status === "online" ? "bg-success" : "bg-destructive",
              )}
              aria-hidden
            />
            <span className="hidden sm:inline">
              {status === "online" ? "Engine online" : "Engine offline"}
            </span>
          </span>
        )}
        {/* Sources (providers/directory/trackers) only matter on Search, not Transfers. */}
        {primaryInput === "search" && <SourcesDialog />}

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

      {selectable && selectedRows.length > 0 && (
        <div className="bg-muted/40 flex items-center gap-3 rounded-lg border px-3 py-1.5">
          <span className="text-sm font-medium">{selectedRows.length} selected</span>
          <div className="ml-auto flex items-center gap-2">
            {bulkActions?.(selectedRows, () => table.resetRowSelection())}
            <Button
              variant="ghost"
              size="sm"
              className="h-8"
              onClick={() => table.resetRowSelection()}
            >
              Clear
            </Button>
          </div>
        </div>
      )}

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
                <TableCell colSpan={allColumns.length} className="h-64 p-0">
                  {empty}
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => (
                <TableRow
                  key={row.id}
                  data-state={row.getIsSelected() ? "selected" : undefined}
                  className={cn(
                    selectable && "cursor-pointer select-none",
                    selectable && activeId === row.id && "ring-primary/40 ring-2 ring-inset",
                  )}
                  onClick={
                    selectable
                      ? (e) => {
                          // Let clicks on interactive content (checkbox, buttons, links) act
                          // normally rather than selecting the row.
                          if ((e.target as HTMLElement).closest("button, a, input, label")) return
                          const id = row.id
                          if (e.shiftKey && anchorId) {
                            selectRange(rowIds, anchorId, id)
                            setActiveId(id)
                          } else if (e.metaKey || e.ctrlKey) {
                            // Toggle: Cmd/Ctrl+Click adds or removes this row from the selection.
                            row.toggleSelected()
                            setAnchorId(id)
                            setActiveId(id)
                          } else {
                            setRowSelection({ [id]: true })
                            setAnchorId(id)
                            setActiveId(id)
                          }
                        }
                      : undefined
                  }
                >
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
