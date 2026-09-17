// Pure window geometry for the native player's picture-in-picture mode (see use-player-window.ts). All
// values are LOGICAL pixels with a top-left origin, the space Tauri's LogicalSize/LogicalPosition use.
// Dependency-free by design so it is unit-tested headless (tests/web-next/pip-geometry.test.ts).

export type Size = { width: number; height: number }
export type Rect = Size & { x: number; y: number }

// The main window's minimum inner size, set once in desktop/src-tauri/src/lib.rs (`min_inner_size`).
// PiP lowers it while the mini player is up (macOS holds user resizing to it) and puts this back on
// exit, so keep the two in sync.
export const MAIN_MIN_SIZE: Size = { width: 1080, height: 720 }
// The mini player: 16:9 (mpv letterboxes any other aspect), pinned to a screen corner.
export const PIP_SIZE: Size = { width: 480, height: 270 }
// How far the user may drag-resize the mini player down.
export const PIP_MIN_SIZE: Size = { width: 320, height: 180 }
// Gap between the mini player and the edges of the work area.
export const PIP_MARGIN = 16

// Where the mini player goes: the bottom-right corner of the screen's work area (the screen minus the
// menu bar and Dock), inset by PIP_MARGIN. On a work area too small for PIP_SIZE it shrinks, keeping
// 16:9 and never below PIP_MIN_SIZE, and it never starts left of or above the work area.
export function pipFrame(workArea: Rect): Rect {
  const room = {
    width: workArea.width - 2 * PIP_MARGIN,
    height: workArea.height - 2 * PIP_MARGIN,
  }
  const scale = Math.min(1, room.width / PIP_SIZE.width, room.height / PIP_SIZE.height)
  const width = Math.round(Math.max(PIP_MIN_SIZE.width, PIP_SIZE.width * scale))
  const height = Math.round(Math.max(PIP_MIN_SIZE.height, PIP_SIZE.height * scale))
  return {
    x: Math.round(Math.max(workArea.x, workArea.x + workArea.width - PIP_MARGIN - width)),
    y: Math.round(Math.max(workArea.y, workArea.y + workArea.height - PIP_MARGIN - height)),
    width,
    height,
  }
}

// Convert a physical-pixel value to logical pixels at a given scale factor (Retina = 2).
export const toLogical = (physical: number, scaleFactor: number) => physical / (scaleFactor || 1)
