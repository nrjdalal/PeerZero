import { site } from "@packages/config/site"
import type { Metadata } from "next"

import { InnerProvider, OuterProvider } from "@/app/providers"
import { Navbar } from "@/components/common/navbar"
import { SplashScreen } from "@/components/common/splash-screen"
import { TauriExternalLinks } from "@/components/common/tauri-external-links"
import { UpdateNotice } from "@/components/common/update-notice"
import { dmSans, jetbrainsMono } from "@/lib/fonts"
import { cn } from "@/lib/utils"

import "@/app/globals.css"

export const metadata: Metadata = {
  title: {
    default: `${site.name} - ${site.tagline}`,
    template: `%s | ${site.name}`,
  },
  description: site.description,
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <OuterProvider>
      <html
        className={cn(dmSans.variable, jetbrainsMono.variable, "antialiased")}
        lang="en"
        suppressHydrationWarning
      >
        <body className="min-h-svh">
          {/* Mark macOS-desktop before first paint so the navbar's traffic-light inset
              (globals.css .tauri-mac) applies with no flash. Runs during HTML parse, before
              the navbar below. Inert in the browser (no Tauri global). */}
          <script
            dangerouslySetInnerHTML={{
              __html: `(function(){try{if((window.isTauri||window.__TAURI_INTERNALS__)&&/Mac/i.test(navigator.userAgent))document.documentElement.classList.add("tauri-mac")}catch(e){}})()`,
            }}
          />
          <InnerProvider>
            <TauriExternalLinks />
            <UpdateNotice />
            <Navbar />
            {children}
            <SplashScreen />
          </InnerProvider>
        </body>
      </html>
    </OuterProvider>
  )
}
