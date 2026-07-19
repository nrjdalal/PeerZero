# Dependency security notes

Canonical record of dependency-security decisions enforced by the audit gate
(`bun audit --audit-level high`, run in `.github/workflows/auto-check-build.yml` and the
`canary` pre-push hook in `lefthook.yml`). Prefer lifting a vulnerable dep by updating it
or its parent (see the `audit` skill); only accept an advisory when neither is possible.

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
