"use client"

import { useSearchParams } from "next/navigation"
import { Suspense } from "react"

import { MpvPlayer } from "@/components/torrents/mpv-player"
import { isMacDesktopApp } from "@/lib/platform"

function PlayerContent() {
  const searchParams = useSearchParams()
  const src = searchParams.get("src")
  const name = searchParams.get("name")
  const resumeKey = searchParams.get("resumeKey")
  const seekable = searchParams.get("seekable") !== "false"

  if (!isMacDesktopApp() || !src) {
    return (
      <div className="text-muted-foreground flex h-screen w-full items-center justify-center">
        Player unavailable.
      </div>
    )
  }

  return (
    <MpvPlayer
      src={src}
      name={name || "Unknown"}
      resumeKey={resumeKey || undefined}
      seekable={seekable}
      onClose={() => {
        // Close the window on exit
        import("@tauri-apps/api/window").then(({ getCurrentWindow }) => {
          getCurrentWindow().close()
        })
      }}
      onError={() => {
        // Fallback or error handled internally, close window
        import("@tauri-apps/api/window").then(({ getCurrentWindow }) => {
          getCurrentWindow().close()
        })
      }}
    />
  )
}

export default function PlayerPage() {
  return (
    <Suspense fallback={<div className="h-screen w-full bg-black" />}>
      <PlayerContent />
    </Suspense>
  )
}
