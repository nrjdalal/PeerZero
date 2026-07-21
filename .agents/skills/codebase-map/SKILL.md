---
name: codebase-map
description: Orient in this repo: which file to edit for a change, how a change ripples across the stack, and how to search the code. Use at the start of a task in an unfamiliar area, or before a cross-cutting change.
---

# Codebase Map

One Bun + Turborepo monorepo: a Hono API + a Next.js UI over two shared packages, plus the Tauri desktop shell. It is a local-only, single-user torrent client - no auth, no database, no accounts. Imports use `@api/hono`, `@packages/*`, and the `@/` alias, never deep relative paths.

```
api/hono/         # backend (Hono): routers, middlewares, the AppType export, and the in-process
                  #   WebTorrent engine (src/lib/torrent; WebRTC/uTP native addons disabled so
                  #   webtorrent runs under Bun - see webrtc-stub.mjs)
web/next/         # frontend (Next.js App Router, static-exported for desktop): app/, components/, lib/
desktop/          # Tauri v2 shell + the Bun sidecar that serves the API + UI (see the `desktop` skill)
packages/env/     # type-safe env, one validated entry per consumer (api-hono.ts, web-next.ts)
packages/config/  # TS base, tsdown factory, and site.ts (brand identity)
tests/            # central test tree (tests/api-hono = golden API suite); `bun run test`, UPDATE_GOLDEN=1
```

Read `AGENTS.md` first for the rules.

## Where to edit for X

| Goal | Edit here | Then |
| --- | --- | --- |
| Add/change an API route | `api/hono/src/routers/<name>.ts` (today only `torrents.ts`) -> mount in `src/index.ts` `.route()` chain | `api-endpoint` skill |
| Add/change a torrent search source | `api/hono/src/lib/torrent/`: `registry.ts` + `registry.json` (the committed, sealed source registry read at runtime) - `search.ts` (query + aggregate) - `defs.ts`/`shared.ts` (config + types/parsers) - `directory.ts`/`live.ts`/`codec.ts`/`health.ts`/`trackers.ts` | - |
| Regenerate the source registry | `.github/scripts/refresh-registry.ts` (+ `seal-registry.ts`), run by `.github/workflows/auto-refresh-registry.yml` (6-hourly cron). Output: committed `api/hono/src/lib/torrent/registry.json`, read at runtime, never fetched live | - |
| Change the download engine | `api/hono/src/lib/torrent/webtorrent.mjs` (the in-process WebTorrent engine; WebRTC/uTP disabled via `webrtc-stub.mjs` + `bunfig.toml`) + `engine.ts` (the typed seam the routers call) | - |
| Change the Transfers / Search UI | `web/next/src/components/torrents/torrents-grid.tsx` (Transfers) + `search-view.tsx` (Search), both `data-grid.tsx` grids over `torrents-context.tsx` + `use-torrents-live.ts` (live socket) | `design` |
| Change the in-app video player | `web/next/src/components/torrents/mpv-player.tsx` (native mpv, desktop) + `libmedia-player.tsx` (browser); shared `lib/use-resume-position.ts` / `use-scrubbing.ts` | `design` |
| Add/change a page | `web/next/src/app/` - one route group, `(app)` (no marketing/console/docs) | - |
| Add/customize a UI component | `web/next/src/components/` (`ui/`, `torrents/`, `common/`, `command/`); `ui/` is generated shadcn, don't hand-edit | `design`, `shadcn-sync` |
| Call the API from the web app | `web/next/src/lib/api/client.ts` (`apiClient`, `unwrap`) | - |
| Rebrand (name, description, socials) | `packages/config/src/site.ts`, one file | - |
| Add or read an env var | `packages/env/src/{api-hono,web-next}.ts`; read via `@packages/env/*`, never `process.env` | - |
| Change the error/response shape | `api/hono/src/lib/error.ts` (the `{ error: { code, message } }` handler) | - |
| Build/run the desktop app | `desktop/scripts/build-app.sh`, `desktop/backend/main.ts`, `desktop/src-tauri/` | `desktop` |

## Trace a feature across the stack

Types flow downhill, so a change ripples predictably:

```
api/hono/src/routers  ->  api/hono/src/index.ts (export type AppType)  ->  web/next/src/lib/api/client.ts  ->  app / components
```

Return a new field from a router and every `apiClient` call site is retyped automatically; the compiler becomes your worklist of what still must change.

## Entry points (read these first)

- `api/hono/src/index.ts` - the `.route()` chain and `export type AppType`, the whole API shape in one file.
- `web/next/src/app/layout.tsx` - the web root.
- `packages/config/src/site.ts` - brand identity and injectable content.

## Fast find

```bash
rg -n "\.route\(" api/hono/src/index.ts                 # every mounted router
rg -n "new Hono\(\)" api/hono/src/routers               # every router definition
rg -n "apiClient\." web/next/src                        # every API call site
rg -n "SOME_ENV_VAR" packages/env                       # where an env var is declared
ls .agents/skills                                       # every task skill available
```

## Then

Load the task skill from the table's right column; the `dev` skill runs/restarts the stack, and the `desktop` skill builds and runs the app.
