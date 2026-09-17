// Unit suite for the native player's picture-in-picture geometry (web/next/src/lib/pip-geometry.ts):
// where the mini player lands on a screen and how it degrades on a small one. The window calls that
// apply it (use-player-window.ts) need a real Tauri window, so they are verified in the desktop app (see
// tests/README.md); this is the placement math they rely on, run headless.
//
// Imported by relative path like mpv-tracks.test.ts: the module is dependency-free by design.
import { describe, expect, test } from "bun:test"

import {
  MAIN_MIN_SIZE,
  PIP_MARGIN,
  PIP_MIN_SIZE,
  PIP_SIZE,
  pipFrame,
  toLogical,
} from "../../web/next/src/lib/pip-geometry.ts"

describe("pipFrame", () => {
  test("bottom-right corner of the work area, inset by the margin, at the full PiP size", () => {
    // A 14" MacBook Pro work area: 1512x982 points, below a 33pt menu bar.
    const work = { x: 0, y: 33, width: 1512, height: 949 }
    expect(pipFrame(work)).toEqual({
      x: 1512 - PIP_MARGIN - PIP_SIZE.width,
      y: 33 + 949 - PIP_MARGIN - PIP_SIZE.height,
      width: PIP_SIZE.width,
      height: PIP_SIZE.height,
    })
  })

  test("respects a work area offset by a left Dock or a secondary display", () => {
    const work = { x: -1920, y: 120, width: 1920, height: 1080 }
    const frame = pipFrame(work)
    expect(frame.x + frame.width).toBe(work.x + work.width - PIP_MARGIN)
    expect(frame.y + frame.height).toBe(work.y + work.height - PIP_MARGIN)
    expect(frame.x).toBeGreaterThanOrEqual(work.x)
  })

  test("shrinks on a small work area, keeping 16:9 and staying inside it", () => {
    const work = { x: 0, y: 0, width: 400, height: 600 }
    const frame = pipFrame(work)
    expect(frame.width).toBe(400 - 2 * PIP_MARGIN)
    expect(frame.width / frame.height).toBeCloseTo(16 / 9, 1)
    expect(frame.x).toBe(PIP_MARGIN)
    expect(frame.x + frame.width).toBeLessThanOrEqual(work.width)
  })

  test("never goes below the minimum size, and never starts above or left of the work area", () => {
    const work = { x: 10, y: 20, width: 100, height: 50 }
    const frame = pipFrame(work)
    expect(frame.width).toBe(PIP_MIN_SIZE.width)
    expect(frame.height).toBe(PIP_MIN_SIZE.height)
    expect(frame.x).toBe(work.x)
    expect(frame.y).toBe(work.y)
  })

  test("returns whole logical pixels", () => {
    const frame = pipFrame({ x: 0.5, y: 24.5, width: 1000.25, height: 700.75 })
    for (const v of Object.values(frame)) expect(Number.isInteger(v)).toBe(true)
  })
})

describe("sizes", () => {
  test("the PiP floor fits inside the PiP size, which fits inside the main window's floor", () => {
    expect(PIP_MIN_SIZE.width).toBeLessThanOrEqual(PIP_SIZE.width)
    expect(PIP_MIN_SIZE.height).toBeLessThanOrEqual(PIP_SIZE.height)
    expect(PIP_SIZE.width).toBeLessThan(MAIN_MIN_SIZE.width)
    expect(PIP_SIZE.height).toBeLessThan(MAIN_MIN_SIZE.height)
  })

  test("MAIN_MIN_SIZE mirrors the min_inner_size set on the window in lib.rs", async () => {
    const lib = await Bun.file(
      new URL("../../desktop/src-tauri/src/lib.rs", import.meta.url),
    ).text()
    expect(lib).toContain(
      `.min_inner_size(${MAIN_MIN_SIZE.width.toFixed(1)}, ${MAIN_MIN_SIZE.height.toFixed(1)})`,
    )
  })
})

describe("toLogical", () => {
  test("divides by the scale factor, treating a missing factor as 1", () => {
    expect(toLogical(3024, 2)).toBe(1512)
    expect(toLogical(1080, 1)).toBe(1080)
    expect(toLogical(1080, 0)).toBe(1080)
  })
})
