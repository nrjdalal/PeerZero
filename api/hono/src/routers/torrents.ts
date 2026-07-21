import { sValidator } from "@hono/standard-validator"
import { Hono } from "hono"
import { describeRoute } from "hono-openapi"
import type { ContentfulStatusCode } from "hono/utils/http-status"
import { z } from "zod"

import { ApiError, jsonError } from "@/lib/error"
import { upgradeWebSocket } from "@/lib/server"
import { ensureDirectory } from "@/lib/torrent/directory"
import { engine, EngineError, engineStream } from "@/lib/torrent/engine"
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
    "/:infoHash/stream/:fileIdx",
    describeRoute({
      tags: ["Torrents"],
      description: "Stream a torrent file over HTTP Range for the in-app or external player.",
    }),
    async (c) => {
      let upstream: Response
      try {
        upstream = await engineStream(
          c.req.param("infoHash"),
          c.req.param("fileIdx"),
          c.req.header("range"),
        )
      } catch (err) {
        return handleEngineError(c, err)
      }
      // Relay the raw byte stream + Range headers straight through - NOT the { data } envelope.
      const headers = new Headers()
      for (const h of ["content-type", "content-length", "content-range", "accept-ranges"]) {
        const v = upstream.headers.get(h)
        if (v) headers.set(h, v)
      }
      return new Response(upstream.body, { status: upstream.status, headers })
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
    describeRoute({ tags: ["Torrents"], description: "Get the current download folder." }),
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
  .get(
    "/ui-prefs",
    describeRoute({
      tags: ["Torrents"],
      description:
        "Get the frontend's persisted UI preferences (an opaque blob). Stored server-side so they survive the desktop webview's per-launch origin change; returns { prefs: null } before the first save.",
    }),
    async (c) => {
      try {
        return c.json({ data: { prefs: await engine.getUiPrefs() } })
      } catch (err) {
        return handleEngineError(c, err)
      }
    },
  )
  .put(
    "/ui-prefs",
    describeRoute({
      tags: ["Torrents"],
      description: "Replace the frontend's persisted UI preferences (an opaque blob).",
    }),
    sValidator("json", z.object({ prefs: z.unknown() }), onInvalid),
    async (c) => {
      try {
        return c.json({ data: { prefs: await engine.setUiPrefs(c.req.valid("json").prefs) } })
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
