---
name: icebox
description: Icebox a raised-but-undecided concern instead of forcing a plan-or-dismiss call: record it with no verdict so the context survives. Use when a review, PR, audit, or eval surfaces something real-maybe that should not be scheduled or closed yet, or when the user says to icebox or park an item.
---

# Icebox

A concern got raised that you cannot honestly schedule or resolve right now. Do not force it into a plan or a dismissal. Put it on ice: record it with no verdict, so the context survives until someone can decide. The Icebox is one flat file, `.github/plans/ICEBOX.md`: deferred work and known issues, newest first. The larger media roadmap lives beside it in `.github/plans/media-playback.md`.

## When it belongs on ice

All three hold:

- **raised**: a review note, a PR follow-up, an audit or eval finding,
- **not schedulable**: no agreed next action, so it is not yet a real plan or PR,
- **not resolvable**: you cannot say fix-it or not-a-problem with confidence.

A clear next action becomes a plan or a PR; a clear verdict gets done or closed. The Icebox is only for the genuinely undecided.

## Park it

Add the item to `.github/plans/ICEBOX.md`, newest first. Give it its own `##` heading naming the concern near the top of the file, or slot a `###` under a fitting existing section (for example `## Known issues`). State the concern, its context, and the open question; give no verdict and no plan. Done when a reader learns the concern and what is unresolved, and finds no recommendation.

## When an item thaws

An item leaves the Icebox only by being decided. When that happens, remove its section from `.github/plans/ICEBOX.md` and, if it was scheduled rather than dropped, carry it into a real plan or PR. Note in the commit what happened: shipped, dismissed, or promoted to real work.
