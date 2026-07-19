"use client"

import type { TorrentSnapshot } from "@api/hono"
import {
  RiArrowRightSLine,
  RiFileImageLine,
  RiFileLine,
  RiFileMusicLine,
  RiFilePdf2Line,
  RiFileTextLine,
  RiFileZipLine,
  RiFilmLine,
  RiFolderLine,
  type RemixiconComponentType,
} from "@remixicon/react"
import { type KeyboardEvent, useCallback, useMemo, useRef, useState } from "react"

import { Progress } from "@/components/ui/progress"
import { formatBytes, formatPercent } from "@/lib/format"
import { cn } from "@/lib/utils"

type TorrentFile = TorrentSnapshot["files"][number]

type FileLeaf = {
  type: "file"
  name: string
  length: number
  downloaded: number
  progress: number
}
type FolderNode = {
  type: "folder"
  name: string
  children: TreeNode[]
  length: number
  downloaded: number
}
type TreeNode = FileLeaf | FolderNode

// Build a nested tree from webtorrent file paths. `file.path` is "TorrentName/dir/sub/file.ext"
// (the torrent name is always the top segment). We drop that leading segment since the row already
// shows the torrent name; a single-file torrent then has nothing left, so its leaf uses file.name.
// Exported for its own unit-testability.
export function buildFileTree(files: TorrentFile[], rootName: string): TreeNode[] {
  const root: FolderNode = {
    type: "folder",
    name: rootName,
    children: [],
    length: 0,
    downloaded: 0,
  }
  for (const file of files) {
    const segments = file.path.split(/[/\\]/).filter(Boolean)
    const parts = segments[0] === rootName ? segments.slice(1) : segments
    const leafName = parts.length ? parts[parts.length - 1] : file.name
    const dirs = parts.slice(0, -1)
    let node = root
    for (const dir of dirs) {
      let child = node.children.find((c): c is FolderNode => c.type === "folder" && c.name === dir)
      if (!child) {
        child = { type: "folder", name: dir, children: [], length: 0, downloaded: 0 }
        node.children.push(child)
      }
      node = child
    }
    node.children.push({
      type: "file",
      name: leafName,
      length: file.length,
      downloaded: file.downloaded,
      progress: file.progress,
    })
  }
  // Bottom-up: aggregate each folder's size/downloaded from its children, then sort folders-first.
  const finalize = (folder: FolderNode) => {
    for (const c of folder.children) if (c.type === "folder") finalize(c)
    folder.length = folder.children.reduce((sum, c) => sum + c.length, 0)
    folder.downloaded = folder.children.reduce((sum, c) => sum + c.downloaded, 0)
    folder.children.sort((a, b) =>
      a.type === b.type ? a.name.localeCompare(b.name) : a.type === "folder" ? -1 : 1,
    )
  }
  finalize(root)
  return root.children
}

const VIDEO = new Set(["mp4", "mkv", "avi", "mov", "webm", "m4v", "flv", "wmv"])
const AUDIO = new Set(["mp3", "flac", "wav", "aac", "ogg", "m4a", "opus"])
const IMAGE = new Set(["jpg", "jpeg", "png", "gif", "webp", "bmp", "svg", "heic"])
const ARCHIVE = new Set(["zip", "rar", "7z", "tar", "gz", "bz2", "xz"])
const TEXT = new Set(["txt", "nfo", "md", "srt", "sub", "ass", "vtt"])

function iconForFile(name: string): RemixiconComponentType {
  const ext = name.slice(name.lastIndexOf(".") + 1).toLowerCase()
  if (VIDEO.has(ext)) return RiFilmLine
  if (AUDIO.has(ext)) return RiFileMusicLine
  if (IMAGE.has(ext)) return RiFileImageLine
  if (ARCHIVE.has(ext)) return RiFileZipLine
  if (TEXT.has(ext)) return RiFileTextLine
  if (ext === "pdf") return RiFilePdf2Line
  return RiFileLine
}

// A flattened, currently-visible tree row. `path` is the node's unique slash-joined path from the
// root; the keyboard nav and rendering key off it.
type FlatRow = {
  node: TreeNode
  path: string
  parentPath: string | null
  depth: number
  hasChildren: boolean
  expanded: boolean
}

function flatten(
  nodes: TreeNode[],
  open: ReadonlySet<string>,
  parentPath: string | null = null,
  depth = 0,
  acc: FlatRow[] = [],
): FlatRow[] {
  for (const node of nodes) {
    const path = parentPath ? `${parentPath}/${node.name}` : node.name
    const hasChildren = node.type === "folder" && node.children.length > 0
    const expanded = hasChildren && open.has(path)
    acc.push({ node, path, parentPath, depth, hasChildren, expanded })
    if (expanded && node.type === "folder") flatten(node.children, open, path, depth + 1, acc)
  }
  return acc
}

// Left offset that aligns the tree's first glyph with the Name column's first character: the 48px
// checkbox column plus the 8px cell padding (3.5rem). Each nesting level indents by exactly the
// disclosure-column width (a size-4 chevron plus its gap-2 = 1.5rem), so a child's icon lands
// directly under its parent's name.
const NAME_COLUMN_REM = 3.5
const INDENT_STEP_REM = 1.5
const rowStyle = (depth: number) => ({
  paddingLeft: `${NAME_COLUMN_REM + depth * INDENT_STEP_REM}rem`,
  paddingRight: "1rem",
})

function TreeRow({
  row,
  active,
  registerEl,
  onFocusRow,
  onToggle,
}: {
  row: FlatRow
  active: boolean
  registerEl: (el: HTMLDivElement | null) => void
  onFocusRow: () => void
  onToggle: () => void
}) {
  const { node } = row
  const isFolder = node.type === "folder"
  const progress = isFolder ? (node.length ? node.downloaded / node.length : 0) : node.progress
  const Icon = isFolder ? RiFolderLine : iconForFile(node.name)

  return (
    <div
      ref={registerEl}
      role="treeitem"
      aria-level={row.depth + 1}
      aria-expanded={row.hasChildren ? row.expanded : undefined}
      aria-selected={active}
      tabIndex={active ? 0 : -1}
      onFocus={onFocusRow}
      onClick={() => (row.hasChildren ? onToggle() : onFocusRow())}
      style={rowStyle(row.depth)}
      className={cn(
        "flex cursor-pointer items-center gap-2 py-0.5 outline-none",
        active && "bg-accent",
      )}
    >
      {isFolder ? (
        <RiArrowRightSLine
          className={cn(
            "text-muted-foreground size-4 shrink-0 transition-transform",
            row.expanded && "rotate-90",
          )}
        />
      ) : (
        <span className="size-4 shrink-0" aria-hidden />
      )}
      <Icon className="text-muted-foreground size-4 shrink-0" />
      <span className={cn("min-w-0 flex-1 truncate", isFolder && "font-medium")} title={node.name}>
        {node.name}
      </span>
      <div className="flex shrink-0 items-center gap-2">
        {isFolder ? (
          // Folders reserve the file-bar column so their percent/size line up with file rows.
          <span className="w-20 shrink-0" aria-hidden />
        ) : (
          <Progress value={Math.round(progress * 100)} className="w-20" />
        )}
        <span className="text-muted-foreground w-11 text-right text-xs tabular-nums">
          {formatPercent(progress)}
        </span>
        <span className="text-muted-foreground w-16 text-right text-xs tabular-nums">
          {formatBytes(node.length)}
        </span>
      </div>
    </div>
  )
}

// The file tree rendered in a torrent row's expanded sub-row. It is a flat, roving-tabindex ARIA
// tree: Up/Down move between visible rows, Right expands (or steps in), Left collapses (or steps
// out), Enter/Space toggles a folder, Home/End jump to ends. Folders are collapsed by default and
// the row grows to fit its content. Files/progress come from the live TorrentSnapshot, so per-file
// bars advance in place.
export function TorrentFileTree({ files, rootName }: { files: TorrentFile[]; rootName: string }) {
  const nodes = useMemo(() => buildFileTree(files, rootName), [files, rootName])
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set())
  const rows = useMemo(() => flatten(nodes, open), [nodes, open])

  const [activePath, setActivePath] = useState<string | null>(null)
  // Keep the roving focus valid as rows change; default to the first row.
  const active = rows.some((r) => r.path === activePath) ? activePath : (rows[0]?.path ?? null)

  const rowEls = useRef(new Map<string, HTMLDivElement>())
  const focusRow = useCallback((path: string | null | undefined) => {
    if (!path) return
    setActivePath(path)
    rowEls.current.get(path)?.focus()
  }, [])

  const toggle = useCallback((path: string) => {
    setOpen((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }, [])

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const idx = rows.findIndex((r) => r.path === active)
    if (idx === -1) return
    const row = rows[idx]
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault()
        e.stopPropagation()
        focusRow(rows[Math.min(idx + 1, rows.length - 1)]?.path)
        break
      case "ArrowUp":
        e.preventDefault()
        e.stopPropagation()
        focusRow(rows[Math.max(idx - 1, 0)]?.path)
        break
      case "ArrowRight":
        e.preventDefault()
        e.stopPropagation()
        if (row.hasChildren && !row.expanded) toggle(row.path)
        else if (row.expanded) focusRow(rows[idx + 1]?.path)
        break
      case "ArrowLeft":
        e.preventDefault()
        e.stopPropagation()
        if (row.expanded) toggle(row.path)
        else focusRow(row.parentPath)
        break
      case "Home":
        e.preventDefault()
        e.stopPropagation()
        focusRow(rows[0]?.path)
        break
      case "End":
        e.preventDefault()
        e.stopPropagation()
        focusRow(rows[rows.length - 1]?.path)
        break
      case "Enter":
      case " ":
        if (row.hasChildren) {
          e.preventDefault()
          e.stopPropagation()
          toggle(row.path)
        }
        break
    }
  }

  return (
    <div
      role="tree"
      aria-label={`Files in ${rootName}`}
      className="flex flex-col gap-0.5 text-sm"
      onKeyDown={onKeyDown}
    >
      {rows.map((row) => (
        <TreeRow
          key={row.path}
          row={row}
          active={row.path === active}
          registerEl={(el) => {
            if (el) rowEls.current.set(row.path, el)
            else rowEls.current.delete(row.path)
          }}
          onFocusRow={() => setActivePath(row.path)}
          onToggle={() => {
            setActivePath(row.path)
            toggle(row.path)
          }}
        />
      ))}
    </div>
  )
}
