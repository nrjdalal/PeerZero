// Small display formatters for torrent stats.

export function formatBytes(bytes: number): string {
  if (!bytes || bytes < 0) return "0 B"
  const units = ["B", "KB", "MB", "GB", "TB"]
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const value = bytes / 1024 ** i
  return `${value.toFixed(value >= 100 || i === 0 ? 0 : 1)} ${units[i]}`
}

export function formatSpeed(bytesPerSec: number): string {
  if (!bytesPerSec || bytesPerSec < 1) return "0 B/s"
  return `${formatBytes(bytesPerSec)}/s`
}

// timeRemaining is milliseconds (or null before metadata resolves).
export function formatEta(ms: number | null): string {
  if (ms == null || !Number.isFinite(ms) || ms <= 0) return "-"
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${s % 60}s`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ${m % 60}m`
  return `${Math.floor(h / 24)}d ${h % 24}h`
}

export function formatPercent(fraction: number): string {
  return `${(Math.max(0, Math.min(1, fraction)) * 100).toFixed(1)}%`
}

// Short relative age from a unix-seconds timestamp, e.g. "3m ago", "5d ago", "2y ago".
export function formatAge(unixSeconds: number): string {
  if (!unixSeconds || unixSeconds < 0) return "-"
  const secs = Math.floor(Date.now() / 1000 - unixSeconds)
  if (secs < 0) return "-"
  if (secs < 60) return "just now"
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  const months = Math.floor(days / 30)
  if (months < 12) return `${months}mo ago`
  return `${Math.floor(days / 365)}y ago`
}
