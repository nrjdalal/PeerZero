// Per-provider liveness. After repeated failures a provider auto-disables (skipped by
// search); a canary re-probes disabled/stale ones so a recovered source re-enables itself.
// State is in-memory (resets on restart).

// Consecutive failures before auto-disable. High so a transient timeout doesn't disable
// a healthy source.
const DISABLE_AFTER = 5
const CANARY_TTL_MS = 10 * 60 * 1000 // re-probe a healthy-but-stale provider at most this often
// Disabled providers are re-probed more eagerly so a recovery is noticed within a minute
// or two rather than waiting the full TTL.
const DISABLED_RETRY_MS = 90 * 1000

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
    record.error = undefined
  } else {
    record.status = "down"
    record.consecutiveFailures += 1
    record.error = sample.error
    if (record.consecutiveFailures >= DISABLE_AFTER) record.disabled = true
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
  const window = record.disabled ? DISABLED_RETRY_MS : CANARY_TTL_MS
  return Date.now() - new Date(record.checkedAt).getTime() > window
}

export function getHealthReport(): HealthRecord[] {
  return [...records.values()]
}
