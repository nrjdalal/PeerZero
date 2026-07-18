"use client"

import { RiMoonFill, RiSunFill } from "@remixicon/react"
import { useTheme } from "next-themes"

import { Button } from "@/components/ui/button"

export function ModeToggle() {
  const { theme, setTheme } = useTheme()

  const smartToggle = () => {
    /* The smart toggle by @nrjdalal */
    const prefersDarkScheme = window.matchMedia("(prefers-color-scheme: dark)").matches
    if (theme === "system") {
      setTheme(prefersDarkScheme ? "light" : "dark")
    } else if (
      (theme === "light" && !prefersDarkScheme) ||
      (theme === "dark" && prefersDarkScheme)
    ) {
      setTheme(theme === "light" ? "dark" : "light")
    } else {
      setTheme("system")
    }
  }

  return (
    <Button
      className="size-8 [&_svg]:size-4!"
      onClick={smartToggle}
      aria-label="Switch between system/light/dark version"
      size="sm"
      variant="outline"
    >
      <RiSunFill className="dark:hidden" aria-hidden="true" />
      <RiMoonFill className="hidden dark:block" aria-hidden="true" />
    </Button>
  )
}
