#!/usr/bin/env python3
"""Make a built PeerZero.app self-contained for native mpv on macOS (no `brew install mpv` needed).

The app links libmpv (via libmpv2-sys) at its Homebrew install-name, e.g.
`/opt/homebrew/opt/mpv/lib/libmpv.2.dylib`. This script vendors libmpv + its entire dependency closure
(~48 dylibs: ffmpeg, libass, libplacebo, ...) into `PeerZero.app/Contents/Frameworks/`, rewrites every
install-name and inter-dependency reference to `@rpath/<leaf>`, repoints the app binary's libmpv load to
`@rpath/libmpv.2.dylib`, adds an `@executable_path/../Frameworks` rpath to the binary, and re-signs
everything ad-hoc (install_name_tool invalidates signatures; arm64 refuses broken ones). This is IINA's
`change_lib_dependencies.rb` recipe.

Usage: bundle-libmpv.py <PeerZero.app> [<system libmpv.2.dylib>]
"""

import os
import re
import shutil
import subprocess
import sys

SYS_LIBMPV_DEFAULT = "/opt/homebrew/lib/libmpv.2.dylib"
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


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    app = sys.argv[1]
    sys_libmpv = sys.argv[2] if len(sys.argv) > 2 else SYS_LIBMPV_DEFAULT

    macos = os.path.join(app, "Contents", "MacOS")
    app_bin = os.path.join(macos, "app")
    frameworks = os.path.join(app, "Contents", "Frameworks")
    os.makedirs(frameworks, exist_ok=True)

    # 1. Compute libmpv's transitive closure (Homebrew dylibs), keyed by realpath -> the leaf name we
    #    vendor it under (the leaf used in references, so install_name_tool -change lines match).
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

    # 2. Copy each into Frameworks/.
    for real, leaf in leaf_of_real.items():
        dst = os.path.join(frameworks, leaf)
        if not os.path.exists(dst):
            shutil.copy2(real, dst)
            os.chmod(dst, 0o755)

    def leaf_for_ref(ref):
        return leaf_of_real.get(os.path.realpath(ref))

    # 3. Rewrite ids + inter-deps to @rpath, add an @loader_path rpath (siblings), re-sign.
    for real, leaf in leaf_of_real.items():
        f = os.path.join(frameworks, leaf)
        run(["install_name_tool", "-id", f"@rpath/{leaf}", f])
        for ref in otool_deps(real):
            if not vendorable(ref):
                continue
            target = leaf_for_ref(ref)
            if target:
                run(["install_name_tool", "-change", ref, f"@rpath/{target}", f])
        subprocess.run(
            ["install_name_tool", "-add_rpath", "@loader_path", f],
            capture_output=True,
            text=True,
        )
        run(["codesign", "--force", "--sign", "-", "--timestamp=none", f])

    # 4. Repoint the app binary's libmpv reference to @rpath and add the Frameworks rpath.
    for ref in otool_deps(app_bin):
        target = leaf_for_ref(ref) if vendorable(ref) else None
        if target:
            run(["install_name_tool", "-change", ref, f"@rpath/{target}", app_bin])
    subprocess.run(
        ["install_name_tool", "-add_rpath", "@executable_path/../Frameworks", app_bin],
        capture_output=True,
        text=True,
    )

    # 5. Re-sign the whole app so the modified binary + nested dylibs are covered.
    run(["codesign", "--force", "--deep", "--sign", "-", "--timestamp=none", app])

    total = sum(os.path.getsize(os.path.join(frameworks, n)) for n in os.listdir(frameworks))
    print(f"vendored {len(leaf_of_real)} dylibs into {frameworks} ({total / 1e6:.1f} MB)")


if __name__ == "__main__":
    main()
