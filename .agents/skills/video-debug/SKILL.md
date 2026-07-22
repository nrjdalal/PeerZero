---
name: video-debug
description: Catch transient visual bugs a screenshot can't - a one-frame flash on open, a stale/half-painted region, compositor starvation, a jank during a transition. Screen-record the moment, then extract and inspect frames. Use when a bug is real but too fast to see, or a fix "should" work but you can't confirm it live.
---

# Video Debugging

A screenshot samples one moment; the bugs that survive rounds of guessing live *between* moments - a frame that flashes the old UI on open, a region that stays stale until the next input, a compositor that drops the webview's paint while a native layer draws. Record the transition, slow it down, and look. Seeing the actual frames beats another round of reasoning about what "should" happen.

This is the method that cracked the native mpv player's open-flash and close-crop after three wrong web-side guesses: the frames showed the black overlay already covered the shell, which killed the timing theory and pointed at native repaint starvation instead.

## 1. Record the transition

`screencapture` records video with no extra tools or permissions prompts (beyond the one-time Screen Recording grant):

```bash
screencapture -v -V 8 out.mov     # -v = video, -V <seconds> = duration
```

Trigger the transition (open/close/hover/route change) during the window. If the bug is rare or you can't drive it by hand, make a **harness** that reproduces it deterministically on a timer - e.g. a component that toggles the suspect element every 1-3s so many transitions land in one recording. Keep each state long enough (2-3s) that steady state and the transition are both legible.

## 2. Find the transition frames

Don't eyeball a long clip. Locate transitions by per-frame luma (a black overlay dips, a reveal jumps):

```bash
ffmpeg -loglevel error -i out.mov -vf "fps=30,scale=160:100,signalstats,metadata=print:file=luma.txt" -f null -
# then scan luma.txt for lavfi.signalstats.YAVG jumps/drops -> those timestamps are your transitions
```

A **perfectly constant** luma across many frames = nothing on screen changed at all (a frozen/paused frame or a starved compositor), which is itself a signal.

## 3. Inspect the actual frames

Pull full-res stills at the transition timestamps (accurate seek, not montage guesswork):

```bash
ffmpeg -loglevel error -ss 2.27 -i out.mov -vframes 1 frame.png   # -ss before -i = fast keyframe-accurate seek
```

For an overview, tile many frames into contact sheets (`fps=30,scale=560:-1,tile=6x5` = 30 frames/sheet), then zoom into the interesting one full-res. Native capture on ProMotion is 240fps, so `fps=30` downsamples to something readable.

## Repaint heartbeat (compositor starvation)

To prove a webview/canvas stopped painting (vs. a logic bug), overlay a number that increments every frame via **direct DOM** (not React state, which adds its own churn), on top of everything:

```tsx
function Heartbeat() {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    let raf = 0, n = 0
    const loop = () => { if (ref.current) ref.current.textContent = String(n++); raf = requestAnimationFrame(loop) }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [])
  return <div ref={ref} style={{ position: "fixed", top: 2, left: "50%", zIndex: 2147483647, color: "#0f0", background: "#000", fontFamily: "monospace" }} />
}
```

A montage frame where the painted number is **frozen** (while the DOM value is still advancing) proves the paint - not the JS - was starved. That distinction redirects the fix from React/CSS to the native/compositor layer.

## Gotchas

- **Multiple app instances contaminate the capture.** An installed build and your dev build are both named `app`; a full-screen instance sits on its own macOS Space and will dominate the recording. Confirm which you filmed (`ps aux | grep MacOS/app` by path; the heartbeat is present only in your harness build), and target a specific one by PID: `osascript -e 'tell application "System Events" to set frontmost of (first process whose unix id is <PID>) to true'`. A full-screen other-instance can still win the foreground - quit or un-fullscreen it (never the user's, if it's theirs) before recording.
- **`drawtext` is often missing** from Homebrew ffmpeg; don't burn frame numbers in with it - derive time from `frame_index / fps` instead.
- **Verify the harness reproduces the real load.** A dummy/never-loading source won't exercise a decode/GPU path, so a starvation that only appears under real render load won't show. Point the harness at a real source.
- **Transients are 16-33ms.** Burst screenshots (~100ms apart) miss them; only video (240/60/30fps) catches them.
