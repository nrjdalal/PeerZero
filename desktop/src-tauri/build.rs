fn main() {
  // The UI is served from a remote origin (http://127.0.0.1:<port>), so Tauri's ACL blocks our app
  // commands unless they are declared here + granted in a capability (capabilities/default.json).
  // Autogenerates `allow-mpv_load` etc. permissions referenced there.
  tauri_build::try_build(
    tauri_build::Attributes::new().app_manifest(tauri_build::AppManifest::new().commands(&[
      "mpv_load",
      "mpv_stop",
      "mpv_command",
      "mpv_set_property",
      "mpv_get_property",
    ])),
  )
  .expect("failed to run tauri-build");

  // libmpv2-sys's build script emits only `cargo:rustc-link-lib=mpv` with NO search path, so provide
  // it here via pkg-config (Homebrew's mpv.pc on macOS; system pkg-config elsewhere). We emit only the
  // link-search paths - libmpv2-sys already emits the `-lmpv` itself - to avoid a duplicate. Set
  // PKG_CONFIG_PATH (e.g. /opt/homebrew/lib/pkgconfig) at build time if mpv is not on the default path.
  // At runtime the binary resolves libmpv at its linked install-name until the self-contained bundling
  // step (desktop/scripts/bundle-libmpv.py) vendors it into the .app.
  #[cfg(target_os = "macos")]
  match pkg_config::Config::new().cargo_metadata(false).probe("mpv") {
    Ok(lib) => {
      for path in lib.link_paths {
        println!("cargo:rustc-link-search=native={}", path.display());
      }
    }
    Err(err) => {
      println!("cargo:warning=libmpv not found via pkg-config ({err}); set PKG_CONFIG_PATH to your mpv.pc dir");
    }
  }
}
