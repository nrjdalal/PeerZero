# AGENTS.md

Guidance for AI coding agents working in this repository.

## Instructions

- ALWAYS: Use `@/` for imports, and follow the `design` skill for UI and styling conventions.
- ALWAYS: Keep documentation in sync with every change.
- NEVER: Include "Co-authored-by" in commit messages.
- NEVER: Use em-dashes (the long dash, U+2014) in code, comments, docs, or copy. Regular hyphens are fine; for a pause or aside, use a comma, colon, or period.

## Skills

Custom skills live in `.agents/skills` (symlinked to `.claude/skills`). Start with the `codebase-map` skill to orient, then load the task skill that fits (`api-endpoint`, `dev`, `design`, `desktop`, `release`, and more).
