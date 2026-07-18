import type { Metadata } from "next"

import { SearchView } from "@/components/torrents/search-view"

export const metadata: Metadata = { title: "Search" }

// Reads ?q= so the Transfers search box (which navigates here on Enter) lands with
// the query already running.
export default async function Page({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams
  return <SearchView initialQuery={q ?? ""} />
}
