"use client"

import { useCallback, useEffect, useRef } from "react"

import { usePrefs } from "@/lib/prefs-store"

// Resume-playback: persist a video's last position and restore it on reopen. Used by the native mpv
// player (macOS); it converts mpv's time to SECONDS at the boundary before handing values here.

// Save the position this often while the player is open (plus once more on close).
const SAVE_EVERY_MS = 5000
// Watched to within this many seconds of the end -> forget the position, so a finished video restarts
// from the beginning instead of resuming at the credits. Exported so the player uses the SAME tail to
// tell a genuine end (stop) from a mid-file stall it should recover from (see mpv-player.tsx).
export const FINISHED_TAIL_S = 15
// Resume this many seconds before where you left off, for a moment of context.
const REWIND_S = 5

// Feed `reportTime`/`reportDuration` (seconds) from the player's time/duration events; the hook saves
// on a timer and on unmount. Call `clear()` when the file ends (finished -> no resume). After the file
// loads, read `resumeTarget()` and seek there if it is non-null.
export function useResumePosition(resumeKey: string | undefined) {
  const curRef = useRef(0)
  const durRef = useRef(0)
  const keyRef = useRef(resumeKey)

  const reportTime = useCallback((seconds: number) => {
    curRef.current = seconds
  }, [])
  const reportDuration = useCallback((seconds: number) => {
    durRef.current = seconds
  }, [])

  const save = useCallback(() => {
    const key = keyRef.current
    const c = curRef.current
    const d = durRef.current
    if (!key || c <= 0) return
    if (d > 0 && c >= d - FINISHED_TAIL_S) usePrefs.getState().clearPosition(key)
    else usePrefs.getState().setPosition(key, c)
  }, [])

  // The player reported end-of-file. Two very different things trigger it, told apart by WHERE we are:
  //
  //   - Within FINISHED_TAIL_S of the real end -> the video finished. Forget the position so it restarts
  //     next time, not at the credits, and zero the local time so the periodic + on-close save() can't
  //     re-create a resume point (its last reported time can be more than FINISHED_TAIL_S before the end
  //     if time events stopped early). A later replay reports time again and saves normally.
  //   - Anywhere earlier (mid-file) -> mpv hit the end of the DOWNLOADED data, not the end of the
  //     file: a forward seek outran a still-downloading torrent. That is NOT a finish, so PERSIST the
  //     current spot instead of wiping it - reopening then resumes where you were rather than losing your
  //     place (the "I have to reopen or go back" bug). A stream that catches up just plays on.
  const endOfFile = useCallback(() => {
    const key = keyRef.current
    if (!key) return
    const c = curRef.current
    const d = durRef.current
    if (d > 0 && c > 0 && c < d - FINISHED_TAIL_S) {
      usePrefs.getState().setPosition(key, c)
    } else {
      usePrefs.getState().clearPosition(key)
      curRef.current = 0
    }
  }, [])

  // Seconds to seek to on load, or null when there is nothing worth resuming (no saved position, or so
  // close to the start that the rewind lands at 0 anyway).
  const resumeTarget = useCallback((): number | null => {
    const key = keyRef.current
    const saved = key ? usePrefs.getState().positions[key] : undefined
    return saved != null && saved > REWIND_S ? saved - REWIND_S : null
  }, [])

  // Repoint at a new file. Persist the OUTGOING file's position first (a swap without a close - e.g. a
  // future playlist / autoplay-next - would otherwise lose its last seconds), then drop the old time so
  // a save firing in the new file's load gap can't write the old position under the new key. On mount
  // keyRef already equals resumeKey and curRef is 0, so save() no-ops.
  useEffect(() => {
    save()
    keyRef.current = resumeKey
    curRef.current = 0
    durRef.current = 0
  }, [resumeKey, save])

  // Save every few seconds while mounted, and once on close (the cleanup) to capture the final spot.
  useEffect(() => {
    const iv = setInterval(save, SAVE_EVERY_MS)
    return () => {
      clearInterval(iv)
      save()
    }
  }, [save])

  return { reportTime, reportDuration, endOfFile, resumeTarget }
}
