import { describe, expect, test } from "bun:test"

import { torrentNameGenerator } from "./index"
import { cleanNameFromRaw, parseTorrentName } from "./parse"
import { sanitizeDisplayName } from "./sanitize"

describe("parseTorrentName", () => {
  test("movie: extracts title + year, drops tags and release group", () => {
    const p = parseTorrentName("The.Matrix.1999.2160p.UHD.BluRay.x265-GROUP")
    expect(p.title).toBe("The Matrix")
    expect(p.year).toBe(1999)
    expect(p.season).toBeUndefined()
  })

  test("tv: extracts title + season/episode", () => {
    const p = parseTorrentName("Some.Show.S01E05.1080p.WEB-DL.DDP5.1.H.264-NTb")
    expect(p.title).toBe("Some Show")
    expect(p.season).toBe(1)
    expect(p.episode).toBe(5)
  })

  test("capitalizes purely-lowercase source words", () => {
    expect(parseTorrentName("ubuntu-desktop").title).toBe("Ubuntu Desktop")
  })
})

describe("cleanNameFromRaw", () => {
  test("movie -> 'Title (Year)'", () => {
    expect(cleanNameFromRaw("The.Matrix.1999.2160p.BluRay.x265-GRP")).toBe("The Matrix (1999)")
  })
  test("tv -> 'Title SxxExx'", () => {
    expect(cleanNameFromRaw("Some.Show.S01E05.1080p.WEB-DL-NTb")).toBe("Some Show S01E05")
  })
  test("strips a media extension", () => {
    expect(cleanNameFromRaw("Big.Buck.Bunny.2008.mkv")).toBe("Big Buck Bunny (2008)")
  })
})

describe("sanitizeDisplayName", () => {
  test("trims + collapses internal whitespace", () => {
    expect(sanitizeDisplayName("  The   Matrix  ")).toBe("The Matrix")
  })
  test("strips surrounding quotes/backticks", () => {
    expect(sanitizeDisplayName('"The Matrix"')).toBe("The Matrix")
    expect(sanitizeDisplayName("`The Matrix`")).toBe("The Matrix")
  })
  test("rejects empty / whitespace-only", () => {
    expect(sanitizeDisplayName("")).toBeNull()
    expect(sanitizeDisplayName("   ")).toBeNull()
  })
  test("rejects malformed multi-line output", () => {
    expect(sanitizeDisplayName("Here is the cleaned name:\nThe Matrix")).toBeNull()
  })
  test("rejects non-strings", () => {
    expect(sanitizeDisplayName(null)).toBeNull()
    expect(sanitizeDisplayName(undefined)).toBeNull()
  })
  test("caps very long names", () => {
    const out = sanitizeDisplayName("a".repeat(500))
    expect(out).not.toBeNull()
    expect((out as string).length).toBeLessThanOrEqual(200)
  })
})

// In bun test there is no on-device LanguageModel, so the generator falls back to the parser.
describe("torrentNameGenerator (AI unavailable -> deterministic parser)", () => {
  test("cleans a raw name via the parser when AI is unavailable", async () => {
    const out = await torrentNameGenerator.generateName({
      originalName: "The.Matrix.1999.1080p.BluRay.x264-GRP",
    })
    expect(out).toBe("The Matrix (1999)")
  })
  test("returns null when there's no meaningful improvement over the original", async () => {
    expect(await torrentNameGenerator.generateName({ originalName: "Ubuntu" })).toBeNull()
  })
})
