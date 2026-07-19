"use client"

import { site } from "@packages/config/site"
import {
  RiArrowRightUpFill,
  RiDiscordFill,
  RiGithubFill,
  RiMenuFill,
  RiTwitterXFill,
} from "@remixicon/react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { useState } from "react"

import { Logo } from "@/components/common/logo"
import { ModeToggle } from "@/components/common/mode-toggle"
import { OpenFolderButton } from "@/components/torrents/open-folder-button"
import { SettingsDialog } from "@/components/torrents/settings-dialog"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { usePrefs } from "@/lib/prefs-store"
import { cn, isActive } from "@/lib/utils"

const socialLinks = [
  {
    href: site.social.discord,
    icon: RiDiscordFill,
    label: "Discord",
  },
  {
    href: site.social.github,
    icon: RiGithubFill,
    label: "GitHub",
  },
  {
    href: site.social.x,
    icon: RiTwitterXFill,
    label: "X",
  },
]

function SocialLinks({ onClick }: { onClick?: () => void }) {
  return (
    <div className="flex items-center gap-5 lg:gap-3">
      {socialLinks
        .filter((link) => link.href)
        .map((link) => (
          <Tooltip key={link.href}>
            <TooltipTrigger
              render={
                <a
                  href={link.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-foreground/60 hover:text-foreground transition-colors"
                  aria-label={link.label}
                  onClick={onClick}
                />
              }
            >
              <link.icon className="size-6" aria-hidden="true" />
            </TooltipTrigger>
            <TooltipContent>{link.label}</TooltipContent>
          </Tooltip>
        ))}
    </div>
  )
}

export function Navbar() {
  const pathname = usePathname()
  const [isOpen, setIsOpen] = useState(false)

  // Search is an off-by-default advanced feature (Settings > Advanced > Enable Search); its tab
  // appears after Completed only once enabled.
  const enableSearch = usePrefs((s) => s.enableSearch)

  const navLinks: { href: string; label: string; external?: boolean }[] = [
    { href: "/", label: "Transfers" },
    { href: "/completed", label: "Completed" },
    ...(enableSearch ? [{ href: "/search", label: "Search" }] : []),
  ]

  return (
    <header className="bg-background fixed top-0 left-0 z-50 w-full border-b">
      <div className="flex min-h-14 items-center justify-between px-4 md:px-6">
        {/* Left: logo + primary tabs */}
        <div className="flex items-center gap-8">
          <Link href="/" className="flex items-center gap-2 font-bold">
            <Logo className="size-6" />
            {site.name}
          </Link>
          <nav aria-label="Main navigation" className="hidden items-center gap-6 lg:flex">
            {navLinks.map((link) => {
              const active = !link.external && isActive(pathname, link.href, { exact: false })
              if (link.external) {
                return (
                  <a
                    key={link.href}
                    href={link.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-foreground/60 hover:text-foreground/80 font-medium transition-colors"
                  >
                    {link.label}
                    <RiArrowRightUpFill className="-mt-3 inline size-3.5" />
                  </a>
                )
              }
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={cn(
                    "font-medium transition-colors",
                    active ? "text-foreground" : "hover:text-foreground/80 text-foreground/60",
                  )}
                >
                  {link.label}
                </Link>
              )
            })}
          </nav>
        </div>

        {/* Right: social links + settings + theme toggle + mobile menu */}
        <div className="flex items-center gap-3.5">
          {/* Social Links */}
          <div className="hidden items-center gap-2.5 lg:flex">
            <SocialLinks />
          </div>

          <OpenFolderButton />
          <SettingsDialog />
          <ModeToggle />

          {/* Mobile Navigation */}
          <Sheet open={isOpen} onOpenChange={setIsOpen}>
            <SheetTrigger
              render={
                <Button
                  className="size-8 lg:hidden [&_svg]:size-4!"
                  aria-label="Open menu"
                  size="sm"
                  variant="outline"
                />
              }
            >
              <RiMenuFill aria-hidden="true" />
            </SheetTrigger>
            <SheetContent side="right">
              <SheetHeader>
                <SheetTitle
                  render={
                    <Link
                      href="/"
                      className="-mt-1 flex items-center gap-2 text-2xl font-bold"
                      onClick={() => setIsOpen(false)}
                    />
                  }
                >
                  <Logo className="size-7" />
                  {site.name}
                </SheetTitle>
              </SheetHeader>
              <nav className="ml-4 flex flex-col gap-5">
                {navLinks.map((link) => {
                  const active = !link.external && isActive(pathname, link.href, { exact: false })
                  if (link.external) {
                    return (
                      <a
                        key={link.href}
                        href={link.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-foreground/60 hover:text-foreground/80 font-medium transition-colors"
                        onClick={() => setIsOpen(false)}
                      >
                        {link.label}
                        <RiArrowRightUpFill className="-mt-3 inline size-3.5" />
                      </a>
                    )
                  }
                  return (
                    <Link
                      key={link.href}
                      href={link.href}
                      className={cn(
                        "font-medium transition-colors",
                        active ? "text-foreground" : "hover:text-foreground/80 text-foreground/60",
                      )}
                      onClick={() => setIsOpen(false)}
                    >
                      {link.label}
                    </Link>
                  )
                })}
                {site.social.github && (
                  <Button
                    role="link"
                    size="sm"
                    className="mt-2 w-fit"
                    onClick={() => setIsOpen(false)}
                    render={
                      <a href={site.social.github} target="_blank" rel="noopener noreferrer" />
                    }
                  >
                    <RiGithubFill className="size-4" />
                    Get {site.name}
                  </Button>
                )}
              </nav>
              {/* Mobile Social Links */}
              <div className="mt-2.5 ml-4 flex items-center gap-2.5">
                <SocialLinks onClick={() => setIsOpen(false)} />
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </header>
  )
}
