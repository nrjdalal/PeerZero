"use client"

import "./libmedia-player.css"
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

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Spinner } from "@/components/ui/spinner"
import { cn } from "@/lib/utils"

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5]
const HIDE_MS = 3000

// mm:ss (or h:mm:ss) from milliseconds.
function fmtTime(ms: number): string {
  const s = Math.max(0, Math.floor((Number.isFinite(ms) ? ms : 0) / 1000))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = String(s % 60).padStart(2, "0")
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`
}

const CTRL = "cursor-pointer text-white/90 transition hover:text-white"

// Full-screen Netflix-style player for every playable file. Uses @libmedia (headless) as the decode
// engine - hardware WebCodecs when available, its own WASM otherwise - and draws a custom control
// overlay: red scrubber, play/pause, +-10s, volume, title, subtitles, speed, fullscreen. Controls
// auto-hide after 3s of idle while playing (and the cursor with them), and stay up while paused.
// libmedia's own chrome is hidden in libmedia-player.css. See the design skill "Media player".
export function LibmediaPlayer({
  onClose,
  onError,
  src,
  name,
}: {
  onClose: () => void
  // Fall back to the native-player handoff when libmedia can't load/decode the stream.
  onError: () => void
  src: string
  name: string
}) {
  const boxRef = useRef<HTMLDivElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  // biome ignore: the libmedia instance is used dynamically; typed loosely on purpose.
  const playerRef = useRef<{
    play: () => Promise<void>
    pause: () => Promise<void>
    resume: () => Promise<void>
    seek: (t: bigint) => Promise<void>
    setPlaybackRate: (r: number) => void
    setVolume: (v: number) => void
    selectSubtitle: (id: number) => Promise<void>
    currentTime: bigint
  } | null>(null)
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
  const [subs, setSubs] = useState<{ id: number; label: string }[]>([])
  const [activeSub, setActiveSub] = useState(-1)

  const playingRef = useRef(false)
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Reveal the controls and (while playing) schedule them to auto-hide after 3s of no activity.
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

  // Mount libmedia, wire its events to UI state, and always tear it down on unmount (stop then
  // destroy, race-safe) so closing halts decode + audio. Effect depends only on src (stable).
  useEffect(() => {
    let disposed = false
    let player: { stop?: () => Promise<void>; destroy?: () => Promise<void> } | undefined
    const teardown = (p: typeof player) => {
      if (!p) return
      Promise.resolve()
        .then(() => p.stop?.())
        .catch(() => {})
        .then(() => p.destroy?.())
        .catch(() => {})
    }

    ;(async () => {
      try {
        // Self-hosted ESM entry (see .github/scripts/vendor-libmedia.ts). Bundler-ignored dynamic
        // import so Turbopack doesn't try to resolve/split it; a string var keeps TS from resolving it.
        const entry = "/libmedia/esm/avplayer.js"
        const { default: AVPlayer } = await import(/* turbopackIgnore: true */ entry)
        if (disposed || !boxRef.current) return

        const inst = new AVPlayer({
          container: boxRef.current,
          wasmBaseUrl: "/libmedia",
          enableWorker: true,
        })
        player = inst
        playerRef.current = inst
        if (disposed) return teardown(inst)

        inst.on("loading", () => !disposed && setBuffering(true))
        inst.on("loaded", async () => {
          if (disposed) return
          setDur(Number(inst.getDuration()))
          setReady(true)
          try {
            const info = await inst.getSubtitleList()
            const list: unknown[] = Array.isArray(info) ? info : (info?.list ?? [])
            setSubs(
              list.map((s, i) => {
                const t = s as { id?: number; title?: string; language?: string }
                return { id: t.id ?? i, label: t.title || t.language || `Track ${i + 1}` }
              }),
            )
          } catch {}
        })
        inst.on("playing", () => {
          if (!disposed) {
            setPlaying(true)
            setBuffering(false)
          }
        })
        inst.on("played", () => !disposed && setPlaying(true))
        inst.on("paused", () => !disposed && setPlaying(false))
        inst.on("ended", () => !disposed && setPlaying(false))
        inst.on("seeking", () => !disposed && setBuffering(true))
        inst.on("seeked", () => !disposed && setBuffering(false))
        inst.on("time", () => !disposed && setCur(Number(inst.currentTime)))
        inst.on("error", (e: unknown) => {
          console.error("[libmedia]", e)
          if (!disposed) onErrorRef.current()
        })

        await inst.load(src)
        if (disposed) return teardown(inst)
        await inst.play() // The click that opened this counts as the gesture audio needs.
        if (disposed) teardown(inst)
      } catch (e) {
        console.error("[libmedia] load failed", e)
        if (!disposed) onErrorRef.current()
      }
    })()

    return () => {
      disposed = true
      teardown(player)
      playerRef.current = null
    }
  }, [src])

  useEffect(() => {
    const onFs = () => setFs(!!document.fullscreenElement)
    document.addEventListener("fullscreenchange", onFs)
    return () => document.removeEventListener("fullscreenchange", onFs)
  }, [])

  const applyVol = useCallback(
    (v: number, m: boolean) => playerRef.current?.setVolume(m ? 0 : v),
    [],
  )
  const togglePlay = useCallback(() => {
    const p = playerRef.current
    if (!p) return
    if (playingRef.current) p.pause()
    else p.resume()
    poke()
  }, [poke])
  const skip = useCallback(
    (delta: number) => {
      const p = playerRef.current
      if (!p) return
      const t = Math.max(0, Math.min(dur, Number(p.currentTime) + delta * 1000))
      p.seek(BigInt(Math.round(t)))
      setCur(t)
      poke()
    },
    [dur, poke],
  )
  const seekTo = useCallback(
    (ms: number) => {
      const p = playerRef.current
      if (!p) return
      const t = Math.max(0, Math.min(dur, ms))
      p.seek(BigInt(Math.round(t)))
      setCur(t)
    },
    [dur],
  )
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
      playerRef.current?.setPlaybackRate(r)
      setRate(r)
      setSpeedOpen(false)
      poke()
    },
    [poke],
  )
  const chooseSub = useCallback(
    (id: number) => {
      playerRef.current?.selectSubtitle(id)
      setActiveSub(id)
      setSubOpen(false)
      poke()
    },
    [poke],
  )
  const toggleFs = useCallback(() => {
    if (document.fullscreenElement) document.exitFullscreen()
    else rootRef.current?.requestFullscreen?.()
    poke()
  }, [poke])

  const onKey = useCallback(
    (e: React.KeyboardEvent) => {
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
      }
    },
    [togglePlay, skip, changeVol, vol, toggleMute, toggleFs],
  )

  const played = dur > 0 ? `${(cur / dur) * 100}%` : "0%"

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        showCloseButton={false}
        className="flex h-svh w-svw max-w-none items-center justify-center rounded-none border-0 bg-black p-0 ring-0 sm:max-w-none"
      >
        <DialogHeader className="sr-only">
          <DialogTitle>{name}</DialogTitle>
          <DialogDescription>Media player for {name}</DialogDescription>
        </DialogHeader>

        {/* biome-ignore lint/a11y: keyboard handled via onKeyDown; this is a media surface, not a button */}
        <div
          ref={rootRef}
          tabIndex={0}
          onMouseMove={poke}
          onKeyDown={onKey}
          className={cn(
            "relative flex h-full w-full items-center justify-center bg-black outline-none",
            !uiVisible && playing && "cursor-none",
          )}
        >
          {/* Video surface (libmedia renders its canvas here). Click toggles play. */}
          <div ref={boxRef} onClick={togglePlay} className="h-full w-full" />

          {(buffering || !ready) && (
            <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center">
              <Spinner className="size-16 text-[#e50914]" />
            </div>
          )}

          {/* Top scrim + back */}
          <div
            className={cn(
              "absolute inset-x-0 top-0 z-30 flex items-start bg-gradient-to-b from-black/70 to-transparent px-6 pt-5 pb-20 transition-opacity duration-200",
              uiVisible ? "opacity-100" : "pointer-events-none opacity-0",
            )}
          >
            <button type="button" onClick={onClose} aria-label="Back" className={CTRL}>
              <RiArrowLeftLine className="size-10" />
            </button>
          </div>

          {/* Bottom controls */}
          <div
            className={cn(
              "absolute inset-x-0 bottom-0 z-30 flex flex-col gap-3 bg-gradient-to-t from-black/90 via-black/50 to-transparent px-6 pt-24 pb-6 text-white transition-opacity duration-200",
              uiVisible ? "opacity-100" : "pointer-events-none opacity-0",
            )}
          >
            {/* Scrubber row */}
            <div className="flex items-center gap-4">
              <input
                type="range"
                min={0}
                max={dur || 0}
                value={cur}
                onChange={(e) => seekTo(Number(e.target.value))}
                aria-label="Seek"
                className="nf-scrubber flex-1"
                style={{ "--played": played } as React.CSSProperties}
              />
              <span className="w-16 shrink-0 text-right text-sm text-white/80 tabular-nums">
                {fmtTime(dur - cur)}
              </span>
            </div>

            {/* Button row: left cluster / centered title / right cluster */}
            <div className="relative flex items-center justify-between">
              <div className="flex items-center gap-6">
                <button
                  type="button"
                  onClick={togglePlay}
                  aria-label={playing ? "Pause" : "Play"}
                  className={CTRL}
                >
                  {playing ? (
                    <RiPauseFill className="size-12" />
                  ) : (
                    <RiPlayFill className="size-12" />
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => skip(-10)}
                  aria-label="Back 10 seconds"
                  className={CTRL}
                >
                  <RiReplay10Line className="size-10" />
                </button>
                <button
                  type="button"
                  onClick={() => skip(10)}
                  aria-label="Forward 10 seconds"
                  className={CTRL}
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

              <div className="pointer-events-none absolute left-1/2 max-w-[40%] -translate-x-1/2 truncate text-center text-sm font-medium text-white/90">
                {name}
              </div>

              <div className="flex items-center gap-6">
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
                      <div className="absolute right-0 bottom-10 min-w-32 overflow-hidden rounded-md bg-[#262626] py-1 text-sm shadow-lg">
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
        </div>
      </DialogContent>
    </Dialog>
  )
}
