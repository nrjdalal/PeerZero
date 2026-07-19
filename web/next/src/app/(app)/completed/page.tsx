import type { Metadata } from "next"

import { TorrentsGrid } from "@/components/torrents/torrents-grid"

export const metadata: Metadata = { title: "Completed" }

// Finished downloads only: the same grid as Transfers, pre-filtered to completed torrents.
export default function Page() {
  return <TorrentsGrid completed />
}
