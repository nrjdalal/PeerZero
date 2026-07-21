// Unit suite for the native mpv player's pure logic (web/next/src/lib/mpv-tracks.ts): the subtitle
// default-pick preference order and the seconds-based time formatting. These are the non-obvious
// "brains" of the player that would silently degrade under a refactor - the GL rendering and live
// playback are verified manually (see tests/README.md), but this logic runs headless in CI.
//
// Imported by relative path (web/next is a Next app, not a published package), so this suite needs
// no alias/bunfig - the module is dependency-free by design.
import { describe, expect, test } from "bun:test"

import {
  fmtTime,
  isEnglish,
  label,
  type MpvTrack,
  pickDefaultSub,
  subScore,
} from "../../web/next/src/lib/mpv-tracks.ts"

// Minimal track factory - only the fields the pickers read.
function sub(partial: Partial<MpvTrack> & { id: number }): MpvTrack {
  return { type: "sub", ...partial }
}

describe("fmtTime", () => {
  test("mm:ss below an hour, zero-padded seconds", () => {
    expect(fmtTime(0)).toBe("0:00")
    expect(fmtTime(5)).toBe("0:05")
    expect(fmtTime(65)).toBe("1:05")
    expect(fmtTime(600)).toBe("10:00")
    expect(fmtTime(3599)).toBe("59:59")
  })

  test("h:mm:ss at or past an hour, zero-padded minutes", () => {
    expect(fmtTime(3600)).toBe("1:00:00")
    expect(fmtTime(3661)).toBe("1:01:01")
    expect(fmtTime(7325)).toBe("2:02:05")
  })

  test("floors fractional seconds", () => {
    expect(fmtTime(65.9)).toBe("1:05")
  })

  test("clamps negative and non-finite to 0:00 (guards mid-seek remaining-time math)", () => {
    expect(fmtTime(-1)).toBe("0:00")
    expect(fmtTime(-3600)).toBe("0:00")
    expect(fmtTime(Number.NaN)).toBe("0:00")
    expect(fmtTime(Number.POSITIVE_INFINITY)).toBe("0:00")
  })
})

describe("isEnglish", () => {
  test("matches en / eng / en-* case-insensitively", () => {
    expect(isEnglish(sub({ id: 1, lang: "en" }))).toBe(true)
    expect(isEnglish(sub({ id: 1, lang: "eng" }))).toBe(true)
    expect(isEnglish(sub({ id: 1, lang: "EN" }))).toBe(true)
    expect(isEnglish(sub({ id: 1, lang: "en-US" }))).toBe(true)
  })

  test("rejects other languages and missing lang", () => {
    expect(isEnglish(sub({ id: 1, lang: "es" }))).toBe(false)
    expect(isEnglish(sub({ id: 1, lang: "jpn" }))).toBe(false)
    expect(isEnglish(sub({ id: 1 }))).toBe(false)
  })
})

describe("subScore (CC > SDH > Default > Forced)", () => {
  test("CC scores highest, by word or full phrase", () => {
    expect(subScore(sub({ id: 1, title: "English CC" }))).toBe(4)
    expect(subScore(sub({ id: 1, title: "Closed Captions" }))).toBe(4)
    expect(subScore(sub({ id: 1, title: "closed-caption" }))).toBe(4)
  })

  test("SDH below CC", () => {
    expect(subScore(sub({ id: 1, title: "English SDH" }))).toBe(3)
  })

  test("default above forced, forced above plain", () => {
    expect(subScore(sub({ id: 1, default: true }))).toBe(2)
    expect(subScore(sub({ id: 1, forced: true }))).toBe(1)
    expect(subScore(sub({ id: 1, title: "English" }))).toBe(0)
  })

  test("title cue wins over flags (a CC track that is also default is still CC)", () => {
    expect(subScore(sub({ id: 1, title: "English CC", default: true, forced: true }))).toBe(4)
  })

  test("does not treat an arbitrary 'cc' substring as closed-caption", () => {
    // \bcc\b is word-bounded, so "soccer" must not score as CC.
    expect(subScore(sub({ id: 1, title: "soccer commentary" }))).toBe(0)
  })
})

describe("pickDefaultSub", () => {
  test("returns null when there is no English track (never forces a foreign sub)", () => {
    expect(pickDefaultSub([sub({ id: 1, lang: "es" }), sub({ id: 2, lang: "jpn" })])).toBeNull()
    expect(pickDefaultSub([])).toBeNull()
  })

  test("picks the highest-scoring English track", () => {
    const tracks = [
      sub({ id: 10, lang: "en", forced: true }),
      sub({ id: 11, lang: "en", title: "English SDH" }),
      sub({ id: 12, lang: "en", title: "English CC" }),
      sub({ id: 13, lang: "en", default: true }),
    ]
    expect(pickDefaultSub(tracks)).toBe(12) // CC wins
  })

  test("ignores non-English tracks even when they score higher", () => {
    const tracks = [
      sub({ id: 1, lang: "es", title: "Spanish CC" }), // score 4 but not English
      sub({ id: 2, lang: "en", forced: true }), // score 1, English
    ]
    expect(pickDefaultSub(tracks)).toBe(2)
  })

  test("falls back to a plain English track when none carry cues/flags", () => {
    const tracks = [sub({ id: 7, lang: "en" }), sub({ id: 8, lang: "eng" })]
    expect(pickDefaultSub(tracks)).toBe(7) // stable: first among equal scores
  })
})

describe("label", () => {
  test("joins title and lang", () => {
    expect(label({ id: 1, type: "sub", title: "English SDH", lang: "en" }, 0)).toBe(
      "English SDH - en",
    )
  })

  test("uses whichever of title/lang is present", () => {
    expect(label({ id: 1, type: "sub", title: "Signs & Songs" }, 0)).toBe("Signs & Songs")
    expect(label({ id: 1, type: "sub", lang: "jpn" }, 0)).toBe("jpn")
  })

  test("falls back to a 1-based track number when it has neither", () => {
    expect(label({ id: 1, type: "sub" }, 0)).toBe("Track 1")
    expect(label({ id: 1, type: "sub" }, 4)).toBe("Track 5")
  })
})
