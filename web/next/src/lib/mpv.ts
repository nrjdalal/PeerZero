import { invoke } from "@tauri-apps/api/core"
import { listen, type UnlistenFn } from "@tauri-apps/api/event"

// Thin IPC wrapper over the desktop shell's native mpv commands (src-tauri/src/mpv.rs). mpv renders on a
// native GL surface behind the transparent webview (the libmpv render API, IINA-style), and the backend
// observes a fixed set of properties (pause, time-pos, duration, eof-reached, track-list) and re-emits
// them as `mpv://property` events, plus lifecycle as `mpv://event`. This is the macOS-only playback
// engine; Windows/Linux desktop and the browser have no in-app player (playable files reveal on disk).

export type MpvPropertyEvent = { name: string; data: unknown }
export type MpvLifecycleEvent = { event: string }

export const mpv = {
  // Load + play a URL/path. The backend lazily creates the mpv instance + render context on first call.
  load: (url: string) => invoke<void>("mpv_load", { url }),
  stop: () => invoke<void>("mpv_stop"),
  setProperty: (name: string, value: string | number | boolean) =>
    invoke<void>("mpv_set_property", { name, value }),
  // mpv input commands take string args (e.g. ["seek", "30", "absolute"]).
  command: (args: (string | number | boolean)[]) =>
    invoke<void>("mpv_command", { args: args.map(String) }),
  onProperty: (cb: (name: string, data: unknown) => void): Promise<UnlistenFn> =>
    listen<MpvPropertyEvent>("mpv://property", (e) => cb(e.payload.name, e.payload.data)),
  onLifecycle: (cb: (event: string) => void): Promise<UnlistenFn> =>
    listen<MpvLifecycleEvent>("mpv://event", (e) => cb(e.payload.event)),
}
