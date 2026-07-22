"use client"

import type { TorrentSnapshot } from "@api/hono"
import {
  RiArrowRightSLine,
  RiDeleteBinFill,
  RiDownloadFill,
  RiFileImageLine,
  RiFileLine,
  RiFileMusicLine,
  RiFilePdf2Line,
  RiFileTextLine,
  RiFileZipLine,
  RiFilmLine,
  RiFolderLine,
  RiFolderOpenFill,
  RiPlayFill,
  type RemixiconComponentType,
} from "@remixicon/react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { type KeyboardEvent, type ReactNode, useCallback, useMemo, useRef, useState } from "react"
import { toast } from "sonner"

import type { SubRowColumn } from "@/components/torrents/data-grid"
import { LibmediaPlayer } from "@/components/torrents/libmedia-player"
import { MpvPlayer } from "@/components/torrents/mpv-player"
import { STATUS_BADGE, STATUS_ICON } from "@/components/torrents/torrents-grid"
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
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { apiClient, unwrap } from "@/lib/api/client"
import { formatBytes, formatPercent } from "@/lib/format"
import { openInExternalPlayer, streamUrl } from "@/lib/play-file"
import { cn } from "@/lib/utils"

// Per-file action icons reuse the torrent-row status palette (STATUS_ICON): green once the file is
// fully downloaded (ready to play offline), blue while it is still downloading (streamable).

// One file-row action button: a ghost icon button, non-tabbable so it never steals the tree's roving
// focus, and it stops propagation so a click never toggles/focuses the row. A `null` slot renders a
// same-size spacer so the remaining actions stay column-aligned with the torrent row's actions.
function FileActionButton({
  title,
  onClick,
  children,
}: {
  title: string
  onClick: (() => void) | null
  children: ReactNode
}) {
  if (!onClick) return <span className="size-7 shrink-0" aria-hidden />
  return (
    <Button
      size="icon-sm"
      variant="ghost"
      tabIndex={-1}
      title={title}
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
    >
      {children}
    </Button>
  )
}

// The native mpv surface is macOS-only (the render layer in mpv_render.rs is macOS-only). Other Tauri
// platforms have no render layer, so they fall back to the libmedia player like a plain browser -
// otherwise the transparent window would show an empty page over an audio-only mpv. Read at click time
// (post-hydration), so it never causes a static-export hydration mismatch.
const isMacDesktopApp = () =>
  typeof window !== "undefined" &&
  ("__TAURI_INTERNALS__" in window || "isTauri" in window) &&
  /Mac/i.test(navigator.userAgent)

type TorrentFile = TorrentSnapshot["files"][number]

type FileLeaf = {
  type: "file"
  name: string
  // Position in the torrent's `files` array (== webtorrent `torrent.files[i]`), the stream URL's id.
  index: number
  // The user deleted this file's data: shown disabled with a download to fetch it back.
  deselected: boolean
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
  // `file.index` is the file's position in `torrent.files` (carried by the snapshot); it's the stable
  // id that stream/reveal/download/delete reference, and it survives the folders-first sort below.
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
      index: file.index,
      deselected: file.deselected,
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
  onReveal,
  onDelete,
  onDownload,
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
  // Reveal a file in the OS file manager (the action for non-playable files).
  onReveal: (fileIndex: number) => void
  // Ask to delete a file from disk (the parent shows a confirm).
  onDelete: (fileIndex: number, name: string) => void
  // Re-download a previously-deleted file.
  onDownload: (fileIndex: number) => void
}) {
  const { node } = row
  const isFolder = node.type === "folder"
  const progress = isFolder ? (node.length ? node.downloaded / node.length : 0) : node.progress
  const Icon = isFolder ? RiFolderLine : iconForFile(node.name)
  // A deleted file stays in the tree but disabled: greyed out, no play/open, with a download to
  // fetch it back.
  const deselected = node.type === "file" && node.deselected

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
      // Double-click a file runs its primary action: download it if deleted, else play (playable)
      // or reveal on disk (non-playable).
      onDoubleClick={
        node.type === "file"
          ? () => {
              if (deselected) onDownload(node.index)
              else if (isPlayable(node.name)) onPlay(node.index, node.name)
              else onReveal(node.index)
            }
          : undefined
      }
      style={rowStyle(row.depth)}
      className={cn(
        // Same 32px height as the parent grid rows.
        "flex h-8 cursor-pointer items-center outline-none",
        // Matches the grid's keyboard focus fill (see DataGrid).
        highlighted && "bg-muted",
      )}
    >
      {/* Name cluster fills the Name column (flex), pushing the trailing cells under the real
          Progress/Size/... columns of the parent grid. Greyed out when the file is deleted. */}
      <div
        className={cn(
          "flex min-w-0 flex-1 items-center gap-2 py-1 pr-2",
          deselected && "opacity-50",
        )}
      >
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
        <Icon className="text-muted-foreground size-4 shrink-0" />
        <span
          className={cn("min-w-0 flex-1 truncate text-[13px]", isFolder && "font-medium")}
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
          ) : col.id === "actions" && node.type === "file" ? (
            // Per-file actions in three fixed slots that line up under the torrent row's own actions:
            // slot 1 = download (only for a deleted file), slot 2 = play/open, slot 3 = delete. A null
            // action renders a same-size spacer so every row's icons stay column-aligned.
            <div className="flex w-full items-center justify-end gap-1">
              {/* Slot 1: re-download a deleted file (re-select + resume). */}
              <FileActionButton
                title="Download"
                onClick={deselected ? () => onDownload(node.index) : null}
              >
                <RiDownloadFill className={cn("size-4", STATUS_ICON.Downloading)} />
              </FileActionButton>
              {/* Slot 2: play a playable file, else reveal it on disk (empty for a deleted file). */}
              {isPlayable(node.name) ? (
                <FileActionButton
                  title="Play"
                  onClick={deselected ? null : () => onPlay(node.index, node.name)}
                >
                  <RiPlayFill
                    className={cn(
                      "size-4",
                      progress >= 1 ? STATUS_ICON.Completed : STATUS_ICON.Downloading,
                    )}
                  />
                </FileActionButton>
              ) : (
                <FileActionButton
                  title="Open in folder"
                  onClick={deselected ? null : () => onReveal(node.index)}
                >
                  <RiFolderOpenFill className="text-muted-foreground size-4" />
                </FileActionButton>
              )}
              {/* Slot 3: delete this file's data. */}
              <FileActionButton title="Delete file" onClick={() => onDelete(node.index, node.name)}>
                <RiDeleteBinFill className="text-destructive size-4" />
              </FileActionButton>
            </div>
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
  const [playing, setPlaying] = useState<{ url: string; name: string; key: string } | null>(null)
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
      // key: stable per video for resume-playback (the stream URL's ephemeral port is not).
      setPlaying({ url: streamUrl(infoHash, fileIndex), name, key: `${infoHash}:${fileIndex}` })
    },
    [infoHash],
  )

  const queryClient = useQueryClient()
  // Reveal a single file in the OS file manager (the primary action for non-playable files).
  const revealFile = useCallback(
    (fileIndex: number) => {
      void unwrap(
        apiClient.torrents[":infoHash"].files[":fileIdx"].reveal.$post({
          param: { infoHash, fileIdx: String(fileIndex) },
        }),
      ).then(({ error }) => {
        if (error) toast.error(error.message)
      })
    },
    [infoHash],
  )
  // Re-download a previously-deleted file, then refresh so it flips out of the disabled state.
  const downloadFile = useCallback(
    (fileIndex: number) => {
      void unwrap(
        apiClient.torrents[":infoHash"].files[":fileIdx"].download.$post({
          param: { infoHash, fileIdx: String(fileIndex) },
        }),
      ).then(({ error }) => {
        if (error) toast.error(error.message)
        else queryClient.invalidateQueries({ queryKey: TORRENTS_QUERY_KEY })
      })
    },
    [infoHash, queryClient],
  )
  // Delete a file from disk (confirmed via the dialog below), then refresh so it disappears.
  const [pendingDelete, setPendingDelete] = useState<{ index: number; name: string } | null>(null)
  const deleteFile = useMutation({
    mutationFn: async (fileIndex: number) => {
      const { error } = await unwrap(
        apiClient.torrents[":infoHash"].files[":fileIdx"].$delete({
          param: { infoHash, fileIdx: String(fileIndex) },
        }),
      )
      if (error) throw new Error(error.message)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: TORRENTS_QUERY_KEY })
      toast.success("File deleted")
    },
    onError: (e) => toast.error(e.message),
  })

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
        } else if (row.node.type === "file") {
          // Same primary action as a double-click: download a deleted file, else play it
          // (playable) or reveal it on disk.
          e.preventDefault()
          e.stopPropagation()
          if (row.node.deselected) downloadFile(row.node.index)
          else if (isPlayable(row.node.name)) playFile(row.node.index, row.node.name)
          else revealFile(row.node.index)
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
            onReveal={revealFile}
            onDelete={(index, name) => setPendingDelete({ index, name })}
            onDownload={downloadFile}
          />
        ))}
      </div>
      <AlertDialog open={!!pendingDelete} onOpenChange={(o) => !o && setPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete file?</AlertDialogTitle>
            <AlertDialogDescription>
              Delete <span className="text-foreground font-medium">{pendingDelete?.name}</span> from
              disk. It stays in the list, disabled - download it from its row to fetch it back.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (pendingDelete) deleteFile.mutate(pendingDelete.index)
                setPendingDelete(null)
              }}
            >
              Delete file
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {playing &&
        (isMacDesktopApp() ? (
          // macOS desktop: native mpv (hardware decode of every codec + real subtitle rendering).
          // Falls back to the VLC handoff if mpv can't init/load. See mpv-player.tsx.
          <MpvPlayer
            src={playing.url}
            name={playing.name}
            resumeKey={playing.key}
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
            resumeKey={playing.key}
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
