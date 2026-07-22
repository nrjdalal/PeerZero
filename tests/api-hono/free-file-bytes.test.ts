// Unit tests for the per-file "free the exclusive pieces, keep the shared boundary slivers" disk
// logic (freeFileBytes / exclusivePieceRange in the engine). Runs under the golden runner's isolated
// HOME (importing the engine boots it), but these tests only exercise the pure disk helpers against
// their own temp files - they never touch the engine's state.
import { describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { exclusivePieceRange, freeFileBytes } from "@/lib/torrent/webtorrent.mjs"

const P = 16384 // 16 KiB pieces, a multiple of the 4 KiB fs block so holes align and reclaim cleanly

// A torrent + file shim exposing exactly what the helpers read. bitfield.get()->true models a fully
// downloaded torrent (every piece "have"), so freeFileBytes preserves the tail sliver.
function torrent(pieceLength: number, lastPieceLength: number, numPieces: number) {
  return {
    pieceLength,
    lastPieceLength,
    pieces: { length: numPieces },
    bitfield: { get: () => true },
  }
}
function file(offset: number, length: number, pieceLength: number) {
  return {
    offset,
    length,
    _startPiece: Math.floor(offset / pieceLength),
    _endPiece: Math.floor((offset + length - 1) / pieceLength),
  }
}
const patternByte = (i: number) => (i % 251) + 1 // deterministic, never 0 (so a hole is distinguishable)

type Case = {
  name: string
  t: ReturnType<typeof torrent>
  offset: number
  length: number
  keepHead?: number // bytes [0, keepHead) preserved
  keepTailFrom?: number // bytes [keepTailFrom, length) preserved
  none?: boolean // no exclusive piece -> disk untouched
}

const cases: Case[] = [
  {
    name: "both boundaries shared",
    t: torrent(P, P, 10),
    offset: 8192,
    length: 40000,
    keepHead: 8192,
    keepTailFrom: 24576,
  },
  {
    name: "aligned both ends (whole file freed)",
    t: torrent(P, P, 10),
    offset: 16384,
    length: 32768,
    keepHead: 0,
    keepTailFrom: 32768,
  },
  {
    name: "head shared only",
    t: torrent(P, P, 10),
    offset: 8192,
    length: 24576,
    keepHead: 8192,
    keepTailFrom: 24576,
  },
  {
    name: "tail shared only",
    t: torrent(P, P, 10),
    offset: 16384,
    length: 24576,
    keepHead: 0,
    keepTailFrom: 16384,
  },
  {
    name: "sub-piece file (no exclusive piece, no disk change)",
    t: torrent(P, P, 10),
    offset: 8192,
    length: 4000,
    none: true,
  },
  // last file: piece 2 is the torrent's final (short) piece -> exercises lastPieceLength
  {
    name: "last file, short final piece",
    t: torrent(P, 8192, 3),
    offset: 8192,
    length: 32768,
    keepHead: 8192,
    keepTailFrom: 32768,
  },
]

describe("freeFileBytes", () => {
  for (const c of cases) {
    test(c.name, () => {
      const dir = mkdtempSync(join(tmpdir(), "pz-freebytes-"))
      const path = join(dir, "file.bin")
      try {
        const original = Buffer.alloc(c.length)
        for (let i = 0; i < c.length; i++) original[i] = patternByte(i)
        writeFileSync(path, original)
        const before = statSync(path)
        const f = file(c.offset, c.length, c.t.pieceLength)

        const range = exclusivePieceRange(c.t, f)
        expect(range.none).toBe(!!c.none)

        freeFileBytes(c.t, f, path)

        const after = statSync(path)
        const buf = readFileSync(path)
        expect(after.size).toBe(c.length) // logical size never changes (sparse re-extend)

        if (c.none) {
          expect(buf.equals(original)).toBe(true) // untouched
          expect(after.blocks).toBe(before.blocks)
          return
        }

        const keepHead = c.keepHead ?? 0
        const keepTailFrom = c.keepTailFrom ?? c.length
        for (let i = 0; i < keepHead; i++) expect(buf[i]).toBe(patternByte(i)) // head sliver preserved
        for (let i = keepTailFrom; i < c.length; i++) expect(buf[i]).toBe(patternByte(i)) // tail sliver preserved
        for (let i = keepHead; i < keepTailFrom; i++) expect(buf[i]).toBe(0) // exclusive middle zeroed
        // Reclaim: a file with no tail sliver frees via pure ftruncate on every filesystem; a
        // tail-sliver file frees via a write-past-EOF hole on ext4/xfs (Linux/CI) but not on APFS,
        // where the tail rewrite re-allocates the middle (still correct + neighbor-safe). See freeFileBytes.
        const tailLen = c.length - keepTailFrom
        if (tailLen === 0 || process.platform !== "darwin") {
          expect(after.blocks).toBeLessThan(before.blocks) // blocks reclaimed
        } else {
          expect(after.blocks).toBeLessThanOrEqual(before.blocks) // never grows (APFS: stays allocated)
        }
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    })
  }
})
