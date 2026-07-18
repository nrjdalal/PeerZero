// Pure parsers for the two upstream lists (directory markdown + tracker list). Dependency-
// free so the runtime and the offline refresh script share one implementation.

// Cap so a built magnet stays a sane length.
export const MAX_TRACKERS = 25

export type DirectoryEntry = {
  section: string
  name: string
  url: string
  description: string
  starred: boolean
}

function cleanHeading(text: string): string {
  return text
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1") // [X](url) -> X
    .replace(/[►▷▶▸]/g, "")
    .replace(/[*_`#]/g, "")
    .trim()
}

function stripMarkdown(text: string): string {
  return text
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\*\*/g, "")
    .replace(/\s+/g, " ")
    .trim()
}

// Parse the directory markdown. Headings set the current group; each `* ` bullet whose
// first token is a link is a real entry (plain-text bullets are skipped).
export function parseDirectory(md: string): DirectoryEntry[] {
  const entries: DirectoryEntry[] = []
  let section = "General"

  for (const rawLine of md.split("\n")) {
    const line = rawLine.trim()
    const heading = /^#{1,4}\s+(.*)$/.exec(line)
    if (heading) {
      const name = cleanHeading(heading[1])
      if (name) section = name
      continue
    }
    if (!line.startsWith("*")) continue

    const content = line.replace(/^\*\s*/, "")
    const starred = content.startsWith("⭐")
    // Drop a leading star and opening bold so the first token is the primary link.
    const head = content.replace(/^⭐\s*/, "").replace(/^\*\*/, "")
    const m = /^\[([^\]]+)\]\(([^)]+)\)/.exec(head)
    if (!m) continue

    const name = m[1].replace(/[​-‏⁠]/g, "").trim()
    const url = m[2].trim()
    if (!name || !/^https?:\/\//.test(url)) continue

    const dash = content.indexOf(" - ")
    const description = dash >= 0 ? stripMarkdown(content.slice(dash + 3)) : ""
    entries.push({ section, name, url, description, starred })
  }
  return entries
}

// One announce URL per line (udp/http(s)/ws(s)); non-URL lines dropped, then capped.
export function parseTrackerList(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^(udp|https?|wss?):\/\//.test(line))
    .slice(0, MAX_TRACKERS)
}
