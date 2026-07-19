"use client"

import { RiFolderOpenFill, RiSettings3Fill } from "@remixicon/react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { toast } from "sonner"

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Field, FieldContent, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { Switch } from "@/components/ui/switch"
import { apiClient, unwrap } from "@/lib/api/client"
import { usePrefs } from "@/lib/prefs-store"

// Mirror of the engine's settings payload, used to type the optimistic library-toggle update.
type TorrentSettings = { downloadDir: string; mediaLibrary: { enabled: boolean; dir: string } }

// App settings. Follows the canonical dialog pattern (Header > Body > Footer; see the design
// skill). The download folder is changed only through the native OS picker (Browse) - no
// free-text path. Advanced holds off-by-default toggles like Enable Search.
export function SettingsDialog() {
  const [open, setOpen] = useState(false)
  const queryClient = useQueryClient()
  const enableSearch = usePrefs((s) => s.enableSearch)
  const setEnableSearch = usePrefs((s) => s.setEnableSearch)

  const { data, isLoading } = useQuery({
    queryKey: ["torrent-settings"],
    enabled: open,
    queryFn: async () => {
      const { data, error } = await unwrap(apiClient.torrents.settings.$get())
      if (error) throw new Error(error.message)
      return data
    },
  })

  const openFolder = useMutation({
    mutationFn: async () => {
      const { error } = await unwrap(apiClient.torrents.open.$post())
      if (error) throw new Error(error.message)
    },
    onError: (e) => toast.error(e.message),
  })

  // Native OS folder picker - the only way to change the download folder. On success the
  // settings query refetches so the field shows the new path.
  const browse = useMutation({
    mutationFn: async () => {
      const { data, error } = await unwrap(apiClient.torrents["choose-dir"].$post())
      if (error) throw new Error(error.message)
      return data
    },
    onSuccess: (data) => {
      if (data.chosen) {
        queryClient.invalidateQueries({ queryKey: ["torrent-settings"] })
        toast.success("Download folder updated")
      }
    },
    onError: (e) => toast.error(e.message),
  })

  // Toggle organizing finished video torrents into the media library. Optimistic so the switch
  // reacts instantly, then reconciled against the server.
  const setLibraryEnabled = useMutation({
    mutationFn: async (enabled: boolean) => {
      const { error } = await unwrap(
        apiClient.torrents.settings["media-library"].$put({ json: { enabled } }),
      )
      if (error) throw new Error(error.message)
    },
    onMutate: (enabled) => {
      queryClient.setQueryData<TorrentSettings>(["torrent-settings"], (old) =>
        old ? { ...old, mediaLibrary: { ...old.mediaLibrary, enabled } } : old,
      )
    },
    onError: (e) => {
      toast.error(e.message)
      queryClient.invalidateQueries({ queryKey: ["torrent-settings"] })
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["torrent-settings"] }),
  })

  // Native OS folder picker for the media library folder.
  const browseLibrary = useMutation({
    mutationFn: async () => {
      const { data, error } = await unwrap(apiClient.torrents["choose-library-dir"].$post())
      if (error) throw new Error(error.message)
      return data
    },
    onSuccess: (data) => {
      if (data.chosen) {
        queryClient.invalidateQueries({ queryKey: ["torrent-settings"] })
        toast.success("Media library folder updated")
      }
    },
    onError: (e) => toast.error(e.message),
  })

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
            Where downloads are saved and how finished media is organized.
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          {isLoading ? (
            <div className="flex justify-center py-6">
              <Spinner />
            </div>
          ) : (
            <>
              <Field>
                <FieldLabel htmlFor="download-dir">Download folder</FieldLabel>
                <div className="flex gap-2">
                  <Input id="download-dir" value={data?.downloadDir ?? ""} readOnly />
                  <Button
                    variant="outline"
                    onClick={() => browse.mutate()}
                    disabled={browse.isPending}
                  >
                    {/* Stack label + spinner in one grid cell so the button keeps the label's
                        width while loading (the spinner shows in place of the text, no reflow). */}
                    <span className="grid place-items-center">
                      <span
                        className={`col-start-1 row-start-1 ${browse.isPending ? "invisible" : ""}`}
                      >
                        Browse…
                      </span>
                      {browse.isPending && <Spinner className="col-start-1 row-start-1" />}
                    </span>
                  </Button>
                </div>
                <FieldDescription>
                  Choose a folder with Browse. Applies to new torrents only.
                </FieldDescription>
              </Field>
              <Field orientation="horizontal">
                <FieldContent>
                  <FieldLabel htmlFor="media-library">Media library</FieldLabel>
                  <FieldDescription>
                    Hardlink finished movies and shows into a Jellyfin-friendly library (Movies/…,
                    Shows/…) so a media server can identify them. The original download is never
                    moved or renamed; only video torrents are organized.
                  </FieldDescription>
                </FieldContent>
                <Switch
                  id="media-library"
                  checked={data?.mediaLibrary?.enabled ?? true}
                  onCheckedChange={(v) => setLibraryEnabled.mutate(v)}
                />
              </Field>
              {data?.mediaLibrary?.enabled && (
                <Field>
                  <FieldLabel htmlFor="library-dir">Library folder</FieldLabel>
                  <div className="flex gap-2">
                    <Input id="library-dir" value={data?.mediaLibrary?.dir ?? ""} readOnly />
                    <Button
                      variant="outline"
                      onClick={() => browseLibrary.mutate()}
                      disabled={browseLibrary.isPending}
                    >
                      <span className="grid place-items-center">
                        <span
                          className={`col-start-1 row-start-1 ${browseLibrary.isPending ? "invisible" : ""}`}
                        >
                          Browse…
                        </span>
                        {browseLibrary.isPending && <Spinner className="col-start-1 row-start-1" />}
                      </span>
                    </Button>
                  </div>
                  <FieldDescription>
                    Defaults to a Media folder inside your downloads. If you choose another folder,
                    keep it on the same drive - hardlinks can't cross drives.
                  </FieldDescription>
                </Field>
              )}
            </>
          )}
          <Accordion>
            <AccordionItem value="advanced">
              <AccordionTrigger>Advanced</AccordionTrigger>
              <AccordionContent>
                <Field orientation="horizontal">
                  <FieldContent>
                    <FieldLabel htmlFor="enable-search">Enable Search</FieldLabel>
                    <FieldDescription>
                      Show the torrent Search page and its navbar shortcut. Off by default.
                    </FieldDescription>
                  </FieldContent>
                  <Switch
                    id="enable-search"
                    checked={enableSearch}
                    onCheckedChange={setEnableSearch}
                  />
                </Field>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </DialogBody>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => openFolder.mutate()}
            disabled={openFolder.isPending}
          >
            <RiFolderOpenFill className="size-4" />
            Open folder
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
