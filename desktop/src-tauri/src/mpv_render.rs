// macOS render-API embedding of mpv (IINA-style). mpv is configured vo=libmpv, so it never opens its
// own window; instead we render it through the libmpv OpenGL render API into a CAOpenGLLayer subclass
// that we insert BEHIND the transparent WKWebView. The web control overlay composites on top, giving
// the in-app Netflix-style player.
//
// The render API's threading contract: every mpv_render_* call implicitly uses the GL context and must
// run on the thread that owns it; the update callback may fire on any thread and must only SIGNAL. We
// satisfy this by driving all rendering from CAOpenGLLayer's own draw callback (asynchronous mode): CA
// makes our CGL context current and calls draw() on its render thread, where we create the render
// context (lazily, on first draw) and call render(). The update callback just marks the layer dirty.
//
// macOS OpenGL is deprecated but is the ONLY GPU-accelerated libmpv render target (render.h defines
// only OPENGL + a slow SW backend; render_gl.h: "macOS: CGL is required").
#![allow(deprecated)]

use std::cell::RefCell;
use std::ffi::{c_void, CString};
use std::sync::{Arc, OnceLock};

use libmpv2::{
    render::{OpenGLInitParams, RenderContext, RenderParam, RenderParamApiType},
    Mpv,
};
use objc2::rc::Retained;
use objc2::runtime::AnyObject;
use objc2::{define_class, msg_send, AnyThread, DefinedClass};
use objc2_core_video::CVTimeStamp;
use objc2_open_gl::{CGLContextObj, CGLPixelFormatObj};
use objc2_quartz_core::CAOpenGLLayer;

// GL enums we read in draw() to target the layer's real backing FBO (per IINA / render_gl.h).
const GL_DRAW_FRAMEBUFFER_BINDING: u32 = 0x8CA6;
const GL_VIEWPORT: u32 = 0x0BA2;

// CGL pixel-format attributes for a GL 3.2 CORE-profile context. The CAOpenGLLayer default is legacy
// GL 2.1, on which videotoolbox hwdec fails ("need >= OpenGL 3.0") and mpv disables modern scalers; a
// core-profile context restores hardware decode + full quality.
const KCGLPFA_ACCELERATED: u32 = 73;
const KCGLPFA_DOUBLE_BUFFER: u32 = 5;
const KCGLPFA_OPENGL_PROFILE: u32 = 99;
const KCGLPFA_ALLOW_OFFLINE: u32 = 96;
const KCGL_OGLP_VERSION_3_2_CORE: u32 = 0x3200;

extern "C" {
    fn CGLChoosePixelFormat(attribs: *const u32, pix: *mut CGLPixelFormatObj, npix: *mut i32) -> i32;
}

// dlopen handle to OpenGL.framework, used to resolve GL + the proc-address callback (libmpv does not
// link GL itself). Stored as usize so the OnceLock is Send/Sync.
fn gl_handle() -> *mut c_void {
    static H: OnceLock<usize> = OnceLock::new();
    *H.get_or_init(|| {
        let path =
            CString::new("/System/Library/Frameworks/OpenGL.framework/OpenGL").unwrap();
        unsafe { libc::dlopen(path.as_ptr(), libc::RTLD_LAZY | libc::RTLD_LOCAL) as usize }
    }) as *mut c_void
}

// The GL symbol resolver mpv calls to bind its GL functions (render_gl.h get_proc_address).
fn get_proc_address(_ctx: &(), name: &str) -> *mut c_void {
    let Ok(cname) = CString::new(name) else {
        return std::ptr::null_mut();
    };
    unsafe { libc::dlsym(gl_handle(), cname.as_ptr()) as *mut c_void }
}

unsafe fn gl_get_iv(pname: u32, out: &mut [i32; 4]) {
    type GlGetIntegerv = unsafe extern "C" fn(u32, *mut i32);
    let sym = get_proc_address(&(), "glGetIntegerv");
    if sym.is_null() {
        return;
    }
    let f: GlGetIntegerv = std::mem::transmute(sym);
    f(pname, out.as_mut_ptr());
}

struct LayerIvars {
    // Dropped before `mpv` (declaration order) so mpv_render_context_free runs before the core is
    // released - the render API's mandatory teardown order.
    render: RefCell<Option<RenderContext<'static>>>,
    mpv: Arc<Mpv>,
}

define_class!(
    // A CAOpenGLLayer that renders the mpv video. In asynchronous mode CA drives draw() on its GL
    // thread, which is where every mpv_render_* call safely runs.
    #[unsafe(super(CAOpenGLLayer))]
    #[name = "PzVideoLayer"]
    #[ivars = LayerIvars]
    struct PzVideoLayer;

    impl PzVideoLayer {
        #[unsafe(method(copyCGLPixelFormatForDisplayMask:))]
        unsafe fn copy_pixel_format(&self, mask: u32) -> CGLPixelFormatObj {
            let attribs: [u32; 6] = [
                KCGLPFA_OPENGL_PROFILE,
                KCGL_OGLP_VERSION_3_2_CORE,
                KCGLPFA_ACCELERATED,
                KCGLPFA_DOUBLE_BUFFER,
                KCGLPFA_ALLOW_OFFLINE,
                0,
            ];
            let mut pix: CGLPixelFormatObj = std::ptr::null_mut();
            let mut npix: i32 = 0;
            let err = CGLChoosePixelFormat(attribs.as_ptr(), &mut pix, &mut npix);
            if err == 0 && !pix.is_null() {
                pix
            } else {
                log::warn!("[mpv] CGL 3.2 core pixel format failed (err {err}); using default");
                msg_send![super(self), copyCGLPixelFormatForDisplayMask: mask]
            }
        }

        #[unsafe(method(canDrawInCGLContext:pixelFormat:forLayerTime:displayTime:))]
        unsafe fn can_draw(
            &self,
            _ctx: CGLContextObj,
            _pf: CGLPixelFormatObj,
            _t: f64,
            _ts: *const CVTimeStamp,
        ) -> bool {
            // Always allow: mpv redraws the last frame if none is new (keeps resize/first-frame correct).
            true
        }

        #[unsafe(method(drawInCGLContext:pixelFormat:forLayerTime:displayTime:))]
        unsafe fn draw(
            &self,
            ctx: CGLContextObj,
            pf: CGLPixelFormatObj,
            t: f64,
            ts: *const CVTimeStamp,
        ) {
            let ivars = self.ivars();

            // Lazily create the render context on the first draw, where the CGL context is current
            // (required: CGLGetCurrentContext() must be non-NULL for mpv_render_context_create).
            {
                let mut slot = ivars.render.borrow_mut();
                if slot.is_none() {
                    let create = ivars.mpv.create_render_context(vec![
                        RenderParam::ApiType(RenderParamApiType::OpenGl),
                        RenderParam::InitParams(OpenGLInitParams {
                            get_proc_address,
                            ctx: (),
                        }),
                    ]);
                    match create {
                        // SAFETY: the RenderContext borrows `mpv`, which lives in this same ivar
                        // (dropped after `render`), so extending to 'static is sound given drop order.
                        Ok(rc) => {
                            // asynchronous=true drives draw() at the display refresh rate (Core
                            // Animation pulls frames), so no update callback is needed.
                            let rc = std::mem::transmute::<
                                RenderContext<'_>,
                                RenderContext<'static>,
                            >(rc);
                            *slot = Some(rc);
                            log::info!("[mpv] render context created");
                        }
                        Err(e) => log::error!("[mpv] render context create failed: {e}"),
                    }
                }
            }

            // Target the layer's actual backing FBO + pixel size (NOT the default framebuffer 0).
            let mut fbo_arr = [0i32; 4];
            let mut vp = [0i32; 4];
            gl_get_iv(GL_DRAW_FRAMEBUFFER_BINDING, &mut fbo_arr);
            gl_get_iv(GL_VIEWPORT, &mut vp);
            let fbo = if fbo_arr[0] != 0 { fbo_arr[0] } else { 1 };
            let w = vp[2].max(1);
            let h = vp[3].max(1);

            if let Some(rc) = ivars.render.borrow().as_ref() {
                // flip=true: GL is Y-up, video is Y-down.
                if let Err(e) = rc.render::<()>(fbo, w, h, true) {
                    log::warn!("[mpv] render failed: {e}");
                }
                // Presentation feedback so mpv times the next frame correctly (render_gl.h).
                rc.report_swap();
            }

            // Let CAOpenGLLayer present (double-buffer flush).
            let _: () = msg_send![super(self),
                drawInCGLContext: ctx,
                pixelFormat: pf,
                forLayerTime: t,
                displayTime: ts];
        }
    }
);

impl PzVideoLayer {
    fn new(mpv: Arc<Mpv>) -> Retained<Self> {
        let this = Self::alloc().set_ivars(LayerIvars {
            render: RefCell::new(None),
            mpv,
        });
        let this: Retained<Self> = unsafe { msg_send![super(this), init] };
        // Core Animation drives draw() at the display refresh rate; mpv renders the current frame each
        // time (redrawing the last if none is new). This decouples our render cadence from mpv's frame
        // timing, which is what keeps playback smooth (frame-driven approaches starved the loop).
        this.setAsynchronous(true);
        this
    }
}

// Insert the mpv video layer as a SUBLAYER of the window's content view, BEHIND the webview's layer
// (index 0), so the transparent webview composites on top. Using a layer instead of an NSView subview
// is deliberate: a sublayer never participates in mouse hit-testing, so the webview keeps receiving
// every click for the HTML control overlay (an intervening video *view* swallowed them). `ns_window`
// is the *mut NSWindow from tauri's WebviewWindow::ns_window().
pub fn attach(mpv: Arc<Mpv>, ns_window: *mut c_void) -> Result<(), String> {
    if ns_window.is_null() {
        return Err("null ns_window".into());
    }
    unsafe {
        let window = ns_window as *mut AnyObject;
        let content_view: *mut AnyObject = msg_send![window, contentView];
        if content_view.is_null() {
            return Err("null contentView".into());
        }
        // Ensure the content view is layer-backed, then get its backing layer.
        let _: () = msg_send![content_view, setWantsLayer: true];
        let content_layer: *mut AnyObject = msg_send![content_view, layer];
        if content_layer.is_null() {
            return Err("null content layer".into());
        }

        let bounds: objc2_foundation::NSRect = msg_send![content_view, bounds];
        // Retina: render at the backing (physical) resolution so the video is sharp, not upscaled 1x.
        let scale: f64 = msg_send![window, backingScaleFactor];

        let layer = PzVideoLayer::new(mpv);
        let layer_ptr: *mut AnyObject = Retained::as_ptr(&layer) as *mut AnyObject;
        let _: () = msg_send![layer_ptr, setFrame: bounds];
        let _: () = msg_send![layer_ptr, setContentsScale: scale];
        // Fill + follow the window on resize (kCALayerWidthSizable | kCALayerHeightSizable = 2 | 16).
        let _: () = msg_send![layer_ptr, setAutoresizingMask: 18u32];
        // Behind the webview's layer.
        let _: () = msg_send![content_layer, insertSublayer: layer_ptr, atIndex: 0u32];

        // Keep the layer alive for the life of the app (it drives rendering via asynchronous CA draws).
        std::mem::forget(layer);
    }
    Ok(())
}
