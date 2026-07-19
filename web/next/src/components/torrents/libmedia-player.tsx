"use client"

import { RiCloseLine } from "@remixicon/react"
import { useEffect, useRef, useState } from "react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Spinner } from "@/components/ui/spinner"

// In-browser player for files a plain <video> can't decode (mkv/HEVC/AC3/E-AC3/DTS). Powered by
// @libmedia (FFmpeg-compiled-to-WASM + WebCodecs): it uses the hardware WebCodecs decoder when the
// codec is available (e.g. HEVC in a macOS WebView) and its own WASM decoders for the rest (AC3/DTS
// have no WebCodecs path anywhere), so it is the "use what's best" decode engine. Same full-screen
// black theater as the native player; a corner Close returns to the app.
//
// enableWorker:false keeps io/demux/decode/render on the main thread, which avoids emitting libmedia's
// worker chunks (no Turbopack recipe for that yet). wasmBaseUrl points at jsdelivr for the spike; the
// desktop build would self-host dist/{decode,resample} under /public. No COOP/COEP needed (no SAB).
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
  const [loading, setLoading] = useState(true)
  // Keep onError current without making it an effect dependency. The file tree re-renders on every
  // live torrent tick (once a second), so depending on this callback would tear down and rebuild the
  // whole player each second - restarting playback and orphaning half-initialized instances.
  const onErrorRef = useRef(onError)
  useEffect(() => {
    onErrorRef.current = onError
  }, [onError])

  useEffect(() => {
    let disposed = false
    let player: { stop?: () => Promise<void>; destroy?: () => Promise<void> } | undefined

    // Stop playback (halts audio immediately) then fully release. Guarded because stop/destroy can
    // reject when called mid-load, and closing must never leave the AudioContext or decoders running.
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
        // Load libmedia's ESM entry via a bundler-ignored dynamic import. The player code-splits into
        // numbered chunks (573.avplayer.js, ...) and spins up workers that Turbopack doesn't emit, so
        // importing the npm package fails with a ChunkLoadError. We self-host the whole tree under
        // /public/libmedia (see .github/scripts/vendor-libmedia.ts): the browser resolves the chunks, workers,
        // and wasm relative to this same-origin path, so it works fully offline in the desktop build.
        // A string variable (not a literal) keeps TS from trying to resolve the URL.
        const entry = "/libmedia/esm/avplayer.js"
        const { default: AVPlayer } = await import(/* turbopackIgnore: true */ entry)
        if (disposed || !boxRef.current) return

        const instance = new AVPlayer({
          container: boxRef.current,
          // Self-hosted codec wasm: getWasmUrl builds `${wasmBaseUrl}/decode/<codec>-simd.wasm` etc.
          wasmBaseUrl: "/libmedia",
          // Workers move io/demux/decode/render off the main thread so buffering ahead doesn't freeze
          // the UI. Hardware WebCodecs stays on (default) - HEVC on the GPU where present, WASM otherwise.
          enableWorker: true,
        })
        player = instance
        // Closed while the module/instance was still initializing: the cleanup below already ran
        // against an undefined player, so tear this fresh instance down now.
        if (disposed) return teardown(instance)

        instance.on("loaded", () => !disposed && setLoading(false))
        instance.on("playing", () => !disposed && setLoading(false))
        instance.on("error", (e: unknown) => {
          console.error("[libmedia]", e)
          if (!disposed) onErrorRef.current()
        })

        await instance.load(src)
        if (disposed) return teardown(instance)
        await instance.play() // Audio needs a user gesture; the ▶ click that opened this usually counts.
        if (disposed) teardown(instance)
      } catch (e) {
        console.error("[libmedia] load failed", e)
        if (!disposed) onErrorRef.current()
      }
    })()

    return () => {
      disposed = true
      teardown(player)
    }
  }, [src])

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        showCloseButton={false}
        className="flex h-svh w-svw max-w-none items-center justify-center rounded-none border-0 bg-black p-0 ring-0 sm:max-w-none"
      >
        <DialogHeader className="sr-only">
          <DialogTitle>{name}</DialogTitle>
          <DialogDescription>Media player for {name}</DialogDescription>
        </DialogHeader>
        <div ref={boxRef} className="h-full w-full" />
        {loading && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <Spinner className="text-white" />
          </div>
        )}
        <DialogClose
          render={<Button variant="ghost" size="icon" />}
          className="absolute top-4 right-4 z-50 bg-black/40 text-white hover:bg-white/15 hover:text-white"
        >
          <RiCloseLine />
          <span className="sr-only">Close</span>
        </DialogClose>
      </DialogContent>
    </Dialog>
  )
}
