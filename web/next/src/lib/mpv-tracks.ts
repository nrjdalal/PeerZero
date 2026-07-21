// Pure track + time helpers for the native mpv player (mpv-player.tsx). Kept dependency-free (no
// React, no Tauri, no CSS) so the non-obvious logic - the subtitle default-pick preference order and
// the seconds-based time formatting - is unit-tested in isolation (tests/web-next/mpv-tracks.test.ts).

// One track as mpv reports it in `track-list` (subtitle, audio, or video).
export type MpvTrack = {
  id: number
  type: string
  lang?: string
  title?: string
  selected?: boolean
  default?: boolean
  forced?: boolean
  external?: boolean
}

// A subtitle track flattened for the picker menu.
export type Sub = { id: number; label: string }

// mm:ss (or h:mm:ss) from SECONDS (mpv reports time in seconds, unlike libmedia's milliseconds).
// Negative / non-finite inputs clamp to 0 so the overlay never shows "-1:59" mid-seek.
export function fmtTime(sec: number): string {
  const s = Math.max(0, Math.floor(Number.isFinite(sec) ? sec : 0))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = String(s % 60).padStart(2, "0")
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`
}

// English: the ISO 639-1/2 codes plus region-tagged variants (en-US, en-GB). Matching an exact set
// rather than startsWith("en") avoids false positives on ISO 639-3 codes like enq / enn / end.
export function isEnglish(t: MpvTrack): boolean {
  const l = (t.lang ?? "").toLowerCase()
  return l === "en" || l === "eng" || l.startsWith("en-")
}

// When several tracks share a language, the user's preference order is CC > SDH > Default > Forced.
// Score each so the best one wins; forced (foreign-parts-only) subs rank lowest.
export function subScore(t: MpvTrack): number {
  const title = (t.title ?? "").toLowerCase()
  if (/\bcc\b|closed[\s-]?caption/.test(title)) return 4
  if (/sdh/.test(title)) return 3
  if (t.default) return 2
  if (t.forced) return 1
  return 0
}

// Auto-pick the subtitle to enable by default: an English track, best by the CC>SDH>Default>Forced
// order. Returns null when there is no English track (we do not force a foreign-language subtitle).
export function pickDefaultSub(subs: MpvTrack[]): number | null {
  const english = subs.filter(isEnglish)
  if (!english.length) return null
  return [...english].sort((a, b) => subScore(b) - subScore(a))[0].id
}

// Human label for a track in the picker: "Title - lang", or "Track N" when it has neither.
export function label(t: MpvTrack, i: number): string {
  const parts = [t.title, t.lang].filter(Boolean)
  return parts.length ? parts.join(" - ") : `Track ${i + 1}`
}
