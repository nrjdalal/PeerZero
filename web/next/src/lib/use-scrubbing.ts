"use client"

import { useMemo, useRef } from "react"

// Scrubber drag guard, shared by both players. While the user drags the seek bar, incoming playback
// time updates must NOT write the current position (or the thumb jumps back to where playback is).
// `scrubbingRef` is true for the duration of a drag; gate the time update with `if (!scrubbingRef.current)`.
// Spread `scrubberProps` onto the range <input>. It resets on every way a drag can end - pointer up,
// pointer cancel (context menu / touch-cancel / gesture or OS takeover), and lost capture - so the flag
// can never get stuck true and permanently freeze the position display.
export function useScrubbing() {
  const scrubbingRef = useRef(false)
  const scrubberProps = useMemo(() => {
    const end = () => {
      scrubbingRef.current = false
    }
    return {
      onPointerDown: () => {
        scrubbingRef.current = true
      },
      onPointerUp: end,
      onPointerCancel: end,
      onLostPointerCapture: end,
    }
  }, [])
  return { scrubbingRef, scrubberProps }
}
