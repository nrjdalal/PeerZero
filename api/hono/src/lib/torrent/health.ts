// Per-provider liveness. After repeated failures a provider auto-disables (skipped by
// search); a canary re-probes disabled/stale ones so a recovered source re-enables itself.
// State is in-memory (resets on restart).

// Consecutive failures before auto-disable. High so a transient timeout doesn't disable
// a healthy source.
const DISABLE_AFTER = 5
const CANARY_TTL_MS = 10 * 60 * 1000 // re-probe a healthy-but-stale provider at most this often
// A provider that keeps failing (dead, Cloudflare-gated, moved) is parked for a randomized
// 12-24h before the canary re-probes it, rather than hammering it every couple of minutes.
// The jitter spreads re-probes so they don't all fire at once. Note: Cloudflare challenges
// are IP-reputation based, so a source blocked here may still work from a home connection;
// the backoff just keeps a persistently-failing one from slowing every search.
const DISABLED_BACKOFF_MIN_MS = 12 * 60 * 60 * 1000
const DISABLED_BACKOFF_MAX_MS = 24 * 60 * 60 * 1000
const backoffMs = () =>
  DISABLED_BACKOFF_MIN_MS + Math.random() * (DISABLED_BACKOFF_MAX_MS - DISABLED_BACKOFF_MIN_MS)

export type HealthStatus = "unknown" | "up" | "down"

export type HealthRecord = {
  name: string
  status: HealthStatus
  disabled: boolean
  lastCount: number
  latencyMs: number | null
  error?: string
  checkedAt: string | null
  consecutiveFailures: number
  // While disabled, epoch ms before which the canary won't re-probe (the 12-24h backoff).
  retryAfter: number | null
}

export type HealthSample = { ok: boolean; count: number; latencyMs: number; error?: string }

const records = new Map<string, HealthRecord>()

function ensure(name: string): HealthRecord {
  let record = records.get(name)
  if (!record) {
    record = {
      name,
      status: "unknown",
      disabled: false,
      lastCount: 0,
      latencyMs: null,
      checkedAt: null,
      consecutiveFailures: 0,
      retryAfter: null,
    }
    records.set(name, record)
  }
  return record
}

// Fold one probe/search outcome into a provider's health. A success clears the failure
// streak and re-enables; a failure grows the streak and auto-disables at the threshold.
export function recordHealth(name: string, sample: HealthSample): void {
  const record = ensure(name)
  record.checkedAt = new Date().toISOString()
  record.latencyMs = sample.latencyMs
  record.lastCount = sample.count
  if (sample.ok) {
    record.status = "up"
    record.consecutiveFailures = 0
    record.disabled = false
    record.retryAfter = null
    record.error = undefined
  } else {
    record.status = "down"
    record.consecutiveFailures += 1
    record.error = sample.error
    if (record.consecutiveFailures >= DISABLE_AFTER) {
      record.disabled = true
      // Park it for 12-24h (re-parked on every failed re-probe) so a dead/blocked source
      // stops being queried until the backoff elapses.
      record.retryAfter = Date.now() + backoffMs()
    }
  }
}

export function isDisabled(name: string): boolean {
  return records.get(name)?.disabled ?? false
}

// Whether a canary should probe now: never checked, or its last check is older than the
// applicable window (short retry for disabled providers, long TTL for healthy ones).
export function shouldCanary(name: string): boolean {
  const record = records.get(name)
  if (!record?.checkedAt) return true
  // Disabled: wait out the 12-24h backoff. Healthy-but-stale: re-probe past the TTL.
  if (record.disabled) return Date.now() >= (record.retryAfter ?? 0)
  return Date.now() - new Date(record.checkedAt).getTime() > CANARY_TTL_MS
}

export function getHealthReport(): HealthRecord[] {
  return [...records.values()]
}
