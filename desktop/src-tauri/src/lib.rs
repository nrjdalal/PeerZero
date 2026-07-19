use std::sync::Mutex;

use tauri::{Manager, WindowEvent};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

// Holds the backend sidecar process so we can kill it when the window closes; without this
// the Hono API + WebTorrent engine would keep running after the app quits.
struct Backend(Mutex<Option<CommandChild>>);

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

      // Start the bundled backend (one Bun binary = Hono API + WebTorrent engine). The
      // static UI is served by Tauri, so the sidecar runs API-only and the webview calls
      // it at http://127.0.0.1:47821 (allowed via HONO_TRUSTED_ORIGINS in the backend).
      let sidecar = app.shell().sidecar("peerzero-backend")?;
      let (mut rx, child) = sidecar.spawn()?;
      app.manage(Backend(Mutex::new(Some(child))));

      tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
          match event {
            CommandEvent::Stdout(line) => {
              log::info!("[backend] {}", String::from_utf8_lossy(&line))
            }
            CommandEvent::Stderr(line) => {
              log::warn!("[backend] {}", String::from_utf8_lossy(&line))
            }
            _ => {}
          }
        }
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
