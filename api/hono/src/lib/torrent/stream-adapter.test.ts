// Regression guard for the /stream 500 under Bun.
//
// The engine builds the Range response body from webtorrent's node read stream. Bun's
// `Readable.toWeb()` throws on that specific stream ("QueuingStrategyInit.highWaterMark member is
// required"), which 500'd /stream for any completed file. `nodeToWebStream` replaces it; this
// locks that the adapter yields the exact bytes across multiple chunks and propagates errors.
import { expect, test } from "bun:test"
import { Readable } from "node:stream"

import { nodeToWebStream } from "@/lib/torrent/stream-adapter.mjs"

test("nodeToWebStream yields the exact bytes across chunks", async () => {
  const data = Buffer.from(Array.from({ length: 1024 }, (_, i) => i % 256))
  // Two chunks, so the adapter is exercised past a single enqueue.
  const node = Readable.from([data.subarray(0, 500), data.subarray(500)])
  const out = new Uint8Array(await new Response(nodeToWebStream(node)).arrayBuffer())
  expect(out.length).toBe(1024)
  expect(Buffer.compare(Buffer.from(out), data)).toBe(0)
})

test("propagates a node stream error to the web stream", async () => {
  const node = new Readable({
    read() {
      this.destroy(new Error("boom"))
    },
  })
  await expect(new Response(nodeToWebStream(node)).arrayBuffer()).rejects.toThrow()
})
