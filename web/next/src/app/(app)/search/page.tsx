import type { Metadata } from "next"

import { SearchView } from "@/components/torrents/search-view"

export const metadata: Metadata = { title: "Search" }

// The Transfers search box seeds the shared search store before navigating here, so this
// page needs no server-side searchParams and stays part of the static export.
export default function Page() {
  return <SearchView />
}
