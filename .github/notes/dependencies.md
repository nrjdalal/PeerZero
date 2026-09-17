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

### fast-uri → ^3.1.6

- **Advisory:** fast-uri host confusion and SSRF via URI normalization (all high), affecting
  `fast-uri >=3.0.0 <3.1.6` and patched in `3.1.6`:
  [GHSA-5jgf-p345-68v8](https://github.com/advisories/GHSA-5jgf-p345-68v8) (skipped IDN
  canonicalization on scheme-relative references),
  [GHSA-f65p-4m7j-42xc](https://github.com/advisories/GHSA-f65p-4m7j-42xc) (malformed IPv6
  normalization), [GHSA-fph4-wmhf-6fwf](https://github.com/advisories/GHSA-fph4-wmhf-6fwf) (repeated
  hostname percent-decoding), [GHSA-jqff-g426-hqxp](https://github.com/advisories/GHSA-jqff-g426-hqxp)
  (percent-encoded scheme normalization), and
  [GHSA-7p8r-x3mc-p8w7](https://github.com/advisories/GHSA-7p8r-x3mc-p8w7) (backslash authority
  introducer, `<3.1.5`). The floor was raised from `^3.1.4` (which covered
  [GHSA-v2hh-gcrm-f6hx](https://github.com/advisories/GHSA-v2hh-gcrm-f6hx), `<=3.1.3`) when these landed.
- **Path:** `@commitlint/cli > @commitlint/load > @commitlint/config-validator > ajv@8.20.0 > fast-uri`
  and `@web/next > shadcn@4.13.0 > @modelcontextprotocol/sdk > ajv > fast-uri` (both dev-only).
- **Why an override:** `ajv@8.20.0` is the latest 8.x and requires `fast-uri ^3.0.1`; the vulnerable
  range sits inside that caret and no newer `ajv` / `@commitlint/*` / `shadcn` release moves off it.
  `fast-uri@4.x` is a major bump `ajv` does not accept, so pinning the 3.x line to the patched `^3.1.6`
  is the narrowest fix (currently resolves `3.1.8`).
- **Risk:** Low. Both consumers (commitlint config loading, the shadcn CLI) are dev-only and parse our
  own trusted schema/registry URLs, never attacker input. The override is a genuine patch, not a suppression.
- **Exit criteria:** Remove the `fast-uri` override once `ajv` (via `@commitlint/*` and `shadcn`) ships a
  release that requires `fast-uri >= 3.1.6`.

### brace-expansion → ^5.0.9

- **Advisory:** [GHSA-rgw5-rvv9-x895](https://github.com/advisories/GHSA-rgw5-rvv9-x895) -
  brace-expansion: denial of service via unbounded intermediate arrays, bypassing the CVE-2026-14257
  mitigation (high). Affects `brace-expansion >=4.0.0 <5.0.9`; patched in `5.0.9`. Supersedes
  [GHSA-mh99-v99m-4gvg](https://github.com/advisories/GHSA-mh99-v99m-4gvg) (same class, `<= 5.0.7`),
  which this floor also covers - the override floor was raised from `^5.0.8` when the newer advisory
  landed.
- **Path:** `ts-morph > @ts-morph/common@0.29.0 > minimatch > brace-expansion` (dev-only).
- **Why an override:** `ts-morph@28.0.0` is the latest release and `@ts-morph/common@0.29.0` requires
  `minimatch: "^10.0.1"`. Even the latest `minimatch@10.2.6` only requires `brace-expansion: "^5.0.8"`,
  so the vulnerable `5.0.8` sits inside every parent's range and no parent bump can lift it. Pinning
  `brace-expansion` to `^5.0.9` is the narrowest deterministic fix and keeps the tree on a single copy
  (currently resolves `5.0.12`).
- **Risk:** Low. `brace-expansion` is dev-only here: it reaches us through `ts-morph`'s glob matching,
  which only ever expands our own source-file patterns, never attacker-controlled input. The override is
  a genuine patch, not a suppression.
- **Exit criteria:** Remove the `brace-expansion` override once `minimatch` (via `@ts-morph/common` /
  `ts-morph`) ships a release that requires `brace-expansion >= 5.0.9`.

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
