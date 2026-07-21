# Node API index

Per-file inventory of every Node built-in used in the repo, for the [`runtime-apis`](SKILL.md) skill.
Snapshot: 2026-07-22. Regenerate with the `rg "node:..."` command in `SKILL.md`.

The `Runtime` column drives the rule: **Node** and **Both** files stay on `node:` (no `Bun.*`);
**Bun** files may move a call to a `Bun.*` equivalent where one exists.

| File | Runtime | `node:` modules (APIs used) |
| --- | --- | --- |
| `.github/scripts/compress-images.ts` | Bun | `node:path` (path) |
| `.github/scripts/ensure-remote-branches.ts` | Bun | `node:child_process` (execFileSync) |
| `.github/scripts/refresh-registry.ts` | Bun | `node:path` (resolve) |
| `.github/scripts/seal-registry.ts` | Bun | `node:path` (resolve) |
| `.github/scripts/shadcn-customize.ts` | Bun | `node:child_process` (execFileSync); `node:fs` (readFileSync, writeFileSync) |
| `.github/scripts/vendor-libmedia.ts` | Bun | `node:fs` (existsSync); `node:fs/promises` (cp, mkdir, readdir, rm); `node:path` (path) |
| `.github/workflows/auto-labeler.yml` | Node | `node:fs`, `node:path` (via `require`, `actions/github-script`) |
| `api/hono/src/lib/torrent/codec.ts` | Both | `node:crypto` (createCipheriv, createDecipheriv, createHash) |
| `api/hono/src/lib/torrent/webtorrent.mjs` | Both | `node:child_process` (spawn); `node:fs` (existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync); `node:os` (homedir, platform); `node:path` (dirname, resolve); `node:url` (fileURLToPath) |
| `desktop/backend/main.ts` | Bun | `node:net` (createServer) |
| `desktop/backend/serve-static.ts` | Bun | `node:path` (join) |
| `packages/env/src/lib/utils.ts` | Both | `node:path` (path) |
| `packages/env/tsdown.config.ts` | Build | `node:child_process` (execSync) |
| `tests/api-hono/fixtures/seed.ts` | Bun | `node:fs` (mkdirSync, writeFileSync); `node:os` (homedir); `node:path` (join, resolve) |
| `tests/api-hono/lib/golden.ts` | Bun | `node:fs` (existsSync, mkdirSync, readFileSync, writeFileSync); `node:path` (dirname, join) |
| `tests/api-hono/run.ts` | Bun | `node:fs` (mkdtempSync, rmSync); `node:os` (tmpdir); `node:path` (join) |

The `api/hono/src/lib/torrent/*` files carry the largest `node:` surface: the in-process
WebTorrent engine (`webtorrent.mjs`, imported by the typed `engine.ts` seam) plus `codec.ts`.
They are **Both** because the API runs under Bun everywhere except Vercel (Node), so `node:` keeps
them portable across both.

## Convertible to `Bun.*` (optional, Bun-only files)

Only where the file runs **only** under Bun and the call has a `Bun.*` equivalent:

| File | Node call | Bun equivalent |
| --- | --- | --- |
| `.github/scripts/ensure-remote-branches.ts` | `execFileSync` | `Bun.spawnSync` |
| `.github/scripts/shadcn-customize.ts` | `execFileSync` | `Bun.spawnSync` |
| `.github/scripts/shadcn-customize.ts` | `readFileSync` / `writeFileSync` | `Bun.file().text()` / `Bun.write` |
| `.github/scripts/vendor-libmedia.ts` | `existsSync` | `Bun.file().exists()` |
| `tests/api-hono/lib/golden.ts` | `readFileSync` / `writeFileSync` | `Bun.file().text()` / `Bun.write` |
| `tests/api-hono/lib/golden.ts` | `existsSync` | `Bun.file().exists()` |
| `tests/api-hono/fixtures/seed.ts` | `writeFileSync` | `Bun.write` |

`ensure-remote-branches.ts` also runs from `lefthook.yml` (a git hook); leaving it on portable
`node:child_process` keeps it runnable outside Bun too. Directory and temp-dir calls
(`mkdirSync`, `mkdtempSync`, `rmSync`, `readdir`, `cp`, `mkdir`, `rm`) have no `Bun.*` equivalent
and stay `node:`.
