import { describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"

import {
  hardlinkTargets,
  isVideoFile,
  jellyfinRelPath,
  libraryTargets,
  parseMediaName,
  sameFilesystem,
} from "./media-library.mjs"

describe("parseMediaName", () => {
  test("movie: title + year, quality captured as tags", () => {
    const p = parseMediaName("The.Matrix.1999.2160p.UHD.BluRay.x265-GROUP")
    expect(p.title).toBe("The Matrix")
    expect(p.year).toBe(1999)
    expect(p.season).toBeUndefined()
    expect(p.episode).toBeUndefined()
    // Recognized quality/source/codec terms are kept (cleaned), the release group dropped.
    expect(p.tags).toBe("2160p UHD BluRay x265")
  })

  test("multi-episode range is captured (S01E01-E02)", () => {
    const p = parseMediaName("Firefly.S01E01-E02.1080p.BluRay.x264")
    expect(p.season).toBe(1)
    expect(p.episode).toBe(1)
    expect(p.episodeEnd).toBe(2)
    expect(p.tags).toBe("1080p BluRay x264")
  })

  test("tv: title + season + episode", () => {
    const p = parseMediaName("Rick.and.Morty.S09E08.1080p.WEB.h264-EDITH")
    expect(p.title).toBe("Rick and Morty")
    expect(p.season).toBe(9)
    expect(p.episode).toBe(8)
  })

  test("all-tags name yields an empty title (so the show title can be borrowed)", () => {
    expect(parseMediaName("S01E01.mkv").title).toBe("")
  })
})

describe("jellyfinRelPath", () => {
  test("movie -> Movies/Title (Year)/Title (Year).ext", () => {
    expect(jellyfinRelPath({ title: "The Matrix", year: 1999, ext: "mkv" })).toBe(
      join("Movies", "The Matrix (1999)", "The Matrix (1999).mkv"),
    )
  })

  test("tv -> Shows/Title (Year)/Season NN/Title SxxEyy.ext", () => {
    expect(
      jellyfinRelPath({ title: "Rick and Morty", year: 2013, season: 9, episode: 8, ext: "mkv" }),
    ).toBe(join("Shows", "Rick and Morty (2013)", "Season 09", "Rick and Morty S09E08.mkv"))
  })

  test("tv without a year omits the (Year) folder suffix", () => {
    expect(jellyfinRelPath({ title: "Some Show", season: 1, episode: 5, ext: "mp4" })).toBe(
      join("Shows", "Some Show", "Season 01", "Some Show S01E05.mp4"),
    )
  })

  test("yearless movie only links when explicitly allowed", () => {
    expect(jellyfinRelPath({ title: "Big Buck Bunny", ext: "mkv" })).toBeNull()
    expect(
      jellyfinRelPath({ title: "Big Buck Bunny", ext: "mkv" }, { allowYearlessMovie: true }),
    ).toBe(join("Movies", "Big Buck Bunny", "Big Buck Bunny.mkv"))
  })

  test("null when there's no usable title or extension", () => {
    expect(jellyfinRelPath({ title: "", year: 1999, ext: "mkv" })).toBeNull()
    expect(jellyfinRelPath({ title: "Movie", year: 1999, ext: "" })).toBeNull()
  })

  test("strips filesystem-illegal characters, keeps spaces/hyphens", () => {
    expect(jellyfinRelPath({ title: "A: B/C? Spider-Man", year: 2002, ext: "mkv" })).toBe(
      join("Movies", "A BC Spider-Man (2002)", "A BC Spider-Man (2002).mkv"),
    )
  })

  test("appends the quality tags as a Jellyfin version suffix", () => {
    expect(
      jellyfinRelPath({ title: "The Matrix", year: 1999, ext: "mkv", tags: "2160p BluRay Remux" }),
    ).toBe(join("Movies", "The Matrix (1999)", "The Matrix (1999) - 2160p BluRay Remux.mkv"))
    // The movie file always begins with the folder name (Jellyfin's multi-version requirement).
    expect(
      jellyfinRelPath({
        title: "The Matrix",
        season: 1,
        episode: 2,
        ext: "mkv",
        tags: "1080p WEB",
      }),
    ).toBe(join("Shows", "The Matrix", "Season 01", "The Matrix S01E02 - 1080p WEB.mkv"))
  })

  test("formats a multi-episode range as SxxEyy-Ezz", () => {
    expect(
      jellyfinRelPath({ title: "Firefly", season: 1, episode: 1, episodeEnd: 2, ext: "mkv" }),
    ).toBe(join("Shows", "Firefly", "Season 01", "Firefly S01E01-E02.mkv"))
  })
})

describe("isVideoFile", () => {
  test("accepts known containers, rejects samples and non-video", () => {
    expect(isVideoFile("Movie.1999.mkv")).toBe(true)
    expect(isVideoFile("Movie.1999.sample.mkv")).toBe(false)
    expect(isVideoFile("readme.txt")).toBe(false)
    expect(isVideoFile("cover.jpg")).toBe(false)
  })
})

describe("libraryTargets", () => {
  test("single movie file -> one Movie target; yearless fallback allowed", () => {
    const t = libraryTargets("Big.Buck.Bunny.mkv", [
      { name: "Big.Buck.Bunny.mkv", path: "Big.Buck.Bunny.mkv" },
    ])
    expect(t).toEqual([
      {
        srcRel: "Big.Buck.Bunny.mkv",
        destRel: join("Movies", "Big Buck Bunny", "Big Buck Bunny.mkv"),
      },
    ])
  })

  test("season pack: each episode file resolves individually, borrowing the show title", () => {
    const t = libraryTargets("Rick and Morty S09 1080p WEB", [
      {
        name: "Rick.and.Morty.S09E01.1080p.mkv",
        path: "Rick and Morty S09/Rick.and.Morty.S09E01.1080p.mkv",
      },
      {
        name: "Rick.and.Morty.S09E02.1080p.mkv",
        path: "Rick and Morty S09/Rick.and.Morty.S09E02.1080p.mkv",
      },
      { name: "sample.mkv", path: "Rick and Morty S09/sample.mkv" },
      { name: "readme.txt", path: "Rick and Morty S09/readme.txt" },
    ])
    expect(t).toEqual([
      {
        srcRel: "Rick and Morty S09/Rick.and.Morty.S09E01.1080p.mkv",
        destRel: join("Shows", "Rick and Morty", "Season 09", "Rick and Morty S09E01 - 1080p.mkv"),
      },
      {
        srcRel: "Rick and Morty S09/Rick.and.Morty.S09E02.1080p.mkv",
        destRel: join("Shows", "Rick and Morty", "Season 09", "Rick and Morty S09E02 - 1080p.mkv"),
      },
    ])
  })

  test("episode files named only SxxEyy borrow the show title and quality from the torrent name", () => {
    const t = libraryTargets("The.Show.2020.S02.1080p", [
      { name: "S02E03.mkv", path: "The.Show.2020.S02/S02E03.mkv" },
    ])
    expect(t).toEqual([
      {
        srcRel: "The.Show.2020.S02/S02E03.mkv",
        destRel: join("Shows", "The Show (2020)", "Season 02", "The Show S02E03 - 1080p.mkv"),
      },
    ])
  })

  test("ambiguous multi-file movie pack (no year, no episodes) is skipped", () => {
    const t = libraryTargets("Random Clips", [
      { name: "clip-one.mkv", path: "Random Clips/clip-one.mkv" },
      { name: "clip-two.mkv", path: "Random Clips/clip-two.mkv" },
    ])
    expect(t).toEqual([])
  })

  test("no video files -> no targets", () => {
    expect(
      libraryTargets("Some.Album.FLAC", [{ name: "01.flac", path: "Some.Album.FLAC/01.flac" }]),
    ).toEqual([])
  })
})

describe("hardlinkTargets", () => {
  test("creates hardlinks (shared inode), is idempotent, guards traversal and missing sources", () => {
    const base = mkdtempSync(join(tmpdir(), "pz-lib-src-"))
    const libRoot = mkdtempSync(join(tmpdir(), "pz-lib-dst-"))
    try {
      const srcRel = "The Matrix (1999)/The.Matrix.1999.mkv"
      const src = join(base, srcRel)
      mkdirSync(dirname(src), { recursive: true })
      writeFileSync(src, "video-bytes")
      const destRel = join("Movies", "The Matrix (1999)", "The Matrix (1999).mkv")

      const targets = [
        { srcRel, destRel },
        { srcRel: "missing.mkv", destRel: join("Movies", "Ghost", "Ghost.mkv") }, // no source -> skip
        { srcRel, destRel: join("..", "escape.mkv") }, // escapes libRoot -> skip
      ]

      const linked = hardlinkTargets(base, libRoot, targets)
      expect(linked).toBe(1)

      const dest = join(libRoot, destRel)
      expect(statSync(dest).ino).toBe(statSync(src).ino) // hardlink shares the inode

      // The "../escape.mkv" target must not have been created outside the library root.
      let escaped = false
      try {
        statSync(resolve(libRoot, "..", "escape.mkv"))
        escaped = true
      } catch {
        escaped = false
      }
      expect(escaped).toBe(false)

      // Re-running counts the existing link (EEXIST) instead of failing.
      expect(hardlinkTargets(base, libRoot, targets)).toBe(1)
    } finally {
      rmSync(base, { recursive: true, force: true })
      rmSync(libRoot, { recursive: true, force: true })
    }
  })

  test("two different files at the same name become versions ' (2)'; re-runs don't duplicate", () => {
    const base = mkdtempSync(join(tmpdir(), "pz-lib-src-"))
    const libRoot = mkdtempSync(join(tmpdir(), "pz-lib-dst-"))
    try {
      // Two DIFFERENT releases (distinct files) that parse to the same library path.
      writeFileSync(join(base, "a.mkv"), "release-A")
      writeFileSync(join(base, "b.mkv"), "release-B")
      const destRel = join("Movies", "The Matrix (1999)", "The Matrix (1999) - 1080p WEB.mkv")
      const targets = [
        { srcRel: "a.mkv", destRel },
        { srcRel: "b.mkv", destRel }, // same destination -> must get a " (2)" variant
      ]

      expect(hardlinkTargets(base, libRoot, targets)).toBe(2)

      const first = join(libRoot, destRel)
      const second = join(
        libRoot,
        "Movies",
        "The Matrix (1999)",
        "The Matrix (1999) - 1080p WEB (2).mkv",
      )
      // Each library entry points at its own release (distinct inodes), nothing overwritten.
      expect(statSync(first).ino).toBe(statSync(join(base, "a.mkv")).ino)
      expect(statSync(second).ino).toBe(statSync(join(base, "b.mkv")).ino)

      // Re-running links nothing new (both already present at their own names, matched by inode).
      expect(hardlinkTargets(base, libRoot, targets)).toBe(2)
      expect(
        existsSync(
          join(libRoot, "Movies", "The Matrix (1999)", "The Matrix (1999) - 1080p WEB (3).mkv"),
        ),
      ).toBe(false)
    } finally {
      rmSync(base, { recursive: true, force: true })
      rmSync(libRoot, { recursive: true, force: true })
    }
  })
})

describe("sameFilesystem", () => {
  test("a path shares a filesystem with itself; missing paths are false", () => {
    expect(sameFilesystem(tmpdir(), tmpdir())).toBe(true)
    expect(sameFilesystem(tmpdir(), join(tmpdir(), "pz-does-not-exist-xyz"))).toBe(false)
  })
})
