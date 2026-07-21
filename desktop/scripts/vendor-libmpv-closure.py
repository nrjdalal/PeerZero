#!/usr/bin/env python3
"""Produce a self-contained, @rpath-relocated libmpv dylib closure into an output dir.

This is the "prebuild libmpv once" step. Given a system libmpv (e.g. Homebrew's
/opt/homebrew/opt/mpv/lib/libmpv.2.dylib), it vendors libmpv + its entire dependency closure
(~48 dylibs: ffmpeg, libass, libplacebo, ...) into <out>/lib, rewrites every install-name and
inter-dependency to `@rpath/<leaf>`, adds an unversioned `libmpv.dylib` symlink (so `-lmpv` links
against it), and re-signs each ad-hoc. The result is a pinnable artifact the app build LINKS against
and copies into Contents/Frameworks - with NO live Homebrew needed to consume it (Homebrew is only
needed here, once, to produce the closure). This is IINA's change_lib_dependencies recipe, emitting a
standalone closure instead of writing into an .app.

Usage: vendor-libmpv-closure.py <system libmpv.2.dylib> <out dir>
Writes: <out>/lib/*.dylib (closure, @rpath), <out>/lib/libmpv.dylib (symlink), <out>/VERSION
"""

import os
import re
import shutil
import subprocess
import sys

VENDOR_PREFIXES = ("/opt/homebrew", "/usr/local")


def run(cmd):
    subprocess.run(cmd, check=True, capture_output=True, text=True)


def otool_deps(path):
    out = subprocess.check_output(["otool", "-L", path], text=True)
    deps = []
    for line in out.splitlines()[1:]:
        m = re.match(r"\s+(\S+)\s+\(", line)
        if m:
            deps.append(m.group(1))
    return deps


def vendorable(ref):
    return ref.startswith(VENDOR_PREFIXES)


def mpv_version(sys_libmpv):
    # Prefer the mpv PLAYER version from the Homebrew Cellar path (.../Cellar/mpv/0.41.0_6/...), which
    # is more precise for pinning than the libmpv client-API version. Fall back to pkg-config (which
    # returns the libmpv API version, e.g. 2.5.0) when there is no Cellar path.
    m = re.search(r"/mpv/([^/]+)/", os.path.realpath(sys_libmpv))
    if m:
        return m.group(1)
    for prefix in VENDOR_PREFIXES:
        pc = os.path.join(prefix, "lib", "pkgconfig")
        try:
            env = dict(os.environ, PKG_CONFIG_PATH=f"{pc}:{os.environ.get('PKG_CONFIG_PATH', '')}")
            v = subprocess.check_output(["pkg-config", "--modversion", "mpv"], text=True, env=env)
            if v.strip():
                return v.strip()
        except (subprocess.CalledProcessError, FileNotFoundError):
            pass
    return "unknown"


def main():
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    sys_libmpv, out = sys.argv[1], sys.argv[2]
    libdir = os.path.join(out, "lib")
    os.makedirs(libdir, exist_ok=True)

    # 1. Compute libmpv's transitive closure (Homebrew dylibs), realpath -> leaf name.
    leaf_of_real = {}
    stack = [sys_libmpv]
    while stack:
        cur = stack.pop()
        real = os.path.realpath(cur)
        if real in leaf_of_real:
            continue
        leaf_of_real[real] = os.path.basename(cur)
        for ref in otool_deps(real):
            if vendorable(ref):
                stack.append(ref)

    # 2. Copy each into <out>/lib.
    for real, leaf in leaf_of_real.items():
        dst = os.path.join(libdir, leaf)
        if not os.path.exists(dst):
            shutil.copy2(real, dst)
            os.chmod(dst, 0o755)

    def leaf_for_ref(ref):
        return leaf_of_real.get(os.path.realpath(ref))

    # 3. Rewrite ids + inter-deps to @rpath, add an @loader_path rpath (siblings), re-sign.
    for real, leaf in leaf_of_real.items():
        f = os.path.join(libdir, leaf)
        run(["install_name_tool", "-id", f"@rpath/{leaf}", f])
        for ref in otool_deps(real):
            target = leaf_for_ref(ref) if vendorable(ref) else None
            if target:
                run(["install_name_tool", "-change", ref, f"@rpath/{target}", f])
        subprocess.run(["install_name_tool", "-add_rpath", "@loader_path", f], capture_output=True, text=True)
        run(["codesign", "--force", "--sign", "-", "--timestamp=none", f])

    # 4. Unversioned symlink so `-lmpv` links against the closure's libmpv (whose id is now
    #    @rpath/libmpv.2.dylib, so the app binary records @rpath at link time - no post-build -change).
    libmpv_leaf = os.path.basename(sys_libmpv)  # e.g. libmpv.2.dylib
    link = os.path.join(libdir, "libmpv.dylib")
    if os.path.lexists(link):
        os.remove(link)
    os.symlink(libmpv_leaf, link)

    version = mpv_version(sys_libmpv)
    with open(os.path.join(out, "VERSION"), "w") as f:
        f.write(version + "\n")

    total = sum(os.path.getsize(os.path.join(libdir, n)) for n in os.listdir(libdir) if not os.path.islink(os.path.join(libdir, n)))
    print(f"vendored {len(leaf_of_real)} dylibs (mpv {version}) into {libdir} ({total / 1e6:.1f} MB)")


if __name__ == "__main__":
    main()
