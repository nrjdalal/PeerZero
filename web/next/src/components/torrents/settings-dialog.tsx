"use client"

import { RiFolderOpenFill, RiSettings3Fill } from "@remixicon/react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useEffect, useState } from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { apiClient, unwrap } from "@/lib/api/client"

// Download-location settings. The location applies to new torrents only; existing torrents
// keep whatever folder they were added with (the engine stores each torrent's own path).
export function SettingsDialog() {
  const [open, setOpen] = useState(false)
  const [dir, setDir] = useState("")
  const queryClient = useQueryClient()

  const { data, isLoading } = useQuery({
    queryKey: ["torrent-settings"],
    enabled: open,
    queryFn: async () => {
      const { data, error } = await unwrap(apiClient.torrents.settings.$get())
      if (error) throw new Error(error.message)
      return data
    },
  })

  // Seed the input from the loaded setting once it arrives.
  useEffect(() => {
    if (data?.downloadDir) setDir(data.downloadDir)
  }, [data?.downloadDir])

  const save = useMutation({
    mutationFn: async (downloadDir: string) => {
      const { data, error } = await unwrap(
        apiClient.torrents.settings.$put({ json: { downloadDir } }),
      )
      if (error) throw new Error(error.message)
      return data
    },
    onSuccess: (data) => {
      setDir(data.downloadDir)
      queryClient.invalidateQueries({ queryKey: ["torrent-settings"] })
      toast.success("Download folder updated")
    },
    onError: (e) => toast.error(e.message),
  })

  const openFolder = useMutation({
    mutationFn: async () => {
      const { error } = await unwrap(apiClient.torrents.open.$post())
      if (error) throw new Error(error.message)
    },
    onError: (e) => toast.error(e.message),
  })

  // Native OS folder picker (via the engine); sets the download folder on selection.
  const browse = useMutation({
    mutationFn: async () => {
      const { data, error } = await unwrap(apiClient.torrents["choose-dir"].$post())
      if (error) throw new Error(error.message)
      return data
    },
    onSuccess: (data) => {
      setDir(data.downloadDir)
      if (data.chosen) {
        queryClient.invalidateQueries({ queryKey: ["torrent-settings"] })
        toast.success("Download folder updated")
      }
    },
    onError: (e) => toast.error(e.message),
  })

  const dirty = dir.trim() !== "" && dir.trim() !== data?.downloadDir

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button
            className="size-8 [&_svg]:size-4!"
            variant="outline"
            size="sm"
            aria-label="Settings"
          />
        }
      >
        <RiSettings3Fill aria-hidden="true" />
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>
            Where new downloads are saved. Existing torrents keep their current folder.
          </DialogDescription>
        </DialogHeader>
        {isLoading ? (
          <div className="flex justify-center py-6">
            <Spinner />
          </div>
        ) : (
          <Field>
            <FieldLabel htmlFor="download-dir">Download folder</FieldLabel>
            <div className="flex gap-2">
              <Input
                id="download-dir"
                value={dir}
                onChange={(e) => setDir(e.target.value)}
                placeholder="~/Downloads/PeerZero"
              />
              <Button variant="outline" onClick={() => browse.mutate()} disabled={browse.isPending}>
                {browse.isPending ? <Spinner /> : "Browse…"}
              </Button>
            </div>
            <FieldDescription>Applies to new torrents only.</FieldDescription>
          </Field>
        )}
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => openFolder.mutate()}
            disabled={openFolder.isPending}
          >
            <RiFolderOpenFill className="size-4" />
            Open folder
          </Button>
          <Button onClick={() => save.mutate(dir.trim())} disabled={save.isPending || !dirty}>
            {save.isPending ? <Spinner /> : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
