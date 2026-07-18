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
