import type { Metadata } from "next"
import { Suspense } from "react"

import { SearchView } from "@/components/torrents/search-view"

export const metadata: Metadata = { title: "Search" }

// SearchView reads the ?q= deep link via useSearchParams, so it sits under a Suspense
// boundary (required for that hook in the static export build).
export default function Page() {
  return (
    <Suspense>
      <SearchView />
    </Suspense>
  )
}
