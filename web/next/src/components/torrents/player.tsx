"use client"

import "@vidstack/react/player/styles/default/theme.css"
import "@vidstack/react/player/styles/default/layouts/video.css"
import { MediaPlayer, MediaProvider } from "@vidstack/react"
import { DefaultVideoLayout, defaultLayoutIcons } from "@vidstack/react/player/layouts/default"

import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

// Inline player (Vidstack) for browser-safe formats (mp4/webm + H.264/AAC). Non-browser-safe files
// (mkv/HEVC/AC3/DTS) are handed to a native player instead (see play-file), so this never receives a
// stream it can't decode. Mounted only while playing, so it releases the stream on close.
export function Player({
  onClose,
  src,
  type,
  name,
}: {
  onClose: () => void
  src: string
  // MIME of the stream (no extension in the URL, so the player needs it to pick its provider).
  type: string
  name: string
}) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle className="truncate pr-6">{name}</DialogTitle>
          <DialogDescription className="sr-only">Media player for {name}</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <MediaPlayer
            title={name}
            src={{ src, type }}
            autoPlay
            className="aspect-video w-full overflow-hidden rounded-lg"
          >
            <MediaProvider />
            <DefaultVideoLayout icons={defaultLayoutIcons} />
          </MediaPlayer>
        </DialogBody>
      </DialogContent>
    </Dialog>
  )
}
