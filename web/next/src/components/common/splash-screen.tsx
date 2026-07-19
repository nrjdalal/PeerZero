"use client"

import { useEffect, useState } from "react"

import { Logo } from "@/components/common/logo"
import { cn } from "@/lib/utils"

// A brief branded splash on launch. Rendered in the initial HTML so it covers the very
// first paint (hiding any startup flash), then fades itself out and unmounts.
export function SplashScreen() {
  const [phase, setPhase] = useState<"visible" | "fading" | "gone">("visible")

  useEffect(() => {
    const fade = setTimeout(() => setPhase("fading"), 2000)
    const gone = setTimeout(() => setPhase("gone"), 3000)
    return () => {
      clearTimeout(fade)
      clearTimeout(gone)
    }
  }, [])

  if (phase === "gone") return null

  return (
    <div
      aria-hidden
      className={cn(
        "fixed inset-0 z-100 flex items-center justify-center bg-neutral-950 transition-opacity duration-1000",
        phase === "fading" && "pointer-events-none opacity-0",
      )}
    >
      <div className="relative flex items-center justify-center">
        {/* rotating multi-color glow behind the mark */}
        <div className="absolute size-44 animate-spin rounded-full bg-[conic-gradient(from_0deg,var(--chart-1),var(--chart-3),var(--chart-5),var(--chart-2),var(--chart-1))] opacity-60 blur-2xl [animation-duration:2s]" />
        {/* the brand mark popping in */}
        <div className="animate-in zoom-in-75 fade-in relative duration-700 ease-out">
          <Logo className="size-20 shadow-2xl" />
        </div>
      </div>
    </div>
  )
}
