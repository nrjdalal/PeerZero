"use client"

import "@vidstack/react/player/styles/default/theme.css"
import "@vidstack/react/player/styles/default/layouts/video.css"
import { RiCloseLine } from "@remixicon/react"
import { type AudioMimeType, MediaPlayer, MediaProvider, type VideoMimeType } from "@vidstack/react"
import { DefaultVideoLayout, defaultLayoutIcons } from "@vidstack/react/player/layouts/default"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

// Inline player (Vidstack) for browser-safe formats (mp4/webm + H.264/AAC). Non-browser-safe files
// (mkv/HEVC/AC3/DTS) are handed to a native player instead (see play-file), so this never receives a
// stream it can't decode. Mounted only while playing, so it releases the stream on close.
//
// A full-screen theater: the Dialog fills the viewport on a black backdrop with no chrome (the video
// letterboxes itself), and a single corner Close returns to the app (Escape/backdrop also close).
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
      <DialogContent
        showCloseButton={false}
        className="flex h-svh w-svw max-w-none items-center justify-center rounded-none border-0 bg-black p-0 ring-0 sm:max-w-none"
      >
        <DialogHeader className="sr-only">
          <DialogTitle>{name}</DialogTitle>
          <DialogDescription>Media player for {name}</DialogDescription>
        </DialogHeader>
        <MediaPlayer
          title={name}
          src={{ src, type: type as AudioMimeType | VideoMimeType }}
          autoPlay
          className="h-full w-full"
        >
          <MediaProvider />
          <DefaultVideoLayout icons={defaultLayoutIcons} />
        </MediaPlayer>
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
