import { sValidator } from "@hono/standard-validator"
import { Hono } from "hono"
import { describeRoute } from "hono-openapi"
import type { ContentfulStatusCode } from "hono/utils/http-status"
import { z } from "zod"

import { ApiError, jsonError } from "@/lib/error"
import { upgradeWebSocket } from "@/lib/server"
import { ensureDirectory } from "@/lib/torrent/directory"
import { engine, EngineError } from "@/lib/torrent/engine"
import { addLiveClient, removeLiveClient } from "@/lib/torrent/live"
import {
  activeProviders,
  providerHealth,
  runProviderCanaries,
  searchTorrents,
} from "@/lib/torrent/search"
import { getTrackerSync } from "@/lib/torrent/trackers"

// Map an EngineError to the app's { error } envelope; rethrow anything else.
function handleEngineError(c: Parameters<typeof jsonError>[0], err: unknown) {
  if (err instanceof EngineError)
    return jsonError(c, err.status as ContentfulStatusCode, "ENGINE_ERROR", err.message)
  throw err
}

// Shared validation-failure handler: throw so onError shapes the 400 in one place.
function onInvalid(result: { success: boolean; error?: unknown }) {
  if (!result.success) {
    throw new ApiError(400, "VALIDATION_ERROR", "Invalid request", { issues: result.error })
  }
}

// Local, single-user tool: these routes are intentionally not auth-gated.
export const torrentsRouter = new Hono()
  .get(
    "/search",
    describeRoute({
      tags: ["Torrents"],
      description:
        "Search the configured providers in parallel, deduped by infohash and sorted by seeders.",
    }),
    sValidator("query", z.object({ q: z.string().trim().min(1) }), onInvalid),
    async (c) => {
      const { q } = c.req.valid("query")
      const { results, sources } = await searchTorrents(q)
      return c.json({ data: { query: q, results, sources } })
    },
  )
  .get(
    "/sources",
    describeRoute({
      tags: ["Torrents"],
      description:
        "Active providers (with liveness), the magnet tracker list, and the directory, all read from a committed registry refreshed every 6h by a scheduled job.",
    }),
    async (c) => {
      runProviderCanaries()
      const directory = await ensureDirectory()
      return c.json({
        data: {
          providers: activeProviders(),
          health: providerHealth(),
          trackers: getTrackerSync(),
          directory,
        },
      })
    },
  )
  .post(
    "/sources/refresh",
    describeRoute({
      tags: ["Torrents"],
      description:
        "Re-check provider liveness now. The registry is maintained by the scheduled job, so there's nothing to fetch here.",
    }),
    async (c) => {
      runProviderCanaries()
      const directory = await ensureDirectory()
      return c.json({
        data: {
          providers: activeProviders(),
          health: providerHealth(),
          trackers: getTrackerSync(),
          directory,
        },
      })
    },
  )
  .get(
    "/settings",
    describeRoute({
      tags: ["Torrents"],
      description: "Get the current download folder and media library settings.",
    }),
    async (c) => {
      try {
        return c.json({ data: await engine.getSettings() })
      } catch (err) {
        return handleEngineError(c, err)
      }
    },
  )
  .put(
    "/settings",
    describeRoute({
      tags: ["Torrents"],
      description:
        "Set the download folder for new torrents; existing torrents keep their own folder.",
    }),
    sValidator("json", z.object({ downloadDir: z.string().trim().min(1) }), onInvalid),
    async (c) => {
      try {
        return c.json({ data: await engine.setSettings(c.req.valid("json").downloadDir) })
      } catch (err) {
        return handleEngineError(c, err)
      }
    },
  )
  .post(
    "/open",
    describeRoute({
      tags: ["Torrents"],
      description: "Open the download folder in the OS file manager.",
    }),
    async (c) => {
      try {
        return c.json({ data: { ok: await engine.openDir() } })
      } catch (err) {
        return handleEngineError(c, err)
      }
    },
  )
  .post(
    "/choose-dir",
    describeRoute({
      tags: ["Torrents"],
      description: "Open a native folder picker on the host and set the chosen download folder.",
    }),
    async (c) => {
      try {
        return c.json({ data: await engine.chooseDir() })
      } catch (err) {
        return handleEngineError(c, err)
      }
    },
  )
  .put(
    "/settings/media-library",
    describeRoute({
      tags: ["Torrents"],
      description:
        "Update the media library: toggle organizing finished video torrents into a Jellyfin-friendly library and/or set its folder. Video files are hardlinked (the original download is never moved or renamed).",
    }),
    sValidator(
      "json",
      z
        .object({ enabled: z.boolean().optional(), dir: z.string().trim().min(1).optional() })
        .refine((v) => v.enabled !== undefined || v.dir !== undefined, {
          message: "provide enabled and/or dir",
        }),
      onInvalid,
    ),
    async (c) => {
      try {
        return c.json({ data: await engine.setMediaLibrary(c.req.valid("json")) })
      } catch (err) {
        return handleEngineError(c, err)
      }
    },
  )
  .post(
    "/choose-library-dir",
    describeRoute({
      tags: ["Torrents"],
      description:
        "Open a native folder picker on the host and set the chosen media library folder.",
    }),
    async (c) => {
      try {
        return c.json({ data: await engine.chooseLibraryDir() })
      } catch (err) {
        return handleEngineError(c, err)
      }
    },
  )
  // One shared poller (lib/torrent/live.ts) caches the snapshot and broadcasts it
  // synchronously. The web app pushes each frame into its Query cache, polling while down.
  .get(
    "/ws",
    describeRoute({
      tags: ["Torrents"],
      description: "Live torrent progress over a WebSocket. Emits { torrents } once per second.",
      responses: { 101: { description: "Switching Protocols" } },
    }),
    upgradeWebSocket(() => ({
      onOpen(_e, ws) {
        addLiveClient(ws)
      },
      onClose(_e, ws) {
        removeLiveClient(ws)
      },
    })),
  )
  .get(
    "/",
    describeRoute({ tags: ["Torrents"], description: "List active torrents with live stats." }),
    async (c) => {
      try {
        const torrents = await engine.list()
        return c.json({ data: { torrents } })
      } catch (err) {
        return handleEngineError(c, err)
      }
    },
  )
  .post(
    "/",
    describeRoute({ tags: ["Torrents"], description: "Add a torrent by magnet URI." }),
    sValidator("json", z.object({ magnet: z.string().trim().min(1) }), onInvalid),
    async (c) => {
      const { magnet } = c.req.valid("json")
      try {
        const torrent = await engine.add(magnet)
        return c.json({ data: { torrent } })
      } catch (err) {
        return handleEngineError(c, err)
      }
    },
  )
  .post(
    "/:infoHash/pause",
    describeRoute({ tags: ["Torrents"], description: "Pause a torrent." }),
    async (c) => {
      try {
        const torrent = await engine.pause(c.req.param("infoHash"))
        return c.json({ data: { torrent } })
      } catch (err) {
        return handleEngineError(c, err)
      }
    },
  )
  .post(
    "/:infoHash/resume",
    describeRoute({ tags: ["Torrents"], description: "Resume a torrent." }),
    async (c) => {
      try {
        const torrent = await engine.resume(c.req.param("infoHash"))
        return c.json({ data: { torrent } })
      } catch (err) {
        return handleEngineError(c, err)
      }
    },
  )
  .post(
    "/:infoHash/reveal",
    describeRoute({
      tags: ["Torrents"],
      description: "Reveal a torrent's downloaded folder in the OS file manager.",
    }),
    async (c) => {
      try {
        return c.json({ data: { ok: await engine.reveal(c.req.param("infoHash")) } })
      } catch (err) {
        return handleEngineError(c, err)
      }
    },
  )
  .patch(
    "/:infoHash",
    describeRoute({
      tags: ["Torrents"],
      description:
        "Set a torrent's locally-generated display name (cosmetic; never renames files on disk).",
    }),
    sValidator("json", z.object({ displayName: z.string().trim().min(1).max(300) }), onInvalid),
    async (c) => {
      const { displayName } = c.req.valid("json")
      try {
        const torrent = await engine.setDisplayName(c.req.param("infoHash"), displayName)
        return c.json({ data: { torrent } })
      } catch (err) {
        return handleEngineError(c, err)
      }
    },
  )
  .delete(
    "/:infoHash",
    describeRoute({
      tags: ["Torrents"],
      description: "Remove a torrent. Pass ?destroyStore=true to also delete downloaded files.",
    }),
    sValidator(
      "query",
      z.object({ destroyStore: z.enum(["true", "false"]).optional() }),
      onInvalid,
    ),
    async (c) => {
      const destroyStore = c.req.valid("query").destroyStore === "true"
      try {
        const ok = await engine.remove(c.req.param("infoHash"), destroyStore)
        return c.json({ data: { ok } })
      } catch (err) {
        return handleEngineError(c, err)
      }
    },
  )
