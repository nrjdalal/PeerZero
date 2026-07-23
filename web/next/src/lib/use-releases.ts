"use client"

import { useQuery } from "@tanstack/react-query"

const REPO = "nrjdalal/PeerZero"
// The per-release updater path (per-version latest.json + the install_release command) came in on the
// 0.0.2x line; releases at or before this floor predate it, so the table never offers them.
const MIN_VERSION: readonly [number, number, number] = [0, 0, 20]

export type Channel = "stable" | "canary"

export type Release = {
  tag: string // the git tag, e.g. "v0.0.23" or "canary-v0.0.23-142" (what install_release needs)
  version: string // display version, e.g. "0.0.23" or "0.0.23-142"
  channel: Channel
  publishedAt: string // ISO date
  url: string // release page (html_url)
  dmgUrl: string | null // the .dmg asset URL, for a cross-channel side-by-side install (install_dmg)
}

type GhAsset = { name: string; browser_download_url: string }

type GhRelease = {
  tag_name: string
  html_url: string
  prerelease: boolean
  draft: boolean
  published_at: string | null
  created_at: string
  assets: GhAsset[]
}

// The numeric [major, minor, patch] embedded in a tag, for the floor filter + ordering. Handles both
// "v0.0.23" and "canary-v0.0.23-142"; anything unparseable sorts as 0.0.0 (and is filtered out).
function baseTriple(tag: string): [number, number, number] {
  const m = tag.match(/(\d+)\.(\d+)\.(\d+)/)
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : [0, 0, 0]
}

// Strictly greater than MIN_VERSION (so "after 0.0.20" excludes 0.0.20 itself).
function afterFloor([a, b, c]: [number, number, number]): boolean {
  const [x, y, z] = MIN_VERSION
  if (a !== x) return a > x
  if (b !== y) return b > y
  return c > z
}

// Display version from the tag: strip a leading "v" (stable) or "canary-v" (canary -> "0.0.23-142").
function displayVersion(tag: string): string {
  return tag.startsWith("canary-v") ? tag.slice("canary-v".length) : tag.replace(/^v/, "")
}

// Fetches published PeerZero releases (stable + canary pre-releases) straight from the GitHub REST
// API - public + unauthenticated (60 req/hr is ample), and there is no CSP so the webview can reach
// api.github.com directly. Filtered to versions strictly after MIN_VERSION and returned newest-first.
// `enabled` gates it to the desktop app (updates are meaningless in a plain browser).
export function useReleases(enabled: boolean) {
  return useQuery({
    queryKey: ["gh-releases"],
    enabled,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<Release[]> => {
      const res = await fetch(`https://api.github.com/repos/${REPO}/releases?per_page=50`, {
        headers: { Accept: "application/vnd.github+json" },
      })
      if (!res.ok) throw new Error(`GitHub API returned ${res.status}`)
      const raw = (await res.json()) as GhRelease[]
      return raw
        .filter((r) => !r.draft && afterFloor(baseTriple(r.tag_name)))
        .map((r) => ({
          tag: r.tag_name,
          version: displayVersion(r.tag_name),
          channel: (r.prerelease ? "canary" : "stable") as Channel,
          publishedAt: r.published_at ?? r.created_at,
          url: r.html_url,
          dmgUrl: r.assets?.find((a) => a.name.endsWith(".dmg"))?.browser_download_url ?? null,
        }))
    },
  })
}
