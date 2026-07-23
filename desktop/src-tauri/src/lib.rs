use std::sync::Mutex;

#[cfg(target_os = "macos")]
use tauri::TitleBarStyle;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder, WindowEvent};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

// Native mpv: a headless (vo=libmpv) instance + Tauri commands/events (mpv.rs), rendered into a GL
// layer behind the transparent webview via the libmpv render API (mpv_render.rs). macOS only - other
// platforms link no libmpv and have no in-app player (download-only); see file-tree.tsx.
#[cfg(target_os = "macos")]
mod mpv;
#[cfg(target_os = "macos")]
mod mpv_render;

// Holds the backend sidecar process so we can kill it when the window closes; without this
// the Hono API + in-process WebTorrent engine would keep running after the app quits.
struct Backend(Mutex<Option<CommandChild>>);

// Parse the `PZ_API_PORT=<port>` handshake line the sidecar prints on boot (desktop/backend/main.ts).
fn parse_api_port(text: &str) -> Option<u16> {
  text
    .lines()
    .find_map(|line| line.trim().strip_prefix("PZ_API_PORT="))
    .and_then(|value| value.trim().parse().ok())
}

// Create the single "main" window once the backend has reported its (ephemeral) port. The window
// loads the UI over http://127.0.0.1:<port> - the SAME loopback origin the sidecar serves the API on
// (PZ_FRONTEND_DIR makes it serve the static export too). We do this instead of the tauri:// custom
// scheme so the UI shares that loopback origin: same origin means no CORS, and the sidecar serves the
// static export from it. (It also once let the WebView spawn Web Workers for the libmedia decode
// player - WKWebView blocks Workers on custom schemes - but that player has been removed.) We still
// inject window.__PEERZERO_API_URL__ so the frontend's config resolves without a race.
fn create_main_window(app: &AppHandle, port: u16) {
  if app.get_webview_window("main").is_some() {
    return;
  }
  let script = format!("window.__PEERZERO_API_URL__ = 'http://127.0.0.1:{port}';");
  let url: tauri::Url = format!("http://127.0.0.1:{port}")
    .parse()
    .expect("valid loopback url");
  let builder = WebviewWindowBuilder::new(app, "main", WebviewUrl::External(url))
    .title("PeerZero")
    .inner_size(1080.0, 720.0)
    .min_inner_size(1080.0, 720.0)
    .resizable(true)
    .initialization_script(script.as_str());
  // macOS only: transparent so the native mpv surface behind the webview shows through the video area
  // (the app paints an opaque background otherwise, so it is invisible until the player opts in), plus
  // the overlaid traffic-light title bar. Other platforms have no video surface behind the window, so
  // a transparent window there would only risk shadow/compositor glitches for no benefit.
  #[cfg(target_os = "macos")]
  let builder = builder
    .transparent(true)
    .title_bar_style(TitleBarStyle::Overlay)
    .hidden_title(true);
  match builder.build() {
    Ok(_window) => {
      // Insert the native mpv GL layer behind this window's webview (macOS). Runs on the main thread
      // (create_main_window is dispatched there), as AppKit requires.
      #[cfg(target_os = "macos")]
      if let Some(handle) = app.try_state::<mpv::MpvHandle>() {
        if let Some(mpv) = handle.mpv.clone() {
          match _window.ns_window() {
            Ok(ns_window) => {
              if let Err(err) = mpv_render::attach(mpv, ns_window) {
                log::error!("[mpv] attach render layer failed: {err}");
              }
            }
            Err(err) => log::error!("[mpv] ns_window unavailable: {err}"),
          }
        }
      }
    }
    Err(err) => log::error!("failed to create the main window: {err}"),
  }
}

// Relaunch after an update. Called from Rust (install_update), NOT the webview: replacing the .app
// bundle kills WKWebView's WebContent process, so no JS runs after the swap - the relaunch has to be
// driven from the surviving main process. On macOS relaunch()/app.exit() also stall once the running
// binary has been swapped out, so we launch a fresh instance with `open -n` (which resolves the new
// bundle cleanly) and hard-exit this one.
fn restart_now(app: &AppHandle) -> ! {
  // Kill the backend sidecar so it does not orphan (the hard exit skips the Destroyed handler).
  if let Some(state) = app.try_state::<Backend>() {
    if let Some(child) = state.0.lock().unwrap().take() {
      let _ = child.kill();
    }
  }
  #[cfg(target_os = "macos")]
  {
    // current_exe is <App>.app/Contents/MacOS/app; the bundle is 3 ancestors up.
    if let Ok(exe) = std::env::current_exe() {
      if let Some(bundle) = exe.ancestors().nth(3) {
        let _ = std::process::Command::new("/usr/bin/open").arg("-n").arg(bundle).spawn();
      }
    }
    std::thread::sleep(std::time::Duration::from_millis(400)); // let `open` hand off to LaunchServices
    std::process::exit(0);
  }
  #[cfg(not(target_os = "macos"))]
  app.restart();
}

// Download + install the pending update AND relaunch, all in the main process. The webview only kicks
// this off (the check for the badge happens in JS); doing the install here means the relaunch survives
// the WebContent process dying when the bundle is replaced.
#[tauri::command]
async fn install_update(app: AppHandle) -> Result<(), String> {
  use tauri_plugin_updater::UpdaterExt;
  let pending = app
    .updater()
    .map_err(|e| e.to_string())?
    .check()
    .await
    .map_err(|e| e.to_string())?;
  if let Some(update) = pending {
    update
      .download_and_install(|_, _| {}, || {})
      .await
      .map_err(|e| e.to_string())?;
    restart_now(&app); // never returns
  }
  Ok(())
}

// Update to a SPECIFIC release, chosen from the Settings release table - any version, forward OR
// back. Unlike install_update (which reads the config `latest.json` and only installs a NEWER
// release), this points the updater at that tag's own per-release manifest and bypasses the
// "remote must be newer" gate via a version_comparator that always returns true, so the user can
// move to the exact version they picked. The artifact is still verified against the bundled pubkey
// (updater_builder() is pre-seeded from config), and the download + install + relaunch run in the
// main process for the same reason as install_update (the .app swap kills the webview).
#[tauri::command]
async fn install_release(app: AppHandle, tag: String) -> Result<(), String> {
  use tauri_plugin_updater::UpdaterExt;
  let manifest = format!("https://github.com/nrjdalal/PeerZero/releases/download/{tag}/latest.json");
  let url = tauri::Url::parse(&manifest).map_err(|e| e.to_string())?;
  let pending = app
    .updater_builder()
    .endpoints(vec![url])
    .map_err(|e| e.to_string())?
    .version_comparator(|_current, _remote| true)
    .build()
    .map_err(|e| e.to_string())?
    .check()
    .await
    .map_err(|e| e.to_string())?;
  if let Some(update) = pending {
    update
      .download_and_install(|_, _| {}, || {})
      .await
      .map_err(|e| e.to_string())?;
    restart_now(&app); // never returns
  }
  Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  let builder = tauri::Builder::default()
    .plugin(tauri_plugin_shell::init())
    .plugin(tauri_plugin_updater::Builder::new().build())
    .plugin(tauri_plugin_opener::init())
    .plugin(tauri_plugin_process::init());

  // install_update is used on every platform; the native mpv commands exist only on macOS (the render
  // layer is macOS-only), so other platforms register no mpv handler and link no libmpv.
  #[cfg(target_os = "macos")]
  let builder = builder.invoke_handler(tauri::generate_handler![
    install_update,
    install_release,
    mpv::mpv_load,
    mpv::mpv_stop,
    mpv::mpv_command,
    mpv::mpv_set_property,
  ]);
  #[cfg(not(target_os = "macos"))]
  let builder = builder.invoke_handler(tauri::generate_handler![install_update, install_release]);

  builder
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }

      // Create the headless mpv instance (vo=libmpv) + its event thread (macOS only). Non-fatal: if
      // mpv can't be created (bad driver, broken libmpv), log and carry on with `None` so the app
      // still launches and video falls back to the external VLC handoff (the commands then error
      // out). The GL render layer is attached once the window exists (create_main_window).
      #[cfg(target_os = "macos")]
      {
        let mpv = match mpv::init(app.handle()) {
          Ok(mpv) => Some(mpv),
          Err(err) => {
            log::error!("[mpv] init failed; video falls back to the external player: {err}");
            None
          }
        };
        app.manage(mpv::MpvHandle { mpv });
      }

      // Start the bundled backend (one Bun binary = Hono API + in-process WebTorrent engine). It
      // binds a free loopback port and prints `PZ_API_PORT=<port>`; we parse that line, then load the
      // webview from that http origin. We hand the sidecar PZ_FRONTEND_DIR (the static export, shipped
      // as a bundle resource) so it serves the UI too - one loopback origin for UI + API, which lets
      // the WebView spawn Web Workers (tauri:// can't) so decode runs off the main thread.
      let frontend_dir = app.path().resource_dir().map(|dir| dir.join("frontend")).ok();
      let mut sidecar = app.shell().sidecar("peerzero-backend")?;
      if let Some(dir) = &frontend_dir {
        sidecar = sidecar.env("PZ_FRONTEND_DIR", dir.to_string_lossy().to_string());
      }
      let (mut rx, child) = sidecar.spawn()?;
      app.manage(Backend(Mutex::new(Some(child))));

      let handle = app.handle().clone();
      tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
          match event {
            CommandEvent::Stdout(line) => {
              let text = String::from_utf8_lossy(&line);
              if let Some(port) = parse_api_port(&text) {
                let handle_for_window = handle.clone();
                let _ = handle
                  .run_on_main_thread(move || create_main_window(&handle_for_window, port));
              }
              log::info!("[backend] {}", text);
            }
            CommandEvent::Stderr(line) => {
              log::warn!("[backend] {}", String::from_utf8_lossy(&line))
            }
            _ => {}
          }
        }
      });

      // Safety net: if the sidecar never reports a port (e.g. it crashes at boot), still open a
      // window after a grace period so the app is not invisibly stuck. create_main_window is a
      // no-op once the window exists, and injecting the default port matches the baked fallback.
      let fallback_handle = app.handle().clone();
      std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_secs(20));
        let handle_for_window = fallback_handle.clone();
        let _ = fallback_handle.run_on_main_thread(move || {
          if handle_for_window.get_webview_window("main").is_none() {
            log::warn!("backend never reported PZ_API_PORT; opening with the baked API url");
            create_main_window(&handle_for_window, 9336);
          }
        });
      });

      Ok(())
    })
    .on_window_event(|window, event| {
      if let WindowEvent::Destroyed = event {
        if let Some(state) = window.try_state::<Backend>() {
          if let Some(child) = state.0.lock().unwrap().take() {
            let _ = child.kill();
          }
        }
      }
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
