// Native mpv integration via the libmpv RENDER API (not --wid, which does not embed on macOS).
//
// This module owns a single mpv instance (vo=libmpv, so mpv never opens its own window) and:
//   - runs an event thread that mirrors a fixed set of properties to the webview as `mpv://property`
//     events and playback lifecycle as `mpv://event` (consumed by web/.../lib/mpv.ts),
//   - exposes Tauri commands (mpv_load / mpv_stop / mpv_command / mpv_set_property) the overlay drives,
//   - and (render.rs, macOS) renders mpv into a GL layer inserted behind the transparent webview.
//
// The web control overlay composites on top of that layer, giving the in-app Netflix-style player.

use std::sync::Arc;

use libmpv2::{
    events::{Event, PropertyData},
    Format, Mpv,
};
use serde_json::{json, Value as Json};
use tauri::{AppHandle, Emitter, Runtime};

// Scalar properties the event thread re-emits to the webview. track-list is a node (not a scalar
// PropertyData), so it is rebuilt from scalar sub-properties on file-loaded and when the count changes.
const OBSERVED_SCALAR: &[(&str, Format)] = &[
    ("pause", Format::Flag),
    ("time-pos", Format::Double),
    ("duration", Format::Double),
    ("eof-reached", Format::Flag),
    ("track-list/count", Format::Int64),
];

// Managed Tauri state: the mpv handle the commands drive. The render context lives on the render side
// (render.rs) since it is bound to the GL context; commands only need the core handle. `mpv` is an
// Option because init is non-fatal (see lib.rs): if the instance can't be created the app still
// launches with `None` here, and the commands below return a clean error the UI falls back on.
pub struct MpvHandle {
    pub mpv: Option<Arc<Mpv>>,
}

// The webview may only drive the playback controls the overlay actually uses. Every other mpv
// command/property (e.g. `run`/`subprocess` to exec programs, `stream-record`/`sub-file` for local
// file I/O, script loading) is rejected here, so a hypothetical XSS in the app origin can't reach
// mpv's full surface. mpv_load/mpv_stop use fixed commands (loadfile/stop) and bypass this list.
const ALLOWED_COMMANDS: &[&str] = &["seek"];
const ALLOWED_PROPERTIES: &[&str] = &["pause", "mute", "volume", "speed", "sid"];

// Resolve the mpv instance, turning an absent one (init failed / disabled) into an error the UI can
// fall back on instead of the command silently doing nothing.
fn require_mpv<'a>(state: &'a tauri::State<'_, MpvHandle>) -> Result<&'a Arc<Mpv>, String> {
    state.mpv.as_ref().ok_or_else(|| "mpv unavailable".to_string())
}

// Create the mpv instance (headless: vo=libmpv), start observing properties, and spawn the event thread.
pub fn init<R: Runtime>(app: &AppHandle<R>) -> Result<Arc<Mpv>, String> {
    let mpv = Mpv::with_initializer(|init| {
        // vo=libmpv means WE drive rendering through the render API; mpv never creates a window.
        init.set_property("vo", "libmpv")?;
        init.set_property("hwdec", "auto-safe")?;
        init.set_property("keep-open", "yes")?;
        init.set_property("idle", "yes")?;
        init.set_property("osc", false)?;
        init.set_property("input-default-bindings", false)?;
        init.set_property("input-cursor", false)?;
        // Do not let mpv_render_context_render() block until each frame's display time (render_gl.h):
        // on the CAOpenGLLayer draw thread that block starves the render loop and mpv warns "render
        // not being called or stuck". With 0, Core Animation drives cadence and playback stays smooth.
        init.set_property("video-timing-offset", "0")?;
        Ok(())
    })
    .map_err(|e| format!("mpv create: {e}"))?;

    let mpv = Arc::new(mpv);

    for (id, (name, fmt)) in OBSERVED_SCALAR.iter().enumerate() {
        if let Err(e) = mpv.observe_property(name, *fmt, id as u64) {
            log::warn!("[mpv] observe {name} failed: {e}");
        }
    }

    let mpv_ev = mpv.clone();
    let app_ev = app.clone();
    std::thread::spawn(move || loop {
        match mpv_ev.wait_event(1.0) {
            Some(Ok(event)) => match event {
                Event::PropertyChange { name, change, .. } => {
                    if name == "track-list/count" {
                        emit_track_list(&app_ev, &mpv_ev);
                    } else {
                        let _ = app_ev.emit(
                            "mpv://property",
                            json!({ "name": name, "data": prop_to_json(&change) }),
                        );
                    }
                }
                Event::FileLoaded => {
                    emit_track_list(&app_ev, &mpv_ev);
                    let _ = app_ev.emit("mpv://event", json!({ "event": "file-loaded" }));
                }
                Event::EndFile(_) => {
                    let _ = app_ev.emit("mpv://event", json!({ "event": "end-file" }));
                }
                Event::Shutdown => break,
                _ => {}
            },
            Some(Err(e)) => log::warn!("[mpv] event error: {e}"),
            None => {}
        }
    });

    Ok(mpv)
}

fn prop_to_json(p: &PropertyData) -> Json {
    match p {
        PropertyData::Flag(b) => json!(b),
        PropertyData::Int64(i) => json!(i),
        PropertyData::Double(d) => json!(d),
        PropertyData::Str(s) | PropertyData::OsdStr(s) => json!(s),
    }
}

// Rebuild the subtitle/audio/video track list from scalar sub-properties and emit it as `track-list`.
fn emit_track_list<R: Runtime>(app: &AppHandle<R>, mpv: &Mpv) {
    let count = mpv.get_property::<i64>("track-list/count").unwrap_or(0);
    let mut tracks: Vec<Json> = Vec::new();
    for i in 0..count {
        let s = |k: &str| mpv.get_property::<String>(&format!("track-list/{i}/{k}")).ok();
        let b = |k: &str| {
            mpv.get_property::<bool>(&format!("track-list/{i}/{k}"))
                .unwrap_or(false)
        };
        let id = mpv
            .get_property::<i64>(&format!("track-list/{i}/id"))
            .unwrap_or(0);
        tracks.push(json!({
            "id": id,
            "type": s("type"),
            "lang": s("lang"),
            "title": s("title"),
            "selected": b("selected"),
            "default": b("default"),
            "forced": b("forced"),
        }));
    }
    let _ = app.emit("mpv://property", json!({ "name": "track-list", "data": tracks }));
}

#[tauri::command]
pub fn mpv_load(state: tauri::State<'_, MpvHandle>, url: String) -> Result<(), String> {
    // Defense-in-depth: the overlay only ever loads the local stream server (loopback http), so reject
    // anything else - a hypothetical XSS in the app origin then can't point mpv at an arbitrary URL or
    // local file path via loadfile.
    if !url.starts_with("http://127.0.0.1:") && !url.starts_with("http://localhost:") {
        return Err("refused non-loopback url".to_string());
    }
    let res = require_mpv(&state)?
        .command("loadfile", &[&url])
        .map_err(|e| e.to_string());
    // Player is opening: let the GL layer draw (idle rendering is gated off otherwise). See mpv_render.
    if res.is_ok() {
        crate::mpv_render::set_render_active(true);
    }
    res
}

#[tauri::command]
pub fn mpv_stop(state: tauri::State<'_, MpvHandle>) -> Result<(), String> {
    // Player is closing: stop the idle render loop so it does not drain the GPU or starve the
    // webview's repaint. Flip first, so no frame draws after the page flips back to opaque.
    crate::mpv_render::set_render_active(false);
    require_mpv(&state)?.command("stop", &[]).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn mpv_command(state: tauri::State<'_, MpvHandle>, args: Vec<String>) -> Result<(), String> {
    if args.is_empty() {
        return Ok(());
    }
    if !ALLOWED_COMMANDS.contains(&args[0].as_str()) {
        return Err(format!("command not allowed: {}", args[0]));
    }
    let rest: Vec<&str> = args[1..].iter().map(String::as_str).collect();
    require_mpv(&state)?
        .command(&args[0], &rest)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn mpv_set_property(
    state: tauri::State<'_, MpvHandle>,
    name: String,
    value: Json,
) -> Result<(), String> {
    if !ALLOWED_PROPERTIES.contains(&name.as_str()) {
        return Err(format!("property not allowed: {name}"));
    }
    let mpv = require_mpv(&state)?;
    let res = match value {
        Json::Bool(b) => mpv.set_property(&name, b),
        Json::Number(n) => {
            if let Some(i) = n.as_i64() {
                mpv.set_property(&name, i)
            } else {
                mpv.set_property(&name, n.as_f64().unwrap_or(0.0))
            }
        }
        Json::String(s) => mpv.set_property(&name, s.as_str()),
        other => return Err(format!("unsupported value for {name}: {other}")),
    };
    res.map_err(|e| e.to_string())
}
