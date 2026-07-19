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
  type ExpandedState,
  flexRender,
  getCoreRowModel,
  getExpandedRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  type RowSelectionState,
  type SortingState,
  type Table as TanstackTable,
  type Updater,
  useReactTable,
  type VisibilityState,
} from "@tanstack/react-table"
import { Fragment, type ReactNode, useEffect, useMemo, useRef, useState } from "react"

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

// Fades the engine-status indicator in only the first time it's shown in a session. The grid
// remounts on every Transfers/Search navigation, so a plain mount animation would re-fade on each
// switch; this flag (survives navigation, resets on a full reload) records that first reveal so
// the fade never replays.
let engineStatusRevealed = false

// Move real DOM focus to the first/last treeitem of a row's expanded sub-row, so keyboard
// navigation flows continuously between the grid's row cursor and a nested tree (WAI-ARIA
// treegrid). Returns false when the row has no rendered sub-row/tree to enter.
function focusSubRowEdge(rowId: string, edge: "first" | "last"): boolean {
  const subRow = document.querySelector(`[data-subrow-of="${rowId}"]`)
  const items = subRow?.querySelectorAll<HTMLElement>('[role="treeitem"]')
  const item = items?.[edge === "first" ? 0 : items.length - 1]
  if (!item) return false
  item.focus()
  return true
}

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

// The visible columns after Name (id, rendered width, alignment), handed to renderSubRow so an
// expanded sub-row can lay its cells out under the same columns as the parent rows instead of
// inventing its own layout.
export type SubRowColumn = { id: string; width: number; align?: "center" | "right" }

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
  renderSubRow,
  getRowCanExpand,
  onRowActivate,
  onRowKey,
  label,
}: {
  data: T[]
  columns: ColumnDef<T>[]
  columnLabels: Record<string, string>
  getRowId: (row: T) => string
  search: DataGridSearch
  // Optional: the Status/Source multi-select. Omitted on single-status grids (e.g. Completed).
  facet?: FacetFilter
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
  // Adds row expansion: a full-width sub-row rendered below an expanded row. The expand
  // affordance lives in the consumer's cells via row.getCanExpand()/getToggleExpandedHandler().
  // `columns` are the visible after-Name columns so the sub-row aligns to the real grid columns.
  renderSubRow?: (
    row: T,
    nav: { onExitUp: () => void; onExitDown: () => void },
    columns: SubRowColumn[],
  ) => ReactNode
  getRowCanExpand?: (row: T) => boolean
  // Fires when Enter hits a highlighted row that has no sub-row to expand - the row's primary
  // action (e.g. Search downloads the result). Arrow navigation runs on every grid regardless.
  onRowActivate?: (row: T) => void
  // Single-key shortcut on the focused row (e.g. p/r/o/Backspace on a torrent). Return true to
  // consume the key. Fires for plain keys not already claimed by the grid model.
  onRowKey?: (key: string, row: T) => boolean
  // Accessible name for the grid (role="grid" aria-label), announced to screen readers.
  label?: string
}) {
  const { status } = useTorrents()
  // Sort + column visibility persist in the store (surviving reloads); column filters stay
  // transient. initialSorting/initialColumnVisibility must be stable references so state doesn't churn.
  const tablePref = usePrefs((s) => s.tables[storageKey])
  // Search is gated behind Settings > Advanced; when off, hide the secondary "Search torrents…" box.
  const enableSearch = usePrefs((s) => s.enableSearch)
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
  // Fade the engine-status indicator in only on its first reveal this session (see
  // engineStatusRevealed). Captured at mount so it's stable across re-renders/StrictMode;
  // navigation remounts find the flag already set and show the status instantly instead of
  // re-fading on every page switch.
  const [animateStatus] = useState(() => !engineStatusRevealed)
  if (status !== "connecting") engineStatusRevealed = true
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({})
  // Which rows are expanded (keyed by getRowId). Survives live data updates since the id is stable.
  const [expanded, setExpanded] = useState<ExpandedState>({})
  // Anchor = where a Shift range starts; active = the "cursor" row for arrow-key navigation.
  const [anchorId, setAnchorId] = useState<string | null>(null)
  const [activeId, setActiveId] = useState<string | null>(null)

  // Prepend a checkbox column when the grid is selectable (Transfers manages downloads).
  const allColumns = useMemo<ColumnDef<T>[]>(() => {
    if (!selectable) return columns
    const select: ColumnDef<T> = {
      id: "select",
      size: 48,
      minSize: 48,
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
    state: { sorting, columnFilters, columnVisibility, rowSelection, expanded },
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onColumnVisibilityChange: setColumnVisibility,
    onRowSelectionChange: setRowSelection,
    onExpandedChange: setExpanded,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    // No getSubRows: the expanded content is a manual full-width sub-row, so expanded rows never
    // enter getRowModel().rows - arrow-key nav and selection stay 1:1 with data rows.
    getExpandedRowModel: getExpandedRowModel(),
    getRowCanExpand: getRowCanExpand
      ? (row) => getRowCanExpand(row.original)
      : () => Boolean(renderSubRow),
  })

  const nameFilter = (table.getColumn("name")?.getFilterValue() as string) ?? ""
  const facetValue = facet
    ? ((table.getColumn(facet.columnId)?.getFilterValue() as string[]) ?? [])
    : []
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
  // Latest onRowActivate, read by the window listener without re-binding it each render.
  const activateRef = useRef(onRowActivate)
  activateRef.current = onRowActivate
  const rowKeyRef = useRef(onRowKey)
  rowKeyRef.current = onRowKey
  // Stable DOM id per row so the grid can point aria-activedescendant at the focus cursor.
  const rowDomId = (id: string) => `${storageKey}-row-${id}`

  // Boundary callbacks handed to each expanded sub-row so its tree can continue the treegrid
  // traversal: exiting up returns the cursor to this row, exiting down advances to the next row.
  const makeSubRowNav = (rowId: string) => ({
    onExitUp: () => {
      ;(document.activeElement as HTMLElement | null)?.blur()
      setActiveId(rowId)
      setAnchorId(rowId)
    },
    onExitDown: () => {
      const ids = navRef.current.rowIds
      const nextId = ids[ids.indexOf(rowId) + 1]
      if (!nextId) return
      ;(document.activeElement as HTMLElement | null)?.blur()
      setActiveId(nextId)
      setAnchorId(nextId)
    },
  })

  // Keyboard model (WAI-ARIA grid pattern, mirroring AG Grid / DataTables / Windows Explorer),
  // identical on every grid: Up/Down move the focus cursor, Enter opens the focused row's sub-row
  // or - when it has none - fires its primary action (onRowActivate, e.g. download on Search). The
  // selection extras run only on `selectable` grids (Transfers/Completed): Space toggles the focused
  // row, Shift+Up/Down extend the range from the anchor, and Cmd/Ctrl+A selects all. Navigation
  // never selects on its own. Ignored while typing - except Up/Down, which hand off from the
  // search/filter box into the grid - and when focus is on a control that owns the key (a button,
  // the file tree, a menu).
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      const inField =
        !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)
      // Up/Down move from a text field (the search/filter box) into the grid; every other key is
      // left to the field while typing.
      if (inField) {
        if (e.key === "ArrowDown" || e.key === "ArrowUp") el.blur()
        else return
      }
      if (
        el?.closest(
          'button, a, [role="checkbox"], [role="menu"], [role="dialog"], [role="listbox"], [role="combobox"], [role="tree"]',
        )
      )
        return
      const { rowIds, anchorId, activeId } = navRef.current
      if (rowIds.length === 0) return

      // Select-all is a selection action - selectable grids only.
      if (selectable && (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "a") {
        e.preventDefault()
        table.toggleAllRowsSelected(true)
        return
      }

      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault()
        const dir = e.key === "ArrowDown" ? 1 : -1
        const cur = activeId ? rowIds.indexOf(activeId) : -1

        // Treegrid traversal (plain moves only): Down descends into the current row's expanded
        // tree; Up lands on the last item of the previous row's expanded tree. The tree then owns
        // the keys until it hands focus back at its boundaries (see makeSubRowNav).
        if (!e.shiftKey) {
          const byId = table.getRowModel().rowsById
          // Descending hands real focus to the tree; drop the grid cursor so its row highlight
          // doesn't linger behind the tree's own focus highlight.
          if (dir === 1) {
            if (activeId && byId[activeId]?.getIsExpanded() && focusSubRowEdge(activeId, "first")) {
              setActiveId(null)
              return
            }
          } else {
            const prevId = cur <= 0 ? undefined : rowIds[cur - 1]
            if (prevId && byId[prevId]?.getIsExpanded() && focusSubRowEdge(prevId, "last")) {
              setActiveId(null)
              return
            }
          }
        }

        const nextIdx =
          cur === -1
            ? dir === 1
              ? 0
              : rowIds.length - 1
            : Math.min(rowIds.length - 1, Math.max(0, cur + dir))
        const nextId = rowIds[nextIdx]
        if (!nextId) return
        // Shift extends the selection as the cursor moves (selectable grids); a plain move only
        // repositions the anchor.
        if (e.shiftKey && anchorId && selectable) selectRange(rowIds, anchorId, nextId)
        else setAnchorId(nextId)
        setActiveId(nextId)
        return
      }

      // Space toggles the focused row's selection - selectable grids only.
      if (selectable && (e.key === " " || e.key === "Spacebar")) {
        const row = activeId ? table.getRowModel().rowsById[activeId] : undefined
        if (!row) return
        e.preventDefault()
        row.toggleSelected()
        setAnchorId(activeId)
        return
      }

      if (e.key === "Enter") {
        const row = activeId ? table.getRowModel().rowsById[activeId] : undefined
        if (!row) return
        // An expandable row (the Transfers file tree) opens/closes; otherwise fire the row's
        // primary action (Search downloads the highlighted result).
        if (row.getCanExpand()) {
          e.preventDefault()
          row.toggleExpanded()
        } else if (activateRef.current) {
          e.preventDefault()
          activateRef.current(row.original)
        }
        return
      }

      // Consumer row shortcuts on the focused row (e.g. p/r/o/Backspace on a torrent). Plain keys
      // only; modifiers, arrows, Space, Enter and Cmd/Ctrl+A are handled above.
      if (rowKeyRef.current && activeId && !e.metaKey && !e.ctrlKey && !e.altKey) {
        const row = table.getRowModel().rowsById[activeId]
        if (row && rowKeyRef.current(e.key, row.original)) e.preventDefault()
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [selectable, table])

  const searchInput = (
    <>
      <RiSearchFill className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2" />
      <Input
        // biome-ignore lint/a11y/noAutofocus: this is the view's leading input; focusing it on
        // mount makes the app type-ready, matching a keyboard-first desktop app.
        autoFocus={primaryInput === "search"}
        value={search.value}
        onChange={(e) => search.onChange(e.target.value)}
        placeholder={search.placeholder ?? "Search torrents…"}
        className="h-8 w-full pl-9 sm:w-64"
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
        // biome-ignore lint/a11y/noAutofocus: leading input on Transfers; type-ready on mount.
        autoFocus={primaryInput === "filter"}
        value={nameFilter}
        onChange={(e) => table.getColumn("name")?.setFilterValue(e.target.value)}
        placeholder="Filter by name…"
        className="h-8 w-full pl-9 sm:w-64"
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
          <span
            className={cn(
              "text-muted-foreground ml-2 flex items-center gap-2 text-sm",
              // Fade in on the first reveal only; instant on later navigation mounts (no re-flicker).
              animateStatus && "animate-in fade-in-0 duration-1000 ease-out",
            )}
          >
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
          {facet && (
            <DropdownMenu>
              <DropdownMenuTrigger
                // Nothing to filter (e.g. Source before results) - disable rather than open
                // an empty menu.
                disabled={facet.options.length === 0}
                render={
                  <Button variant="outline" size="sm" className="h-8">
                    <RiFilter3Fill className="size-4" />
                    {facet.label}
                    {facetValue.length > 0 && (
                      <Badge variant="secondary">{facetValue.length}</Badge>
                    )}
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
          )}

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
          {primaryInput === "filter" ? (enableSearch ? searchSlot : null) : filterSlot}
        </div>
      </div>

      {/* Bulk-action dock: floats at the bottom over the content (like the macOS Dock) so showing
          it never shifts the table. Fixed to the viewport, centered, pointer-through around it. */}
      {selectable && selectedRows.length > 0 && (
        <div className="pointer-events-none fixed inset-x-0 bottom-10 z-50 flex justify-center px-4">
          <div className="bg-popover text-popover-foreground animate-in fade-in-0 slide-in-from-bottom-4 pointer-events-auto flex items-center gap-3 rounded-full border py-2 pr-2 pl-4 shadow-lg">
            <span className="text-sm font-medium">{selectedRows.length} selected</span>
            <div className="flex items-center gap-2">
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
        </div>
      )}

      {/* Grid - fills the remaining height and scrolls internally so the page doesn't. */}
      <div className="min-h-0 flex-1 overflow-auto rounded-lg border">
        {/* aria-activedescendant grid: focus stays on the table while the arrow-key cursor
            (activeId) moves; the active row's DOM id is announced. Focusing the grid drops the
            cursor onto the first row so there's always something to move from. */}
        <Table
          role="grid"
          aria-label={label}
          aria-multiselectable={selectable || undefined}
          aria-activedescendant={activeId ? rowDomId(activeId) : undefined}
          tabIndex={0}
          onFocus={(e) => {
            if (e.target === e.currentTarget && !activeId && rowIds.length) setActiveId(rowIds[0])
          }}
          className={cn("table-fixed focus-visible:outline-none", tableClassName)}
        >
          <TableHeader className="bg-background sticky top-0 z-10">
            {table.getHeaderGroups().map((hg) => (
              <TableRow key={hg.id} role="row">
                {hg.headers.map((header, i) => (
                  <TableHead
                    key={header.id}
                    role="columnheader"
                    // Name claims all remaining width (width:100% in a fixed layout), so
                    // every other column stays content-sized and pinned right.
                    style={
                      header.column.id === "name" ? { width: "100%" } : { width: header.getSize() }
                    }
                    // Extra left inset on the first column so it doesn't hug the table border.
                    className={cn("select-none", i === 0 && "pl-4")}
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
              <TableRow role="row" className="hover:bg-transparent">
                <TableCell role="gridcell" colSpan={allColumns.length} className="h-64 p-0">
                  {empty}
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => (
                <Fragment key={row.id}>
                  <TableRow
                    role="row"
                    id={rowDomId(row.id)}
                    data-state={row.getIsSelected() ? "selected" : undefined}
                    aria-selected={selectable ? row.getIsSelected() : undefined}
                    className={cn(
                      renderSubRow && "select-none",
                      row.getCanExpand() && "cursor-pointer",
                      // Selection (checkbox) gets a subtle half-opacity fill; the keyboard focus
                      // cursor is a full fill that always wins, so it stays visible even on a
                      // selected row. (--accent == --muted in this theme, which is why a plain
                      // bg-accent was indistinguishable from the selected-row background.)
                      "data-[state=selected]:bg-muted/50",
                      activeId === row.id && "bg-muted data-[state=selected]:bg-muted",
                    )}
                    onClick={
                      renderSubRow
                        ? (e) => {
                            // Clicks on interactive content (checkbox, action buttons, links) act
                            // normally. A bare row click opens/closes this row's sub-row (the file
                            // tree); selection is left to the checkbox and keyboard.
                            if ((e.target as HTMLElement).closest("button, a, input, label")) return
                            if (row.getCanExpand()) row.toggleExpanded()
                          }
                        : undefined
                    }
                  >
                    {row.getVisibleCells().map((cell, i) => {
                      const align = (cell.column.columnDef.meta as { align?: string } | undefined)
                        ?.align
                      return (
                        <TableCell
                          key={cell.id}
                          role="gridcell"
                          // The checkbox cell selects; swallow its clicks so they don't also toggle
                          // the row's expansion.
                          onClick={
                            cell.column.id === "select" ? (e) => e.stopPropagation() : undefined
                          }
                          className={cn(
                            // Uniform 32px row height across every grid (downloads / completed /
                            // search); h-8 floors rows with short content, the tight py keeps the
                            // 28px action buttons from growing past it.
                            "h-8 truncate py-0.5",
                            // Match the header's first-column inset.
                            i === 0 && "pl-4",
                            align === "center" && "text-center",
                            (align === "right" || cell.column.id === "actions") && "text-right",
                          )}
                        >
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </TableCell>
                      )
                    })}
                  </TableRow>
                  {row.getIsExpanded() &&
                    renderSubRow && (
                      // The tree's folders carry aria-expanded; neutralize the base row's
                      // has-aria-expanded / hover tints so an open folder never shades the whole tree.
                      <TableRow
                        role="row"
                        className="hover:bg-transparent has-aria-expanded:bg-transparent"
                        data-subrow-of={row.id}
                      >
                        <TableCell
                          role="gridcell"
                          colSpan={row.getVisibleCells().length}
                          className="p-0"
                        >
                          {renderSubRow(
                            row.original,
                            makeSubRowNav(row.id),
                            // Visible columns after Name, so the sub-row aligns to the real grid.
                            row
                              .getVisibleCells()
                              .slice(
                                row.getVisibleCells().findIndex((c) => c.column.id === "name") + 1,
                              )
                              .map((c) => ({
                                id: c.column.id,
                                width: c.column.getSize(),
                                align: (c.column.columnDef.meta as { align?: "center" | "right" })
                                  ?.align,
                              })),
                          )}
                        </TableCell>
                      </TableRow>
                    )}
                </Fragment>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
