# Nexus v0.4.5 — Release Hardening Draft

Status: Draft. Do not publish until Klein explicitly asks for the final release
gate, tag, and GitHub Release.

v0.4.5 does not ship a new runtime feature. It consolidates the stacked v0.4.1
through v0.4.4 drafts into a release-hardening review layer so the project can
prove the 0.4 line is coherent before any future release decision.

## What Changed

- Added a v0.4 draft-stack audit that checks release-state invariants from
  source files only, with a quick PR guard and a full release-review mode.
- Added a v0.4.5 draft hardening handoff with stacked PR traceability,
  rollback notes, privacy assertions, and verification commands.
- Kept the stable entry point on v0.4.0 while documenting v0.4.1 through
  v0.4.5 as draft-only review layers.
- Added tests around the draft-stack boundary so future documentation edits do
  not accidentally promote v0.4.5 to a release.
- Clarified that v0.5 is the next desktop pet behavior line, not a workaround
  for any v0.4 release-state issue.

## Not Included

- No formal v0.4.5 release yet.
- No package version bump.
- No tag or GitHub Release.
- No README stable-entry switch.
- No new sensing source, check-in behavior, Settings redesign, feedback
  analytics, adaptive copy, external notifications, message sending, tool
  execution, productivity score, pet movement, or desktop window control.
