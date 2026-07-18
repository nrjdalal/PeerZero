import { FadeIn } from "@/components/common/fade-in"
import { TorrentsProvider } from "@/components/torrents/torrents-context"

// Shared shell for the Transfers + Search tabs: one provider owns the single live
// WebSocket so switching tabs never drops or reconnects the feed. The shell is
// full-height (pt-14 clears the fixed navbar) with equal padding on all sides, so
// the grid fills the viewport and scrolls internally instead of the page.
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <TorrentsProvider>
      <main className="flex h-svh flex-col pt-14">
        <div className="flex min-h-0 w-full flex-1 flex-col p-4 md:p-6">
          <FadeIn>{children}</FadeIn>
        </div>
      </main>
    </TorrentsProvider>
  )
}
