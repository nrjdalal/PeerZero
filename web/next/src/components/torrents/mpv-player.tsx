"use client"

import "./player-controls.css"
import {
  RiArrowLeftLine,
  RiClosedCaptioningLine,
  RiForward10Line,
  RiFullscreenExitLine,
  RiFullscreenLine,
  RiPauseFill,
  RiPlayFill,
  RiReplay10Line,
  RiSpeedUpLine,
  RiVolumeMuteFill,
  RiVolumeUpFill,
} from "@remixicon/react"
import { useCallback, useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"

import { Spinner } from "@/components/ui/spinner"
import { mpv } from "@/lib/mpv"
// Pure track + time helpers live in @/lib/mpv-tracks so the subtitle default-pick order and time
// formatting are unit-tested in isolation (tests/web-next/mpv-tracks.test.ts).
import { fmtTime, label, type MpvTrack, pickDefaultSub, type Sub } from "@/lib/mpv-tracks"
import { FINISHED_TAIL_S, useResumePosition } from "@/lib/use-resume-position"
import { useScrubbing } from "@/lib/use-scrubbing"
import { cn } from "@/lib/utils"

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5]
const HIDE_MS = 3000
const CTRL = "cursor-pointer text-white/90 transition hover:text-white"

// The backend observes pause, time-pos, duration, eof-reached, and track-list and re-emits each as an
// `mpv://property` event; we mirror those into React state below.

// Full-screen native player. mpv decodes + renders on a native GL surface behind the transparent webview
// (the libmpv render API); this component is the Netflix-style control overlay that drives it over IPC
// (@/lib/mpv). The only in-app player (macOS-native). Adds .mpv-active to <html>
// so the page goes transparent and the app shell hides while a video plays (see globals.css).
export function MpvPlayer({
  onClose,
  onError,
  src,
  name,
  resumeKey,
  seekable = true,
}: {
  onClose: () => void
  // Fall back to the native-player handoff (VLC) if mpv fails to init/load.
  onError: () => void
  src: string
  name: string
  // Stable per-video id (`${infoHash}:${fileIndex}`) for resume-playback. Omit to disable resume.
  resumeKey?: string
  // False while the file is still downloading: block scrubber seeking (a jump past the downloaded
  // data would stall the read), while the hover time bubble stays. Flips true once the file completes.
  seekable?: boolean
}) {
  const rootRef = useRef<HTMLDivElement>(null)
  const onErrorRef = useRef(onError)
  useEffect(() => {
    onErrorRef.current = onError
  }, [onError])

  const [ready, setReady] = useState(false)
  const [buffering, setBuffering] = useState(true)
  const [playing, setPlaying] = useState(false)
  const [cur, setCur] = useState(0)
  const [dur, setDur] = useState(0)
  const [vol, setVol] = useState(1)
  const [muted, setMuted] = useState(false)
  const [rate, setRate] = useState(1)
  const [fs, setFs] = useState(false)
  const [uiVisible, setUiVisible] = useState(true)
  const [speedOpen, setSpeedOpen] = useState(false)
  const [subOpen, setSubOpen] = useState(false)
  const [subs, setSubs] = useState<Sub[]>([])
  const [activeSub, setActiveSub] = useState<number>(-1)
  // Scrubber hover preview: fraction (0..1) of the bar the cursor is over, or null when not hovering.
  const [hoverFrac, setHoverFrac] = useState<number | null>(null)
  // createPortal targets document.body, which does not exist during Next's static prerender. Render
  // nothing until mounted on the client so the export does not crash (and the portal is client-only).
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  const playingRef = useRef(false)
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const defaultSubApplied = useRef(false)
  // Freshest position/duration for the mpv event callback (which closes over one render's state).
  const curRef = useRef(0)
  const durRef = useRef(0)
  // Debounce for the mid-file-EOF auto-recovery below, so a gap that never fills can't spin.
  const lastRecoverRef = useRef(0)
  // Scrubber drag guard: while dragging, time updates skip setCur (below) so the thumb doesn't jump.
  const { scrubbingRef, scrubberProps } = useScrubbing()
  // Resume-playback: feed it time/duration below, and read resumeTarget()/clear() on load/end.
  const { reportTime, reportDuration, endOfFile, resumeTarget } = useResumePosition(resumeKey)

  // Reveal controls; while playing, schedule them to auto-hide after 3s of no activity.
  const poke = useCallback(() => {
    setUiVisible(true)
    if (hideTimer.current) clearTimeout(hideTimer.current)
    hideTimer.current = setTimeout(() => {
      if (playingRef.current) setUiVisible(false)
    }, HIDE_MS)
  }, [])
  useEffect(() => {
    playingRef.current = playing
    if (!playing) {
      setUiVisible(true)
      if (hideTimer.current) clearTimeout(hideTimer.current)
    } else {
      poke()
    }
  }, [playing, poke])

  // Make the page transparent + hide the app shell for as long as the player is mounted, so the mpv
  // surface behind the webview shows through. Removed on unmount even if mpv teardown throws.
  useEffect(() => {
    document.documentElement.classList.add("mpv-active")
    return () => document.documentElement.classList.remove("mpv-active")
  }, [])

  // Take keyboard focus on mount (for the key controls), and restore it to whatever opened the player
  // when it closes (a11y: focus should return to the trigger, not be dropped on <body>). Captured
  // before we steal focus, so `prev` is the opener - this replaces an `autoFocus` that could not.
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null
    rootRef.current?.focus()
    return () => prev?.focus?.()
  }, [])

  // Subscribe to the backend's mpv property/lifecycle events, load the stream, and always stop playback
  // on unmount so closing halts decode + audio. Effect depends only on src (stable for a given file).
  useEffect(() => {
    let disposed = false
    const unlisteners: Array<() => void> = []
    ;(async () => {
      try {
        unlisteners.push(
          await mpv.onProperty((pname, data) => {
            if (disposed) return
            switch (pname) {
              case "pause":
                setPlaying(!data)
                break
              case "time-pos":
                if (data != null) {
                  const t = Number(data)
                  // A position that moved means mpv is decoding again, so clear any buffering spinner even
                  // if it resumed without a paused-for-cache=false transition (setBuffering(false) no-ops
                  // when already false, so this is free during normal playback).
                  if (t !== curRef.current) setBuffering(false)
                  curRef.current = t
                  if (!scrubbingRef.current) setCur(t)
                  reportTime(t)
                }
                break
              case "duration":
                if (data != null) {
                  const d = Number(data)
                  durRef.current = d
                  setDur(d)
                  reportDuration(d)
                }
                break
              case "paused-for-cache":
                // mpv is waiting on the network cache (the engine is fetching seeked/ahead pieces).
                // Show the buffering spinner; mpv auto-resumes when the data arrives.
                setBuffering(Boolean(data))
                break
              case "eof-reached": {
                if (!data) break
                const c = curRef.current
                const d = durRef.current
                const nearEnd = !(d > 0) || c >= d - FINISHED_TAIL_S
                // Genuine end of file (or unknown duration): stop. The end-file handler decides whether to
                // forget the resume position (a real finish) or keep it (a mid-file stall).
                if (nearEnd || !playingRef.current) {
                  setPlaying(false)
                  break
                }
                // Mid-file EOF while meant to be playing: a forward seek outran the download and mpv gave
                // up (keep-open pauses it at the last frame and it will NOT resume on its own). Re-seek to
                // where we are and unpause to reopen the read from here - the engine now prioritizes these
                // pieces and mpv buffers (network-timeout=0) until they arrive. Debounce so a gap that
                // never fills only nudges every couple of seconds instead of spinning.
                const now = Date.now()
                if (now - lastRecoverRef.current < 2000) break
                lastRecoverRef.current = now
                setBuffering(true)
                void mpv.command(["seek", c, "absolute"]).catch(() => {})
                void mpv.setProperty("pause", false).catch(() => {})
                break
              }
              case "track-list": {
                const list = (Array.isArray(data) ? data : []) as MpvTrack[]
                const subTracks = list.filter((t) => t?.type === "sub")
                setSubs(subTracks.map((t, i) => ({ id: t.id, label: label(t, i) })))
                // Mirror mpv's selection both ways: clear to "Off" (-1) when nothing is selected, so
                // the picker never shows a stale track after subs are turned off.
                const selected = subTracks.find((t) => t.selected)
                setActiveSub(selected ? selected.id : -1)
                // Enable the default English subtitle once, on first track info.
                if (!defaultSubApplied.current && subTracks.length) {
                  defaultSubApplied.current = true
                  const pick = pickDefaultSub(subTracks)
                  if (pick != null) {
                    void mpv.setProperty("sid", pick).catch(() => {})
                    setActiveSub(pick)
                  }
                }
                break
              }
            }
          }),
        )
        unlisteners.push(
          await mpv.onLifecycle((event) => {
            if (disposed) return
            if (event === "file-loaded") {
              setReady(true)
              setBuffering(false)
              // mpv autoplays on load; seed `playing` so the pause toggle + control auto-hide work
              // (mpv only emits a "pause" change-event on an actual transition, not the initial state).
              setPlaying(true)
              // Resume where this file was last left off (a few seconds before). file-loaded fires once
              // per load, so this runs once per open; a manual seek later just overwrites it.
              const target = resumeTarget()
              if (target != null) {
                void mpv.command(["seek", target, "absolute"]).catch(() => {})
              }
            } else if (event === "end-file") {
              setPlaying(false)
              // End of file OR end of downloaded data mid-file: the hook keeps the spot when it is the
              // latter (a forward seek outran the download) so reopening resumes instead of losing it.
              endOfFile()
            }
          }),
        )
        if (disposed) return

        await mpv.load(src)
      } catch (e) {
        // mpv couldn't init/load: fall back to the native-player handoff (VLC).
        console.error("[mpv] load failed", e)
        if (!disposed) onErrorRef.current()
      }
    })()

    return () => {
      disposed = true
      for (const u of unlisteners) {
        try {
          u()
        } catch {}
      }
      // Stop playback so closing halts decode + audio (the render surface stays for the next file).
      void mpv.stop().catch(() => {})
    }
  }, [src, reportTime, reportDuration, resumeTarget, endOfFile])

  const togglePlay = useCallback(() => {
    // Decide + apply from the freshest state. playingRef is otherwise only refreshed a render later
    // (in the [playing] effect), so two quick clicks would both read the pre-click value and the second
    // would undo the first ("works after a click or two"). Update the ref synchronously here and flip
    // the UI optimistically; mpv's echoed "pause" event just confirms it.
    const next = !playingRef.current
    playingRef.current = next
    setPlaying(next)
    void mpv.setProperty("pause", !next).catch(() => {})
    poke()
  }, [poke])
  const seekTo = useCallback(
    (t: number) => {
      const clamped = Math.max(0, Math.min(dur || 0, t))
      setCur(clamped)
      void mpv.command(["seek", clamped, "absolute"]).catch(() => {})
    },
    [dur],
  )
  const skip = useCallback(
    (delta: number) => {
      // No seeking of any kind while the file is still downloading (buttons + arrow keys both route
      // here); a jump past the downloaded data would stall. Re-enabled once the file completes.
      if (!seekable) return
      seekTo((cur || 0) + delta)
      poke()
    },
    [cur, seekTo, poke, seekable],
  )
  // Track where the cursor is over the scrubber, as a 0..1 fraction, to place the hover-preview bubble.
  const onScrubHover = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    if (rect.width <= 0) return
    setHoverFrac(Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)))
  }, [])
  const applyVol = useCallback((v: number, m: boolean) => {
    void mpv.setProperty("mute", m).catch(() => {})
    void mpv.setProperty("volume", Math.round(v * 100)).catch(() => {})
  }, [])
  const changeVol = useCallback(
    (v: number) => {
      setVol(v)
      setMuted(v === 0)
      applyVol(v, v === 0)
      poke()
    },
    [applyVol, poke],
  )
  const toggleMute = useCallback(() => {
    setMuted((m) => {
      const nm = !m
      applyVol(vol, nm)
      return nm
    })
    poke()
  }, [vol, applyVol, poke])
  const changeRate = useCallback(
    (r: number) => {
      void mpv.setProperty("speed", r).catch(() => {})
      setRate(r)
      setSpeedOpen(false)
      poke()
    },
    [poke],
  )
  const chooseSub = useCallback(
    (id: number) => {
      void mpv.setProperty("sid", id < 0 ? "no" : id).catch(() => {})
      setActiveSub(id)
      setSubOpen(false)
      poke()
    },
    [poke],
  )
  const toggleFs = useCallback(() => {
    // WKWebView does not enable the HTML Fullscreen API, so toggle the native Tauri window instead.
    void (async () => {
      const { getCurrentWindow } = await import("@tauri-apps/api/window")
      const win = getCurrentWindow()
      const next = !(await win.isFullscreen())
      await win.setFullscreen(next)
      setFs(next)
    })().catch(() => {})
    poke()
  }, [poke])

  const onKey = useCallback(
    (e: React.KeyboardEvent) => {
      // Let app-global accelerators through (⌘K opens the command palette, etc.); without this the
      // single-key bindings below would hijack the modifier combo, e.g. `k` toggling play on ⌘K.
      if (e.metaKey || e.ctrlKey || e.altKey) return
      switch (e.key) {
        case " ":
        case "k":
          e.preventDefault()
          togglePlay()
          break
        case "ArrowLeft":
          e.preventDefault()
          skip(-10)
          break
        case "ArrowRight":
          e.preventDefault()
          skip(10)
          break
        case "ArrowUp":
          e.preventDefault()
          changeVol(Math.min(1, Math.round((vol + 0.05) * 100) / 100))
          break
        case "ArrowDown":
          e.preventDefault()
          changeVol(Math.max(0, Math.round((vol - 0.05) * 100) / 100))
          break
        case "m":
          toggleMute()
          break
        case "f":
          toggleFs()
          break
        case "Escape":
          onClose()
          break
      }
    },
    [togglePlay, skip, changeVol, vol, toggleMute, toggleFs, onClose],
  )

  const played = dur > 0 ? `${(cur / dur) * 100}%` : "0%"

  // Rendered into a <body>-level portal (a sibling of #pz-app-shell) so it stays visible while the
  // shell is hidden by .mpv-active. Transparent everywhere except the control gradients, so the mpv
  // surface behind the webview shows the video.
  if (!mounted) return null
  return createPortal(
    // biome-ignore lint/a11y: keyboard handled via onKeyDown; this is a media surface, not a button
    <div
      ref={rootRef}
      tabIndex={0}
      onMouseMove={poke}
      onKeyDown={onKey}
      className={cn(
        "fixed inset-0 z-[100] flex items-center justify-center outline-none",
        // Opaque black until the first frame is up (mpv takes ~1s to decode a heavy file). The page is
        // already transparent (.mpv-active), so without this you'd see through the transparent window
        // to the desktop for that second. Once ready, go transparent to reveal the mpv surface behind.
        ready ? "bg-transparent" : "bg-black",
        !uiVisible && playing && "cursor-none",
      )}
    >
      {/* Transparent click surface over the video (mpv draws behind). Click toggles play. */}
      {/* biome-ignore lint/a11y: click-to-pause over the media area, keyboard handled on the root */}
      <div className="absolute inset-0" onClick={togglePlay} />

      {(buffering || !ready) && (
        <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center">
          <Spinner className="size-16 text-[#e50914]" />
        </div>
      )}

      {/* Top scrim + back. data-tauri-drag-region makes this band the window drag handle on desktop. */}
      <div
        data-tauri-drag-region
        className={cn(
          "absolute inset-x-0 top-0 z-30 flex items-start bg-gradient-to-b from-black/70 to-transparent px-6 py-8 pb-20 transition-opacity duration-200",
          uiVisible ? "opacity-100" : "pointer-events-none opacity-0",
        )}
      >
        <button type="button" onClick={onClose} aria-label="Back" className={CTRL}>
          <RiArrowLeftLine className="size-10" />
        </button>
      </div>

      {/* Bottom controls. */}
      <div
        className={cn(
          "absolute inset-x-0 bottom-0 z-30 flex flex-col gap-3 bg-gradient-to-t from-black/90 via-black/50 to-transparent px-6 pt-24 pb-8 text-white transition-opacity duration-200",
          uiVisible ? "opacity-100" : "pointer-events-none opacity-0",
        )}
      >
        <div className="flex items-center gap-4 pt-8">
          {/* biome-ignore lint/a11y/noStaticElementInteractions: decorative hover preview; the range
              input below owns keyboard + pointer seeking, this only positions the timestamp bubble */}
          <div
            className="relative flex-1"
            onMouseMove={onScrubHover}
            onMouseLeave={() => setHoverFrac(null)}
          >
            <input
              type="range"
              min={0}
              max={dur || 0}
              step="any"
              value={cur}
              {...scrubberProps}
              // While downloading, the bar is display-only: no click/drag seek (pointer-events-none lets
              // the mousemove fall through to the hover wrapper so the time bubble still tracks), out of
              // the tab order, and the change is ignored as a belt-and-suspenders guard.
              onChange={(e) => seekable && seekTo(Number(e.target.value))}
              tabIndex={seekable ? undefined : -1}
              aria-label="Seek"
              aria-disabled={!seekable}
              className={cn("nf-scrubber w-full", !seekable && "pointer-events-none")}
              style={{ "--played": played } as React.CSSProperties}
            />
            {/* Hover-preview bubble: the timestamp under the cursor, above the bar (Netflix-style). An
                image thumbnail of that moment will mount above this line in a follow-up. */}
            {hoverFrac != null && dur > 0 && (
              <div
                className="pointer-events-none absolute bottom-full mb-3 flex -translate-x-1/2 flex-col items-center"
                style={{ left: `${hoverFrac * 100}%` }}
              >
                <span className="rounded bg-black/85 px-2 py-1 text-sm text-white tabular-nums shadow-lg ring-1 ring-white/10">
                  {fmtTime(hoverFrac * dur)}
                </span>
              </div>
            )}
          </div>
          <span className="w-20 shrink-0 text-right text-lg text-white/90 tabular-nums">
            {fmtTime(dur - cur)}
          </span>
        </div>

        <div className="relative flex items-center justify-between">
          <div className="flex items-center gap-8">
            <button
              type="button"
              onClick={togglePlay}
              aria-label={playing ? "Pause" : "Play"}
              className={CTRL}
            >
              {playing ? <RiPauseFill className="size-12" /> : <RiPlayFill className="size-12" />}
            </button>
            <button
              type="button"
              onClick={() => skip(-10)}
              disabled={!seekable}
              aria-label="Back 10 seconds"
              className={cn(CTRL, "disabled:pointer-events-none disabled:opacity-40")}
            >
              <RiReplay10Line className="size-10" />
            </button>
            <button
              type="button"
              onClick={() => skip(10)}
              disabled={!seekable}
              aria-label="Forward 10 seconds"
              className={cn(CTRL, "disabled:pointer-events-none disabled:opacity-40")}
            >
              <RiForward10Line className="size-10" />
            </button>
            <div className="group flex items-center gap-2">
              <button
                type="button"
                onClick={toggleMute}
                aria-label={muted ? "Unmute" : "Mute"}
                className={CTRL}
              >
                {muted || vol === 0 ? (
                  <RiVolumeMuteFill className="size-10" />
                ) : (
                  <RiVolumeUpFill className="size-10" />
                )}
              </button>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={muted ? 0 : vol}
                onChange={(e) => changeVol(Number(e.target.value))}
                aria-label="Volume"
                className="nf-volume w-0 opacity-0 transition-all group-hover:w-20 group-hover:opacity-100"
              />
            </div>
          </div>

          <div className="pointer-events-none absolute left-1/2 max-w-[40%] -translate-x-1/2 truncate text-center text-xl font-semibold text-white">
            {name}
          </div>

          <div className="flex items-center gap-8">
            {subs.length > 0 && (
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setSubOpen((o) => !o)}
                  aria-label="Subtitles"
                  className={CTRL}
                >
                  <RiClosedCaptioningLine className="size-10" />
                </button>
                {subOpen && (
                  <div className="absolute right-0 bottom-10 max-h-72 min-w-32 overflow-y-auto rounded-md bg-[#262626] py-1 text-sm shadow-lg">
                    <button
                      type="button"
                      onClick={() => chooseSub(-1)}
                      className={cn(
                        "block w-full cursor-pointer px-4 py-1.5 text-left hover:bg-white/10",
                        activeSub === -1 && "text-[#e50914]",
                      )}
                    >
                      Off
                    </button>
                    {subs.map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => chooseSub(s.id)}
                        className={cn(
                          "block w-full cursor-pointer px-4 py-1.5 text-left hover:bg-white/10",
                          activeSub === s.id && "text-[#e50914]",
                        )}
                      >
                        {s.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            <div className="relative">
              <button
                type="button"
                onClick={() => setSpeedOpen((o) => !o)}
                aria-label="Playback speed"
                className={CTRL}
              >
                <RiSpeedUpLine className="size-10" />
              </button>
              {speedOpen && (
                <div className="absolute right-0 bottom-10 min-w-32 overflow-hidden rounded-md bg-[#262626] py-1 text-sm shadow-lg">
                  {SPEEDS.map((r) => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => changeRate(r)}
                      className={cn(
                        "block w-full cursor-pointer px-4 py-1.5 text-left hover:bg-white/10",
                        rate === r && "text-[#e50914]",
                      )}
                    >
                      {r === 1 ? "Normal" : `${r}x`}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button type="button" onClick={toggleFs} aria-label="Fullscreen" className={CTRL}>
              {fs ? (
                <RiFullscreenExitLine className="size-10" />
              ) : (
                <RiFullscreenLine className="size-10" />
              )}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}
