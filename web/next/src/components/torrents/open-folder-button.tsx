"use client"

import { RiFolderOpenFill } from "@remixicon/react"
import { useMutation } from "@tanstack/react-query"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { apiClient, unwrap } from "@/lib/api/client"

// Navbar quick action: open the current download folder in the OS file manager.
export function OpenFolderButton() {
  const open = useMutation({
    mutationFn: async () => {
      const { error } = await unwrap(apiClient.torrents.open.$post())
      if (error) throw new Error(error.message)
    },
    onError: (e) => toast.error(e.message),
  })
  return (
    <Button
      className="size-8 [&_svg]:size-4!"
      variant="outline"
      size="sm"
      aria-label="Open download folder"
      onClick={() => open.mutate()}
      disabled={open.isPending}
    >
      <RiFolderOpenFill aria-hidden="true" />
    </Button>
  )
}
