// Picture-in-picture support for the native player (web/next/src/lib/use-player-window.ts). The mini
// player is the main window itself, floated and shrunk through Tauri's window API; the one thing that
// API cannot switch off is native fullscreen outside the app's own controls: the View > Enter Full
// Screen menu item and its Ctrl+Cmd+F / Globe+F shortcuts. Fullscreening the floating mini player would
// leave it flagged as PiP inside a fullscreen Space, so while PiP is up the window opts out of
// fullscreen (NSWindowCollectionBehaviorFullScreenNone): AppKit then ignores toggleFullScreen:, the
// action that menu item and its shortcuts send.
use std::sync::atomic::{AtomicUsize, Ordering};

use objc2::msg_send;
use objc2::runtime::AnyObject;

// NSWindowCollectionBehavior fullscreen bits.
const FULL_SCREEN_PRIMARY: usize = 1 << 7;
const FULL_SCREEN_AUXILIARY: usize = 1 << 8;
const FULL_SCREEN_NONE: usize = 1 << 9;
const FULL_SCREEN_BITS: usize = FULL_SCREEN_PRIMARY | FULL_SCREEN_AUXILIARY | FULL_SCREEN_NONE;
// The window's own fullscreen bits from before PiP forbade fullscreen, put back when it is allowed
// again. usize::MAX = nothing saved (fullscreen is not currently forbidden by us).
static SAVED_BITS: AtomicUsize = AtomicUsize::new(usize::MAX);

#[tauri::command]
pub fn set_fullscreen_allowed(window: tauri::WebviewWindow, allowed: bool) -> Result<(), String> {
  // *mut NSWindow is not Send; carry it to the main thread (AppKit's) as an address.
  let ns_window = window.ns_window().map_err(|e| e.to_string())? as usize;
  window
    .run_on_main_thread(move || unsafe {
      let ns_window = ns_window as *mut AnyObject;
      let behavior: usize = msg_send![ns_window, collectionBehavior];
      let next = if allowed {
        match SAVED_BITS.swap(usize::MAX, Ordering::SeqCst) {
          usize::MAX => return,
          saved => (behavior & !FULL_SCREEN_BITS) | saved,
        }
      } else {
        // Save only on the first forbid, so a repeated call cannot overwrite the original bits.
        let _ = SAVED_BITS.compare_exchange(
          usize::MAX,
          behavior & FULL_SCREEN_BITS,
          Ordering::SeqCst,
          Ordering::SeqCst,
        );
        (behavior & !FULL_SCREEN_BITS) | FULL_SCREEN_NONE
      };
      let _: () = msg_send![ns_window, setCollectionBehavior: next];
    })
    .map_err(|e| e.to_string())
}
