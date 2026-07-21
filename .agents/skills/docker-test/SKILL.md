---
name: docker-test
description: Build and smoke-test the Docker images with docker compose. Use when touching a Dockerfile, the bundle build, or compose config.
---

# Docker Testing

Full stack, same Dockerfiles prod ships:

```bash
docker compose build --no-cache && docker compose up
```

Scope to one service while iterating:

```bash
docker compose build --no-cache api && docker compose up -d api
curl -sf --retry 30 --retry-delay 1 --retry-connrefused http://localhost:9336/api/health
docker compose logs -f api
docker compose down
```

## .env

- **Where it comes from.** The build reads `.env` as a BuildKit secret (compose wires `secrets: dotenv` from `./.env`; a plain build passes `--secret id=dotenv,src=.env`); `up` loads it via `env_file: .env`. The secret mounts only during the build RUN (`--mount=type=secret,id=dotenv,...,required=true`), never lands in a layer. Missing `.env` fails fast: compose reports "secret file not found", docker build "secret not provided".
- **No `.env.example`, no required vars.** This is a local-first single-user app: every server and client var has a zod default (`packages/env/src/*.ts`, `NODE_ENV` included), so it builds and boots with an empty `.env`. A smoke build only needs the file to exist:

  ```bash
  touch .env   # empty file satisfies the required secret mount + env_file
  ```

  Populate real values only for a hosted deploy. `.gitignore` ignores `.env*`, so a real `.env` never lands in the repo.
- **Server vars (all defaulted, `packages/env/src/api-hono.ts`).** `HONO_PORT` (9336), `HONO_RATE_LIMIT` (60), `HONO_RATE_LIMIT_WINDOW_MS` (60000), `HONO_TRUSTED_ORIGINS` (`http://localhost:9410`, comma-separated), `REGISTRY_SYNC_URL` (GitHub raw `registry.json`; set to any non-URL like `off` to disable the runtime sync). Web build vars (`packages/env/src/web-next.ts`) also default: `NEXT_PUBLIC_APP_URL` (9410), `NEXT_PUBLIC_API_URL` (9336). Compose sets `INTERNAL_API_URL=http://api:9336` so the web `/api/*` rewrite reaches the api service.
- **`--no-cache` after any `.env` edit.** Secret contents are not part of BuildKit's cache key, so a plain rebuild reuses the cached build RUN and silently ships stale baked values (web inlines `NEXT_PUBLIC_*` into the bundle at build). Only matters once you actually populate `.env`.
- **No DB, no auth.** The only mounted API router is `/torrents` (`api/hono/src/index.ts`); the rest is `/api/health`, `/api/health/ws`, and the feature-gated `/api/openapi.json` + `/api/docs`. There is no database and no user/account routes, so a green `/api/health` plus a working `/torrents` call is a full smoke test.
- **Direct `docker run --env-file`** does not strip inline comments: `HONO_RATE_LIMIT=60 # note` arrives as `"60 # note"`, coerces to NaN, and validation rejects it. Compose's parser strips them; for `docker run` on a populated `.env`, sanitize first: `sed 's/ #.*//' .env > .env.docker`.
- **Ports** `9336`/`9410` are Docker's fixed ports. The default portless dev stack uses random per-app ports, so it won't collide - but a `PORTLESS=0` dev stack will (as will an old installed desktop app that still binds `9336`; current builds use an ephemeral port). For side-by-side testing bump the compose mappings (e.g. `19336:9336`) in a scratch checkout.

## Self-containment check (catches runtime auto-install)

The api runner ships only `bundle/` (a single minified `bundle/index.mjs`, built by `api/hono/scripts/build-bundle.mjs`), so the bundle must resolve every import with no `node_modules`. When one is missing, Bun auto-installs it from npm at runtime, so a container that "works" online may be downloading packages on every cold start. Prove it offline (every var defaults, so no `--env-file` is needed):

```bash
docker run -d --name t-offline --network=none <api-image>
docker exec t-offline sh -c 'for i in $(seq 1 30); do wget -qO- http://localhost:9336/api/health && exit 0; sleep 1; done; exit 1'
docker logs t-offline        # on failure: "Cannot find package 'X'" = unresolved import
docker rm -f t-offline
```

`--network=none` also blocks the background `REGISTRY_SYNC_URL` refresh, but that is non-blocking, so `/api/health` stays green. Forensics on an online container: `docker diff <name> | grep .bun/install/cache`; entries there mean auto-install fired (history: `--external hono` in the bundle build once fetched hono from npm at cold start).

## Notes

- Start the daemon if needed: `open -a Docker`, then poll `docker info` until ready.
- `.dockerignore` excludes `.env*` from the build context, so no secret file ever enters it; the build gets `.env` only through the BuildKit secret mount.
