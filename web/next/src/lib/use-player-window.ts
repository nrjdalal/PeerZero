"use client"

import { invoke } from "@tauri-apps/api/core"
import type { Window as TauriWindow } from "@tauri-apps/api/window"
import { useCallback, useEffect, useState } from "react"

import {
  MAIN_MIN_SIZE,
  PIP_MIN_SIZE,
  PIP_SIZE,
  pipFrame,
  type Rect,
  type Size,
  toLogical,
} from "@/lib/pip-geometry"

// The native player's window modes: native fullscreen and picture-in-picture (macOS).
//
// PiP: mpv renders into a layer of the app's own window (libmpv render API), so AVKit's system PiP
// cannot take the video. Instead the main window itself becomes the mini player: it floats above
// other apps and follows across desktop Spaces, shrinks to PIP_SIZE in the bottom-right corner of
// its screen, and on exit goes back to exactly where it was.
//
// Every window call is async IPC, so a transition is a sequence of awaits, and there is only ONE
// native window. So the target mode and the window's actual mode live at module level, and every
// transition (PiP and fullscreen alike) runs through one serial queue. A PiP toggle records the
// target and updates the UI at once, and the queued task moves the window toward whatever the target
// is by the time it runs (F stays one toggle per press). P pressed twice in a row therefore nets out
// to nothing instead of racing (a racing second enter would save the already shrunk frame as the one
// to restore), F then P cannot shrink a window that is still animating into fullscreen, and a player
// closed from PiP restores the window before a newly opened one can read its frame.
const mode = { wantPip: false, pipActive: false, restore: null as Rect | null }
let queue: Promise<void> = Promise.resolve()
const enqueue = (task: () => Promise<void>) => {
  queue = queue.then(task).catch((err) => console.error("[player-window]", err))
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const POLL_MS = 50
const SETTLE_TIMEOUT_MS = 3000

// One rejected setter is logged and the rest of the sequence still runs, so it can never leave the
// window stuck floating or small.
const attempt = (what: string, call: Promise<unknown>) =>
  call.catch((err) => console.error(`[player-window] ${what} failed`, err))

async function logicalSize(win: TauriWindow): Promise<Size> {
  const [scale, size] = await Promise.all([win.scaleFactor(), win.innerSize()])
  return { width: toLogical(size.width, scale), height: toLogical(size.height, scale) }
}

// Resolve once the window reports `target` (logical px), or after `timeoutMs`.
async function waitForSize(win: TauriWindow, target: Size, timeoutMs: number) {
  for (let waited = 0; waited < timeoutMs; waited += POLL_MS) {
    const size = await logicalSize(win)
    if (Math.abs(size.width - target.width) < 1 && Math.abs(size.height - target.height) < 1) return
    await sleep(POLL_MS)
  }
}

// setFullscreen resolves while macOS is still animating the window into or out of its fullscreen
// Space. Resolve once the window reports the requested state with a frame that holds still.
async function setFullscreenSettled(win: TauriWindow, on: boolean) {
  const before = await logicalSize(win)
  await win.setFullscreen(on)
  let last = before
  for (let waited = 0; waited < SETTLE_TIMEOUT_MS; waited += POLL_MS) {
    await sleep(POLL_MS)
    const size = await logicalSize(win)
    const moved = size.width !== before.width || size.height !== before.height
    const still = size.width === last.width && size.height === last.height
    if (moved && still && (await win.isFullscreen()) === on) return
    last = size
  }
}

type WindowApi = typeof import("@tauri-apps/api/window")

async function enterPip({
  currentMonitor,
  getCurrentWindow,
  LogicalPosition,
  LogicalSize,
}: WindowApi) {
  const win = getCurrentWindow()
  // Shrinking without leaving fullscreen strands a 480x270 window inside the fullscreen Space instead
  // of floating it over other apps, so leave first.
  if (await win.isFullscreen()) {
    await setFullscreenSettled(win, false)
    // P pressed again while fullscreen was exiting: stay a normal window.
    if (!mode.wantPip) return
  }
  const scale = await win.scaleFactor()
  const size = await win.innerSize()
  const pos = await win.outerPosition()
  const restore = {
    x: toLogical(pos.x, scale),
    y: toLogical(pos.y, scale),
    width: toLogical(size.width, scale),
    height: toLogical(size.height, scale),
  }
  const monitor = await currentMonitor()
  const frame = monitor
    ? pipFrame({
        x: toLogical(monitor.workArea.position.x, monitor.scaleFactor),
        y: toLogical(monitor.workArea.position.y, monitor.scaleFactor),
        width: toLogical(monitor.workArea.size.width, monitor.scaleFactor),
        height: toLogical(monitor.workArea.size.height, monitor.scaleFactor),
      })
    : { x: restore.x, y: restore.y, ...PIP_SIZE }

  // P pressed again (or the player closed) while the frame was being read: nothing changed yet.
  if (!mode.wantPip) return
  // From here on the window is being changed, so a failure must roll back through exitPip().
  mode.restore = restore
  mode.pipActive = true
  // A programmatic resize may go below the main window's 1080x720 floor, but macOS holds user
  // resizing to it, so lower it for as long as the mini player is up.
  await win.setMinSize(new LogicalSize(PIP_MIN_SIZE.width, PIP_MIN_SIZE.height))
  // Also turns the drag region's double-click-to-zoom into a no-op, so a double-click on the mini
  // player cannot blow it up to fill the screen while it floats.
  await win.setMaximizable(false)
  // The fullscreen menu item and its shortcuts bypass toggleFullscreen below (src-tauri/src/pip.rs).
  await invoke("set_fullscreen_allowed", { allowed: false })
  await win.setAlwaysOnTop(true)
  await win.setVisibleOnAllWorkspaces(true)
  await win.setSize(new LogicalSize(frame.width, frame.height))
  await win.setPosition(new LogicalPosition(frame.x, frame.y))
}

async function exitPip({ getCurrentWindow, LogicalPosition, LogicalSize }: WindowApi) {
  const win = getCurrentWindow()
  const restore = mode.restore
  await attempt("setAlwaysOnTop", win.setAlwaysOnTop(false))
  await attempt("setVisibleOnAllWorkspaces", win.setVisibleOnAllWorkspaces(false))
  if (restore) {
    await attempt("setSize", win.setSize(new LogicalSize(restore.width, restore.height)))
    await attempt("setPosition", win.setPosition(new LogicalPosition(restore.x, restore.y)))
    // The resize lands asynchronously on the main thread, while setMinSize grows a smaller window on
    // the spot; wait for the restored size so the floor never enlarges the mini player in its corner.
    await attempt("waitForSize", waitForSize(win, restore, 500))
  }
  await attempt(
    "setMinSize",
    win.setMinSize(new LogicalSize(MAIN_MIN_SIZE.width, MAIN_MIN_SIZE.height)),
  )
  // Zoom and fullscreen come back last, so neither can act on the still-small window mid-restore.
  await attempt("setMaximizable", win.setMaximizable(true))
  await attempt("set_fullscreen_allowed", invoke("set_fullscreen_allowed", { allowed: true }))
  mode.pipActive = false
  mode.restore = null
}

// Move the window toward the current PiP target. `onEnterFailed` resets the caller's UI state.
function reconcilePip(onEnterFailed: () => void) {
  enqueue(async () => {
    if (mode.wantPip === mode.pipActive) return
    const api = await import("@tauri-apps/api/window")
    if (!mode.wantPip) return exitPip(api)
    try {
      await enterPip(api)
    } catch (err) {
      console.error("[player-window] enter picture-in-picture failed", err)
      mode.wantPip = false
      onEnterFailed()
      if (mode.pipActive) await exitPip(api)
    }
  })
}

export function usePlayerWindow() {
  const [pip, setPip] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)

  const togglePip = useCallback(() => {
    mode.wantPip = !mode.wantPip
    setPip(mode.wantPip)
    // Entering PiP always leaves fullscreen first.
    if (mode.wantPip) setFullscreen(false)
    reconcilePip(() => setPip(false))
  }, [])

  const toggleFullscreen = useCallback(() => {
    enqueue(async () => {
      // No fullscreen from, or on the way into, the floating mini player.
      if (mode.wantPip || mode.pipActive) return
      // WKWebView does not enable the HTML Fullscreen API, so toggle the native window instead.
      const { getCurrentWindow } = await import("@tauri-apps/api/window")
      const win = getCurrentWindow()
      await setFullscreenSettled(win, !(await win.isFullscreen()))
      setFullscreen(await win.isFullscreen())
    })
  }, [])

  // Mirror the native fullscreen state into the icon, however it changed: F, leaving fullscreen on the
  // way into PiP, or the system's own green button / menu item. Entering and leaving fullscreen resize
  // the window, so onResized covers every transition (as in components/common/tauri-fullscreen.tsx).
  useEffect(() => {
    let cancelled = false
    let unlisten: (() => void) | undefined
    void (async () => {
      const { getCurrentWindow } = await import("@tauri-apps/api/window")
      const win = getCurrentWindow()
      const sync = async () => {
        try {
          const on = await win.isFullscreen()
          if (!cancelled) setFullscreen(on)
        } catch {
          /* window unavailable (teardown) */
        }
      }
      await sync()
      const un = await win.onResized(() => void sync())
      if (cancelled) un()
      else unlisten = un
    })().catch((err) => console.error("[player-window] fullscreen sync failed", err))
    return () => {
      cancelled = true
      unlisten?.()
    }
  }, [])

  // Closing the player (Back or Esc, or an mpv load error handing off to VLC) while in PiP puts the
  // window back.
  useEffect(
    () => () => {
      mode.wantPip = false
      reconcilePip(() => {})
    },
    [],
  )

  return { pip, fullscreen, togglePip, toggleFullscreen }
}
