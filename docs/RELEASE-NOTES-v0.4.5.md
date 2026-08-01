# Nexus v0.4.5 — Release Hardening Draft

Status: Draft. Do not publish until Klein explicitly asks for the final release
gate, tag, and GitHub Release.

v0.4.5 does not ship a new runtime feature. It consolidates the current public
stable v0.4.4 release into a
release-hardening review layer so the project can prove the 0.4 line is
coherent before any future release decision.

## What Changed

- Added a v0.4 draft-stack audit that checks release-state invariants from
  source files only, with a quick PR guard and a full release-review mode.
- Added a v0.4.5 draft hardening handoff with stacked PR traceability,
  rollback notes, privacy assertions, and verification commands.
- Kept the public stable entry point on v0.4.4 while documenting v0.4.5 as
  the only draft-only review layer.
- Added tests around the draft-stack boundary so future documentation edits do
  not accidentally promote v0.4.5 to a release.
- Recorded local draft-hardening evidence for `verify:release`, packaged smoke,
  and the full v0.4 draft-stack audit without creating release artifacts.
- Clarified that v0.5 is the next desktop pet behavior line, not a workaround
  for any v0.4 release-state issue.

## Accumulated Since v0.4.4

The following maintenance work has landed on `main` after the v0.4.4 stable
release and belongs to this draft layer. None of it changes user-facing
behavior.

- **eslint-plugin-react-hooks 7.1.1** — adopted the React Compiler-era rules
  (`react-hooks/refs`, `set-state-in-effect`, component creation) and cleared
  all 58 violations with behavior-preserving rewrites: lazy ref init moved to
  `useState` initializers, render-time ref writes moved to commit-phase
  effects, synchronous effect `setState` became render-phase adjust with
  prior-value snapshots. The v0.2.7 render-storm invariants (memoized hook
  bags, no store-to-render `setState` loops) are preserved.
- **High-risk IPC schemas reject unknown fields** — the phase-three IPC
  payload schema rollout switched plugin, plugin-bus, telegram/discord send,
  game command, text file, VTS legacy token, MCP call/sync, external action
  policy, open-external tool policy, desktop context policy, and pet-model
  creator kit channels from silently stripping undeclared payload fields to
  rejecting them. The `mcp:sync-servers` caller now sanitizes stored server
  entries to the schema whitelist before sending, and a guard test keeps every
  high-risk schema on reject.

## Not Included

- No formal v0.4.5 release yet.
- No package version bump.
- No tag or GitHub Release.
- No README stable-entry switch.
- No new sensing source, check-in behavior, Settings redesign, feedback
  analytics, adaptive copy, external notifications, message sending, tool
  execution, productivity score, pet movement, or desktop window control.
