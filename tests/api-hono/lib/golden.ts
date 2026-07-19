// The golden-test "way": a golden file is the committed, canonical serialization of a response;
// the suite asserts every run reproduces it exactly. Volatile fields (versions, temp paths, times,
// speeds) are normalized out by the caller before matching. Regenerate after an intended contract
// change with `UPDATE_GOLDEN=1` (also auto-writes a missing golden on first run).
import { expect } from "bun:test"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"

const GOLDEN_DIR = join(import.meta.dir, "..", "golden")
const UPDATE = process.env.UPDATE_GOLDEN === "1" || process.env.UPDATE_GOLDEN === "true"

function writeFile(file: string, data: string | Buffer) {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, data)
}

// Compare a JSON-serializable value against golden/<name>.txt. The content is pretty JSON, but the
// extension is .txt so the formatter/linter leave these opaque snapshots alone (oxfmt would
// otherwise re-inline short arrays and diverge from what this harness writes).
export function matchGolden(name: string, value: unknown) {
  const file = join(GOLDEN_DIR, `${name}.txt`)
  const serialized = `${JSON.stringify(value, null, 2)}\n`
  if (UPDATE || !existsSync(file)) {
    writeFile(file, serialized)
    return
  }
  expect(serialized).toBe(readFileSync(file, "utf8"))
}

// Compare raw bytes against golden/<name>.bin.
export function matchGoldenBytes(name: string, bytes: Uint8Array) {
  const file = join(GOLDEN_DIR, `${name}.bin`)
  const buf = Buffer.from(bytes)
  if (UPDATE || !existsSync(file)) {
    writeFile(file, buf)
    return
  }
  expect(Buffer.compare(buf, readFileSync(file))).toBe(0)
}
