---
name: doc-sync
description: Sync docs and skills so they never drift from the code. Use before opening or updating a PR, or when a change touches a command, path, convention, or the skill set a doc or skill documents.
---

# Doc Sync

A change ships with its docs or it ships drift. This is the procedure to catch drift across every hand-authored surface before the PR goes up. `AGENTS.md` makes the sync mandatory; this makes it checkable.

## Surfaces

The repo has three hand-authored doc surfaces. Keep each in step with the code:

| Surface | Documents | Drifts when |
| --- | --- | --- |
| `README.md` | top-level story: stack, structure, quick start, scripts, desktop/Docker run | the stack, setup, scripts, or pitch changes |
| `.agents/skills/<name>/SKILL.md` | one task procedure each (canonical; `.claude` and `.github` symlink in) | a command, path, convention, or tooling a skill encodes changes, or a skill is added or removed |
| `AGENTS.md` (`CLAUDE.md` symlinks in) | the always-on rules plus the pointer into the skill set | a rule changes, or the skill set changes |

There is no generated doc surface: no `content/docs` MDX, no `docs.config.ts`, no `/llms.txt` routes, and no `docs.ts` drift gate. Do not reintroduce references to them.

## Procedure

### 1. Scope the change

List what the diff touched: paths, commands, script names, env vars, conventions, tooling, and whether the skill set changed. Start from `git diff --stat` and the code diff.

### 2. Hunt drift

Grep every surface for each changed path, command, or symbol. Every hit is a candidate:

```bash
rg -n "<changed-path-or-command>" README.md AGENTS.md .agents/skills
```

### 3. Sync, coupled surfaces included

Update each hit in the same change. The one coupling that is easy to miss:

- **Add or remove a skill** touches two places: the skill's own `.agents/skills/<name>/SKILL.md`, and the pointer into the skill set in `AGENTS.md` (its `## Skills` section names the entry skills, so keep that list honest when the set changes).

### 4. Verify

Done when a fresh `rg` for every removed or renamed path, command, and skill name finds zero stale mentions across the three surfaces, and every new one is documented. Before the PR, run `cd web/next && bun run build` once: it catches type errors, though it does not check docs.

## Notes

- Skills are symlinked: `.agents/skills` is canonical, edit once and the `.claude`/`.github` copies follow.
