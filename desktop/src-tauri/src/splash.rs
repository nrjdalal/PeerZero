// Native launch splash, drawn ON the main window itself (macOS). The main window is a transparent
// WKWebView loading the heavy (~2.3MB) app bundle, and a transparent WKWebView paints NOTHING until that
// whole page finishes - so a splash rendered by the web app can't show during the load, and a separate
// splash *window* means a jarring two-window swap (splash window appears, then the real window replaces
// it). Instead we overlay the splash as an NSView on top of the webview in the SAME window: AppKit draws
// it immediately (independent of the webview) and subview order guarantees it sits above the web content
// (more reliable than a sibling layer against WKWebView's out-of-process compositing). We remove it once
// the page finishes loading; by then the web app's own opaque SplashScreen (in the initial HTML) is
// painted, so the handoff has no gap. One window, no swap.
#![allow(deprecated)]

use std::ffi::c_void;
use std::sync::Mutex;

use objc2::runtime::AnyObject;
use objc2::{class, msg_send};
use objc2_foundation::{NSPoint, NSRect, NSSize};

// The installed splash cover view, kept so page-load can remove it. Stored as a raw pointer (usize) so
// the static is Send + Sync. We own the alloc/init +1 reference; hide() removes it from the view tree
// and releases that reference.
static SPLASH_VIEW: Mutex<Option<usize>> = Mutex::new(None);

// NSView autoresizing (NSViewWidthSizable | NSViewHeightSizable): fill + follow the window on resize.
const NS_VIEW_WIDTH_HEIGHT_SIZABLE: usize = 2 | 16;
// CALayer autoresizing (MinX | MaxX | MinY | MaxY margins all flexible): keep a fixed-size sublayer
// centered as its superlayer resizes.
const CA_MARGINS_FLEXIBLE: u32 = 1 | 4 | 8 | 32;

// Overlay an opaque-black cover view with the centered app-icon mark on top of the window's webview.
// Must run on the main thread (AppKit requirement); create_main_window dispatches there. Non-fatal
// throughout: a null anywhere just yields a plainer cover (or nothing), never a crash. `ns_window` is
// the *mut NSWindow from tauri's WebviewWindow::ns_window().
pub fn show(ns_window: *mut c_void) {
  if ns_window.is_null() {
    return;
  }
  unsafe {
    let window = ns_window as *mut AnyObject;
    let content_view: *mut AnyObject = msg_send![window, contentView];
    if content_view.is_null() {
      return;
    }
    let bounds: NSRect = msg_send![content_view, bounds];
    let scale: f64 = msg_send![window, backingScaleFactor];

    // Opaque black cover view. Added last (below), so it renders above the webview subview.
    let cover: *mut AnyObject = msg_send![class!(NSView), alloc];
    let cover: *mut AnyObject = msg_send![cover, initWithFrame: bounds];
    if cover.is_null() {
      return;
    }
    let _: () = msg_send![cover, setWantsLayer: true];
    let _: () = msg_send![cover, setAutoresizingMask: NS_VIEW_WIDTH_HEIGHT_SIZABLE];
    let cover_layer: *mut AnyObject = msg_send![cover, layer];
    if !cover_layer.is_null() {
      let black: *mut AnyObject = msg_send![class!(NSColor), blackColor];
      let black_cg: *mut c_void = msg_send![black, CGColor];
      if !black_cg.is_null() {
        let _: () = msg_send![cover_layer, setBackgroundColor: black_cg];
      }

      // Centered app-icon mark (the PeerZero "0"). Non-fatal if the icon or its CGImage is null: the
      // cover still shows a clean black screen.
      let size = 120.0_f64;
      let logo_frame = NSRect::new(
        NSPoint::new((bounds.size.width - size) / 2.0, (bounds.size.height - size) / 2.0),
        NSSize::new(size, size),
      );
      let logo: *mut AnyObject = msg_send![class!(CALayer), layer];
      let _: () = msg_send![logo, setFrame: logo_frame];
      let _: () = msg_send![logo, setContentsScale: scale];
      let _: () = msg_send![logo, setAutoresizingMask: CA_MARGINS_FLEXIBLE];
      let ns_app: *mut AnyObject = msg_send![class!(NSApplication), sharedApplication];
      if !ns_app.is_null() {
        let icon: *mut AnyObject = msg_send![ns_app, applicationIconImage];
        if !icon.is_null() {
          let rect_ptr: *const NSRect = std::ptr::null();
          let ctx: *mut AnyObject = std::ptr::null_mut();
          let hints: *mut AnyObject = std::ptr::null_mut();
          let cg: *mut c_void =
            msg_send![icon, CGImageForProposedRect: rect_ptr, context: ctx, hints: hints];
          if !cg.is_null() {
            let _: () = msg_send![logo, setContents: cg as *mut AnyObject];
          }
        }
      }
      let _: () = msg_send![cover_layer, addSublayer: logo];
    }

    // Add on top of the webview. addSubview retains the view (superview reference); we still hold the
    // alloc/init +1, which we store and release in hide().
    let _: () = msg_send![content_view, addSubview: cover];
    *SPLASH_VIEW.lock().unwrap() = Some(cover as usize);
  }
}

// Remove the splash cover, revealing the loaded app beneath. Must run on the main thread. Idempotent: a
// no-op if never shown or already hidden.
pub fn hide() {
  let taken = SPLASH_VIEW.lock().unwrap().take();
  if let Some(ptr) = taken {
    unsafe {
      let cover = ptr as *mut AnyObject;
      let _: () = msg_send![cover, removeFromSuperview];
      let _: () = msg_send![cover, release];
    }
  }
}
