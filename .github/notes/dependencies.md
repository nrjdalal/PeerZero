# Dependency security notes

Canonical record of dependency-security decisions enforced by the audit gate
(`bun audit --audit-level high`, run in `.github/workflows/auto-check-build.yml` and the
`canary` pre-push hook in `lefthook.yml`). Prefer lifting a vulnerable dep by updating it
or its parent (see the `audit` skill); only accept an advisory when neither is possible.

## Active overrides

Overrides in the root `package.json` that pin a patched version of a vulnerable transitive dep.
Delete a block (and its `overrides` entry) once the parent ships a version that no longer needs it.

### shell-quote → ^1.10.0

- **Advisory:** [GHSA-395f-4hp3-45gv](https://github.com/advisories/GHSA-395f-4hp3-45gv) - shell-quote:
  quadratic-complexity Denial of Service in `parse()` (high, CWE-407). Affects `shell-quote <= 1.8.4`;
  patched in `1.9.0`.
- **Path:** `@api/hono > concurrently@10.0.3 > shell-quote@1.8.4`.
- **Why an override:** `concurrently@10.0.3` is the latest release and **exact-pins** `shell-quote: "1.8.4"`
  (not a range), so no parent bump lifts it. `concurrently` is the only consumer, so overriding
  `shell-quote` to the patched `^1.10.0` is the narrowest real fix.
- **Risk:** Low. `concurrently` only parses our own dev-script command strings via `shell-quote.parse()`,
  never attacker-controlled input, and it is a dev-only dependency. The override is a genuine patch, not a
  suppression.
- **Exit criteria:** Remove the `shell-quote` override once `concurrently` ships a release that pins
  `shell-quote >= 1.9.0` (or drops it).

### fast-uri → ^3.1.4

- **Advisory:** [GHSA-v2hh-gcrm-f6hx](https://github.com/advisories/GHSA-v2hh-gcrm-f6hx) - fast-uri host
  confusion via a literal backslash authority delimiter (high). Affects `fast-uri >=3.0.0 <=3.1.3`;
  patched in `3.1.4`.
- **Path:** `@commitlint/cli > @commitlint/load > @commitlint/config-validator > ajv@8.20.0 > fast-uri`
  and `@web/next > shadcn@4.13.0 > @modelcontextprotocol/sdk > ajv > fast-uri` (both dev-only).
- **Why an override:** `ajv@8.20.0` is the latest 8.x and requires `fast-uri ^3.0.1`; the vulnerable
  range sits inside that caret and no newer `ajv` / `@commitlint/*` / `shadcn` release moves off it.
  `fast-uri@4.x` is a major bump `ajv` does not accept, so pinning the 3.x line to the patched `^3.1.4`
  is the narrowest fix.
- **Risk:** Low. Both consumers (commitlint config loading, the shadcn CLI) are dev-only and parse our
  own trusted schema/registry URLs, never attacker input. The override is a genuine patch, not a suppression.
- **Exit criteria:** Remove the `fast-uri` override once `ajv` (via `@commitlint/*` and `shadcn`) ships a
  release that requires `fast-uri >= 3.1.4`.

### sharp → ^0.35.3

- **Advisory:** [GHSA-f88m-g3jw-g9cj](https://github.com/advisories/GHSA-f88m-g3jw-g9cj) - sharp inherited
  libvips vulnerabilities (CVE-2026-33327, CVE-2026-33328, CVE-2026-35590, CVE-2026-35591) (high). Affects
  `sharp <0.35.0`; patched in `0.35.0`.
- **Path:** `@web/next > next@16.2.10 > sharp@0.34.5` (optional). Our own direct `sharp` already uses the
  patched line (catalog `^0.35.3`); only next's bundled optional copy pulled the vulnerable `0.34.5`.
- **Why an override:** `next@16.2.10` is the latest release and declares its optional `sharp` as `^0.34.5`
  (`>=0.34.5 <0.35.0`), so no next bump lifts it to the patched libvips. Overriding `sharp` to `^0.35.3`
  forces next's optional copy to the same patched version our direct dependency already resolves to.
- **Risk:** Low. sharp 0.35.x is API-compatible with next's image-optimization usage (verified by
  `bun run build`); the 0.34 -> 0.35 change is the libvips bump that carries the fix. Local-only app.
- **Exit criteria:** Remove the `sharp` override once `next` ships a release whose optional `sharp`
  requirement includes `>= 0.35.0`.

## Accepted advisories (`--ignore`)

Advisories that cannot be lifted by any dependency update and are suppressed with a matching
`--ignore <id>` on both audit invocations. Remove the id from both when the exit criteria are met.

### ip <= 2.0.1 - GHSA-2p57-rm9w-gvfp

- **Advisory:** [GHSA-2p57-rm9w-gvfp](https://github.com/advisories/GHSA-2p57-rm9w-gvfp) - ip SSRF
  improper categorization in `isPublic` (high, CVSS 8.1, CWE-918). Affects `ip <= 2.0.1`, i.e. every
  published version.
- **Path:** `@api/hono > webtorrent@3.0.16 > torrent-discovery > bittorrent-tracker@11.2.3 > ip@2.0.1`.
- **Why an update/parent bump can't lift it:** `ip@2.0.1` is the latest release and has no patched
  version. `bittorrent-tracker@11.2.3` is the latest release and still requires `ip@^2.0.1`. No newer
  version of `bittorrent-tracker`, `torrent-discovery`, or `webtorrent` drops `ip`, and `ip` has no
  drop-in replacement to override to. Predates this record: `ip` was already present under the previous
  `webtorrent@2.8.5` via the same tracker path.
- **Risk:** Low here. The `ip.isPublic` misclassification is an SSRF primitive only when untrusted input
  drives a server-side fetch or allowlist check. This is a local-only client; `ip` is used by the tracker
  layer to categorize peer addresses, not to gate any attacker-controlled request.
- **Exit criteria:** Remove `--ignore GHSA-2p57-rm9w-gvfp` from both audit invocations once `ip` ships a
  patched release, or once `bittorrent-tracker` / `torrent-discovery` / `webtorrent` drop the `ip` dependency.
