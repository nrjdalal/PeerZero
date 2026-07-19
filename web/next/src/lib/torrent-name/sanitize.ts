// Validate + sanitize a generated display name before it's persisted. Returns the clean
// string, or null when the output is unusable (empty, or a clearly malformed multi-line
// response) - in which case the caller keeps the original torrent name.

const MAX_LENGTH = 200

export function sanitizeDisplayName(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null
  // A well-behaved generator returns one line. Treat multiple non-empty lines as malformed
  // (e.g. an explanation leaked in) and reject rather than mangle them into a run-on.
  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
  if (lines.length > 1) return null
  let s = (lines[0] ?? "").replace(/\s+/g, " ").trim()
  // Strip surrounding quotes/backticks the model sometimes wraps the answer in.
  s = s.replace(/^["'`]+|["'`]+$/g, "").trim()
  if (!s) return null
  if (s.length > MAX_LENGTH) s = s.slice(0, MAX_LENGTH).trim()
  return s || null
}
