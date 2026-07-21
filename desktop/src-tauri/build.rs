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
    ])),
  )
  .expect("failed to run tauri-build");

  // Link libmpv without a manual PKG_CONFIG_PATH. libmpv2-sys emits only `cargo:rustc-link-lib=mpv`
  // (no search path), and Homebrew keeps mpv.pc under <prefix>/lib/pkgconfig, which is off
  // pkg-config's default search path. Detect the active Homebrew prefix (`brew --prefix`, else the
  // standard arm64 / Intel locations) and add its pkgconfig dir, so a plain `cargo build` finds
  // libmpv with no env setup - `desktop/scripts/ensure-libmpv.sh` installs mpv first if it's missing.
  // We emit only the link-search paths (libmpv2-sys already emits `-lmpv`) to avoid a duplicate. At
  // runtime the binary keeps libmpv's Homebrew install-name until desktop/scripts/bundle-libmpv.py
  // vendors the dylib closure into the .app, so end users need no Homebrew.
  #[cfg(target_os = "macos")]
  {
    use std::path::Path;
    use std::process::Command;

    let brew_prefix = Command::new("brew")
      .arg("--prefix")
      .output()
      .ok()
      .filter(|out| out.status.success())
      .map(|out| String::from_utf8_lossy(&out.stdout).trim().to_string())
      .filter(|prefix| !prefix.is_empty())
      .or_else(|| {
        ["/opt/homebrew", "/usr/local"]
          .into_iter()
          .find(|dir| Path::new(dir).exists())
          .map(String::from)
      });
    if let Some(prefix) = brew_prefix {
      let pkgconfig = format!("{prefix}/lib/pkgconfig");
      let path = match std::env::var("PKG_CONFIG_PATH") {
        Ok(existing) if !existing.is_empty() => format!("{pkgconfig}:{existing}"),
        _ => pkgconfig,
      };
      // Safe: build scripts are single-threaded (edition 2021).
      std::env::set_var("PKG_CONFIG_PATH", path);
    }
    match pkg_config::Config::new().cargo_metadata(false).probe("mpv") {
      Ok(lib) => {
        for path in lib.link_paths {
          println!("cargo:rustc-link-search=native={}", path.display());
        }
      }
      Err(err) => {
        println!(
          "cargo:warning=libmpv not found via pkg-config ({err}); run desktop/scripts/ensure-libmpv.sh (or `brew install mpv`)"
        );
      }
    }
  }
}
