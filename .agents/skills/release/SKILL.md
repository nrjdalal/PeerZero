---
name: release
description: Cut a versioned PeerZero release - the GitHub release + macOS/Windows/Linux installers + the Tauri updater artifacts. Use when asked to "release", "cut a release", "ship a build", or "publish". NOT for landing a feature into canary (that is a normal squash PR).
---

# Release

A release ships from **main**. Everything on **canary** that is ahead of main goes out together, so land your features into canary first, then cut the release.

## The one rule

Merge the release PR (canary into main) with a **MERGE COMMIT, never a squash**. Squashing rewrites main's history away from canary, so every future release diff conflicts on `CHANGELOG.md` (add/add). The PR body says this too.

## Steps

1. **Canary is green and has the changes.** The release is exactly what is on canary ahead of main. Merge feature PRs into canary (normal squash) and confirm canary's CI passed.

2. **Find the release PR.** `.github/workflows/auto-canary-into-main.yml` runs on every push to canary and keeps a **draft** PR titled `ci(release): 🚀 merge canary into main` (canary into main). Find it:
   ```bash
   gh pr list --base main --head canary --state open --json number,title
   ```
   No PR means canary is not ahead of main - nothing to release.

3. **Mark it ready and merge-commit it:**
   ```bash
   gh pr ready <N>
   gh pr merge <N> --merge      # --merge = merge commit. NEVER --squash.
   ```

4. **`auto-release.yml` does the rest** (it triggers on that PR closing into main with head=canary):
   - `changelogen --bump` picks the version: a **patch bump** from the last tag (v0.0.19 -> v0.0.20) unless `package.json` `version` is hand-set *ahead* of the last tag, in which case it ships that exact version (a version not ahead fails the run loudly).
   - Writes `CHANGELOG.md`, commits `ci(changelog): ...` **back to canary**, tags `vX.Y.Z`, and creates the GitHub release with the changelog notes.
   - The `desktop` matrix (`desktop-release.yml`) then builds OS-native installers for the tag: macOS `.dmg` (aarch64), Windows `.exe` + `.msi`, Linux `.deb`, plus the Tauri updater artifacts (`PeerZero_aarch64.app.tar.gz` + `.sig`) and `latest.json`. About 15 minutes across the three platforms.

## Choosing the version

Default is an automatic patch bump. For a chosen version (minor/major, or a specific patch), hand-set `package.json` `version` on canary **ahead of the last tag** before merging the release PR; the workflow ships exactly that. Do **not** edit `desktop/src-tauri/tauri.conf.json` `version` (it is a placeholder like `0.0.2`) - CI syncs the app version to the release tag at build time.

## Watch / verify

```bash
gh run list --workflow auto-release --limit 1   # the release run (kicked off by the merge)
gh release list --limit 2                        # the new vX.Y.Z appears within ~1 min
gh run watch <run-id>                            # follow the installer matrix (~15 min)
```
The GitHub release + tag land first; the installer assets attach as the desktop matrix finishes.

## Gotchas

- **Never squash the release PR** (the one rule). It is a **draft** by default, so `gh pr ready` before merging.
- **Nothing to release** = canary not ahead of main, or only `ci(changelog)` commits since the last tag (the workflow skips those and just backfills a missing GitHub release for the current tag).
- The release captures **canary at merge time**; feature PRs not yet merged into canary are excluded.
- Installed desktop apps auto-update from the updater artifacts (`.app.tar.gz` + `.sig` + `latest.json`); let CI produce them, never hand-roll.
