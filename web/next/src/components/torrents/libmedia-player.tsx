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

  useEffect(() => {
    let disposed = false
    let player: { destroy: () => Promise<void> } | undefined

    ;(async () => {
      try {
        // Load libmedia's ESM entry from the CDN via a bundler-ignored dynamic import. The player
        // code-splits into numbered chunks (573.avplayer.js, ...) that Turbopack doesn't emit, so
        // importing the npm package fails with a ChunkLoadError; loading from jsdelivr lets the browser
        // resolve those chunks relative to the CDN. A string variable (not a literal) keeps TS from
        // trying to resolve the URL. The self-contained desktop build would self-host this under
        // /public (copied from node_modules/@libmedia/avplayer-ui/dist) instead of hitting a CDN.
        const entry =
          "https://cdn.jsdelivr.net/npm/@libmedia/avplayer-ui@1.3.1/dist/esm/avplayer.js"
        const { default: AVPlayer } = await import(/* turbopackIgnore: true */ entry)
        if (disposed || !boxRef.current) return

        const instance = new AVPlayer({
          container: boxRef.current,
          wasmBaseUrl: "https://cdn.jsdelivr.net/gh/zhaohappy/libmedia@1.3.1/dist",
          // Main-thread pipeline: no worker chunks to copy under Turbopack. Hardware WebCodecs stays
          // on (the default) so HEVC uses the GPU decoder where present, WASM otherwise.
          enableWorker: false,
        })
        player = instance

        instance.on("loaded", () => !disposed && setLoading(false))
        instance.on("playing", () => !disposed && setLoading(false))
        instance.on("error", (e: unknown) => {
          console.error("[libmedia]", e)
          if (!disposed) onError()
        })

        await instance.load(src)
        if (disposed) return
        await instance.play() // Audio needs a user gesture; the ▶ click that opened this usually counts.
      } catch (e) {
        console.error("[libmedia] load failed", e)
        if (!disposed) onError()
      }
    })()

    return () => {
      disposed = true
      player?.destroy()
    }
  }, [src, onError])

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
