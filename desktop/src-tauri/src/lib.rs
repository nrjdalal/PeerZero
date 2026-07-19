use std::sync::Mutex;

#[cfg(target_os = "macos")]
use tauri::TitleBarStyle;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder, WindowEvent};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

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

// Create the single "main" window once the backend has reported its (ephemeral) port. We inject
// the API URL as an initialization script so window.__PEERZERO_API_URL__ is set before any app JS
// runs, letting the statically-exported frontend read it synchronously (see web/next lib/config.ts).
// The port is dynamic now, so it cannot be baked at build time - this runtime handoff replaces it.
fn create_main_window(app: &AppHandle, port: u16) {
  if app.get_webview_window("main").is_some() {
    return;
  }
  let script = format!("window.__PEERZERO_API_URL__ = 'http://127.0.0.1:{port}';");
  let builder = WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
    .title("PeerZero")
    .inner_size(1080.0, 720.0)
    .min_inner_size(1080.0, 720.0)
    .resizable(true)
    .initialization_script(script.as_str());
  // Overlay the macOS traffic-light title bar, matching the prior declarative window config.
  #[cfg(target_os = "macos")]
  let builder = builder
    .title_bar_style(TitleBarStyle::Overlay)
    .hidden_title(true);
  if let Err(err) = builder.build() {
    log::error!("failed to create the main window: {err}");
  }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_shell::init())
    .plugin(tauri_plugin_updater::Builder::new().build())
    .plugin(tauri_plugin_opener::init())
    .plugin(tauri_plugin_process::init())
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }

      // Start the bundled backend (one Bun binary = Hono API + in-process WebTorrent engine). It
      // binds a free loopback port and prints `PZ_API_PORT=<port>`; we parse that line, then create
      // the webview pointed at the tauri:// UI with the matching API URL injected. Keeping the UI on
      // the tauri:// scheme (rather than loading it from the sidecar) preserves Tauri IPC for the
      // opener/updater plugins; the webview calls the API cross-origin, allowed via HONO_TRUSTED_ORIGINS.
      let sidecar = app.shell().sidecar("peerzero-backend")?;
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
