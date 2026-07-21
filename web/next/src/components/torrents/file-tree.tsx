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
  RiPlayFill,
  type RemixiconComponentType,
} from "@remixicon/react"
import { type KeyboardEvent, useCallback, useMemo, useRef, useState } from "react"
import { toast } from "sonner"

import type { SubRowColumn } from "@/components/torrents/data-grid"
import { LibmediaPlayer } from "@/components/torrents/libmedia-player"
import { MpvPlayer } from "@/components/torrents/mpv-player"
import { STATUS_BADGE } from "@/components/torrents/torrents-grid"
import { Badge } from "@/components/ui/badge"
import { formatBytes, formatPercent } from "@/lib/format"
import { openInExternalPlayer, streamUrl } from "@/lib/play-file"
import { cn } from "@/lib/utils"

// Only the desktop (Tauri) shell has the native mpv surface; a plain browser uses the libmedia player.
// Read at click time (post-hydration), so it never causes a static-export hydration mismatch.
const isDesktopApp = () =>
  typeof window !== "undefined" && ("__TAURI_INTERNALS__" in window || "isTauri" in window)

type TorrentFile = TorrentSnapshot["files"][number]

type FileLeaf = {
  type: "file"
  name: string
  // Position in the torrent's `files` array (== webtorrent `torrent.files[i]`), the stream URL's id.
  index: number
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
  // `index` is the file's position in the flat `files` array; it survives the folder sort below and
  // is what the stream URL references (`torrent.files[index]`).
  files.forEach((file, index) => {
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
      index,
      length: file.length,
      downloaded: file.downloaded,
      progress: file.progress,
    })
  })
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

// Video/audio files are "playable": the desktop app streams them to a native player (any codec),
// the browser to the inline <video> (browser-native codecs only).
export function isPlayable(name: string): boolean {
  const ext = name.slice(name.lastIndexOf(".") + 1).toLowerCase()
  return VIDEO.has(ext) || AUDIO.has(ext)
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
})

function TreeRow({
  row,
  columns,
  active,
  highlighted,
  showDisclosure,
  registerEl,
  onFocusRow,
  onToggle,
  onPlay,
}: {
  row: FlatRow
  // The parent grid's visible after-Name columns, so this row's cells sit under the real columns.
  columns: SubRowColumn[]
  // `active` is the roving-tabindex target (always one row); `highlighted` is the visible
  // selection, shown only while the tree holds focus.
  active: boolean
  highlighted: boolean
  // Whether to reserve the folder chevron column. Only when the tree has folders - a flat,
  // folder-less torrent (e.g. a single file) shouldn't look like a collapsed folder.
  showDisclosure: boolean
  registerEl: (el: HTMLDivElement | null) => void
  onFocusRow: () => void
  onToggle: () => void
  // Play a video/audio file (by its `torrent.files` index). A no-op for non-playable files.
  onPlay: (fileIndex: number, name: string) => void
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
      aria-selected={highlighted}
      tabIndex={active ? 0 : -1}
      onFocus={onFocusRow}
      onClick={() => (row.hasChildren ? onToggle() : onFocusRow())}
      style={rowStyle(row.depth)}
      className={cn(
        // Same 32px height as the parent grid rows.
        "flex h-8 cursor-pointer items-center outline-none",
        // Matches the grid's keyboard focus fill (see DataGrid).
        highlighted && "bg-muted",
      )}
    >
      {/* Name cluster fills the Name column (flex), pushing the trailing cells under the real
          Progress/Size/... columns of the parent grid. */}
      <div className="flex min-w-0 flex-1 items-center gap-2 py-1 pr-2">
        {isFolder ? (
          <RiArrowRightSLine
            className={cn(
              "text-muted-foreground size-4 shrink-0 transition-transform",
              row.expanded && "rotate-90",
            )}
          />
        ) : showDisclosure ? (
          <span className="size-4 shrink-0" aria-hidden />
        ) : null}
        {node.type === "file" && isPlayable(node.name) ? (
          // The file icon doubles as a Play button (swaps to ▶ on hover). tabIndex=-1 keeps the
          // tree's roving focus intact.
          <button
            type="button"
            tabIndex={-1}
            onClick={(e) => {
              e.stopPropagation()
              onPlay(node.index, node.name)
            }}
            title={`Play ${node.name}`}
            aria-label={`Play ${node.name}`}
            className="group/play text-muted-foreground hover:text-foreground shrink-0 cursor-pointer"
          >
            <Icon className="size-4 group-hover/play:hidden" />
            <RiPlayFill className="hidden size-4 group-hover/play:block" />
          </button>
        ) : (
          <Icon className="text-muted-foreground size-4 shrink-0" />
        )}
        <span
          className={cn("min-w-0 flex-1 truncate text-sm", isFolder && "font-medium")}
          title={node.name}
        >
          {node.name}
        </span>
      </div>
      {/* One cell per after-Name grid column so Progress/Size land under their headers, reusing the
          grid's own badge + mono size styling. Other columns render an empty spacer. */}
      {columns.map((col) => (
        <div
          key={col.id}
          style={{ width: col.width }}
          className={cn(
            "flex shrink-0 items-center px-2 py-1",
            col.align === "center" && "justify-center",
            col.align === "right" && "justify-end",
          )}
        >
          {col.id === "progress" ? (
            <Badge
              className={cn(
                "w-36 justify-center border-[0.5px] font-normal tabular-nums",
                progress >= 1 ? STATUS_BADGE.Completed : STATUS_BADGE.Downloading,
              )}
            >
              {formatPercent(progress)}
            </Badge>
          ) : col.id === "length" ? (
            <span className="text-muted-foreground font-mono text-xs tabular-nums">
              {formatBytes(node.length)}
            </span>
          ) : null}
        </div>
      ))}
    </div>
  )
}

// The file tree rendered in a torrent row's expanded sub-row. It is a flat, roving-tabindex ARIA
// tree: Up/Down move between visible rows, Right expands (or steps in), Left collapses (or steps
// out), Enter/Space toggles a folder, Home/End jump to ends. Folders are collapsed by default and
// the row grows to fit its content. Files/progress come from the live TorrentSnapshot, so per-file
// bars advance in place.
export function TorrentFileTree({
  files,
  rootName,
  infoHash,
  columns,
  onExitUp,
  onExitDown,
}: {
  files: TorrentFile[]
  rootName: string
  infoHash: string
  // The parent grid's visible after-Name columns, so file rows align under Progress/Size/etc.
  columns: SubRowColumn[]
  // Called at the tree's boundaries so the grid can continue the unified treegrid traversal:
  // onExitUp when Up is pressed on the first row, onExitDown when Down is pressed on the last.
  onExitUp?: () => void
  onExitDown?: () => void
}) {
  const nodes = useMemo(() => buildFileTree(files, rootName), [files, rootName])
  // A folder anywhere means every node sits under a top-level folder, so reserve the chevron
  // column; a folder-less torrent (single file, or flat files) skips it entirely.
  const hasFolders = useMemo(() => nodes.some((node) => node.type === "folder"), [nodes])
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set())
  const rows = useMemo(() => flatten(nodes, open), [nodes, open])

  const [activePath, setActivePath] = useState<string | null>(null)
  // Keep the roving focus valid as rows change; default to the first row.
  const active = rows.some((r) => r.path === activePath) ? activePath : (rows[0]?.path ?? null)
  // Highlight the active row only while the tree holds focus, so a freshly expanded row's tree
  // never renders its first item as "selected" before the user navigates into it.
  const [hasFocus, setHasFocus] = useState(false)
  const [playing, setPlaying] = useState<{ url: string; name: string } | null>(null)
  // Hand the stream to a native player (VLC) on desktop; in a plain browser, tell the user why not.
  const handoff = useCallback((url: string, name: string) => {
    void openInExternalPlayer(url).then((handled) => {
      if (!handled) {
        toast.error(`Can't play ${name}`, {
          description:
            "This file could not be decoded. Open it in the desktop app, or a player like VLC.",
        })
      }
    })
  }, [])
  // Every playable file plays in the in-browser libmedia player (mp4 included) for one consistent UI;
  // it decodes via hardware WebCodecs when available, else its own WASM. The VLC handoff is the
  // fallback only if libmedia can't load/decode the stream (see the LibmediaPlayer onError below).
  const playFile = useCallback(
    (fileIndex: number, name: string) => {
      setPlaying({ url: streamUrl(infoHash, fileIndex), name })
    },
    [infoHash],
  )

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
        // At the last row, hand off to the grid to continue into the next torrent.
        if (idx >= rows.length - 1) onExitDown?.()
        else focusRow(rows[idx + 1]?.path)
        break
      case "ArrowUp":
        e.preventDefault()
        e.stopPropagation()
        // At the first row, hand back to the grid's parent torrent row.
        if (idx <= 0) onExitUp?.()
        else focusRow(rows[idx - 1]?.path)
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
        } else if (row.node.type === "file" && isPlayable(row.node.name)) {
          e.preventDefault()
          e.stopPropagation()
          playFile(row.node.index, row.node.name)
        }
        break
    }
  }

  return (
    <>
      <div
        role="tree"
        aria-label={`Files in ${rootName}`}
        className="flex flex-col gap-0.5 text-sm"
        onKeyDown={onKeyDown}
        onFocus={() => setHasFocus(true)}
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setHasFocus(false)
        }}
      >
        {rows.map((row) => (
          <TreeRow
            key={row.path}
            row={row}
            columns={columns}
            active={row.path === active}
            highlighted={row.path === active && hasFocus}
            showDisclosure={hasFolders}
            registerEl={(el) => {
              if (el) rowEls.current.set(row.path, el)
              else rowEls.current.delete(row.path)
            }}
            onFocusRow={() => setActivePath(row.path)}
            onToggle={() => {
              setActivePath(row.path)
              toggle(row.path)
            }}
            onPlay={playFile}
          />
        ))}
      </div>
      {playing &&
        (isDesktopApp() ? (
          // Desktop: native mpv (hardware decode of every codec + real subtitle rendering). Falls
          // back to the VLC handoff if mpv can't init/load. See mpv-player.tsx.
          <MpvPlayer
            src={playing.url}
            name={playing.name}
            onClose={() => setPlaying(null)}
            onError={() => {
              handoff(playing.url, playing.name)
              setPlaying(null)
            }}
          />
        ) : (
          <LibmediaPlayer
            src={playing.url}
            name={playing.name}
            onClose={() => setPlaying(null)}
            onError={() => {
              // libmedia couldn't load/decode: fall back to the native-player handoff, then close.
              handoff(playing.url, playing.name)
              setPlaying(null)
            }}
          />
        ))}
    </>
  )
}
