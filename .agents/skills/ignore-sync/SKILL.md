---
name: ignore-sync
description: Mirror .gitignore to .dockerignore. Use whenever a .gitignore entry is added or removed, or when auditing a bloated Docker build context.
---

# Ignore Sync

`.dockerignore` does not inherit from `.gitignore`. Anything git ignores but `.dockerignore` misses still enters the Docker build context (`COPY . .` in the `prepare` stage of `web/next/Dockerfile` and `api/hono/Dockerfile`), and on this repo that has meant gigabytes: `web/next/.next` alone hit 3GB, `.turbo` 23GB.

## Rule: .dockerignore mirrors .gitignore

`.gitignore` is the source of truth; `.dockerignore` follows it rule-for-rule. Add an entry to `.gitignore` and you add it to `.dockerignore` in the same section and order; remove it from one and you remove it from the other, in the same commit. Every shared `!` un-ignore (for example `!.yarn/patches`) lives in both.

There is no `# git overrides` / `# docker overrides` tail and no `!.env.example` line: `.env.example` was removed, so both files simply ignore `.env*` wholesale. If a genuine platform-only exception ever arises (a rule that truly belongs to just one file), that single line is the only sanctioned divergence; there are none today.

## .env stays out of the context

Real `.env*` files never enter the Docker context, and that is correct. Each build mounts the host `.env` as a required BuildKit secret (`--mount=type=secret,id=dotenv,target=/app/.env,required=true` in both `api/hono/Dockerfile` and `web/next/Dockerfile`; `docker-compose.yml` supplies it via `secrets.dotenv.file: .env`), so the secret bypasses the context, is validated during the build, and never lands in a layer. Never un-ignore `.env*` to feed a builder-stage `COPY`; that would be drift.

## Audit

```bash
diff -u .gitignore .dockerignore
```

Done when the diff prints nothing: the two files carry the same rules, so `.dockerignore` is a mirror of `.gitignore`.

As of this writing they have drifted. `.dockerignore` is missing five entries that `.gitignore` has:

- `.downloads/`
- `desktop/src-tauri/binaries/`
- `.claude/worktrees/`
- `api/hono/src/lib/torrent/registry.plain.json`
- `desktop/.keys/`

and its `# env files` comment reads differently from `.gitignore`'s. To bring them back in sync, copy those entries (with their explanatory comments) into the matching sections of `.dockerignore`, reconcile the `# env files` comment to match `.gitignore`, and re-run the diff until it is clean.
