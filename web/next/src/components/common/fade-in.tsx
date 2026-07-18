"use client"

import { usePathname } from "next/navigation"
import type { ReactNode } from "react"

// Re-mounts on every route change (keyed by pathname) so its CSS fade replays,
// making tab switches fade in smoothly instead of popping in.
export function FadeIn({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  return (
    <div
      key={pathname}
      className="animate-in fade-in-0 flex min-h-0 flex-1 flex-col duration-300 ease-out"
    >
      {children}
    </div>
  )
}
