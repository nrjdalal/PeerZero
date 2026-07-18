// Publish the local plaintext registry (registry.plain.json, gitignored) into the encoded
// registry.json the app reads. Run after editing the plaintext registry:
//
//   bun .github/scripts/seal-registry.ts

import { resolve } from "node:path"

import { seal } from "../../api/hono/src/lib/torrent/codec"

const DIR = resolve(import.meta.dir, "../../api/hono/src/lib/torrent")
const PLAIN = resolve(DIR, "registry.plain.json")
const ENCODED = resolve(DIR, "registry.json")

const data = await Bun.file(PLAIN).json()
const encoded = seal(JSON.stringify(data))
await Bun.write(ENCODED, `${JSON.stringify({ data: encoded }, null, 2)}\n`)

console.log(
  `[seal] ${data.defs?.length ?? 0} defs, ${data.bespoke?.length ?? 0} bespoke, ` +
    `${data.trackers?.list?.length ?? 0} trackers, ${data.directory?.entries?.length ?? 0} indexes ` +
    `-> ${encoded.length} chars`,
)
