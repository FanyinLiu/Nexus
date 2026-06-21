# Nexus v0.4.0 Stable Release Checklist

## Status

- Scope: v0.4.0 stable, Quiet Observation Foundation only.
- Current public baseline: `v0.4.0-beta.1`.
- Stable target: `v0.4.0`.
- Release state: `final_candidate`; README entry points and package version now
  target `v0.4.0` for final tag validation.
- Product boundary: freeze the passive observation foundation. Do not add new
  sensing sources, proactive check-ins, pet motion, or expanded time-language
  behavior while preparing the stable tag.

This checklist is the stable-tag companion to
[v0.4 Release Hardening Handoff](RELEASE-CANDIDATE-v0.4-HARDENING.md). It exists
to keep the beta-to-stable step focused on correctness, privacy proof, and
rollback readiness.

Stable release notes are prepared in
[Nexus v0.4.0 Release Notes](RELEASE-NOTES-v0.4.0.md) and
[Nexus v0.4.0 Release Notes zh-CN](RELEASE-NOTES-v0.4.0.zh-CN.md). Keep them
aligned with the final verification result before the `v0.4.0` tag is created.

## Stable Scope

v0.4.0 stable may include:

- bug fixes for quiet observation correctness
- privacy scrub fixes for prompt, IPC, storage, logs, and support surfaces
- release documentation and evidence updates
- tests that prove the existing v0.4.0 boundary

v0.4.0 stable must not include:

- proactive check-in scheduling
- new desktop sensing sources
- mouse-following, typing-following, or pet window control
- productivity scoring, activity dashboards, or raw activity timelines
- model-driven reinterpretation of observer fields
- broad copy, tone, or semantic behavior changes that belong to later v0.4.x
  releases

## P0 Stable Gates

### Quiet Observation Contract

The final release must preserve a deterministic summary contract:

- `activityClass` is a broad enum and falls back safely when unknown.
- `elapsedBucket` is one of the approved rough buckets.
- `elapsedLabel` is derived from the bucket and must not expose exact minutes,
  seconds, timestamps, or clock-like durations.
- `userDeepFocused`, `activeElsewhere`, and `shouldStaySilent` remain boolean
  guard fields, not productivity scores.
- The prompt receives the summary as companionship continuity only.

### Trigger State Boundary

Quiet observation may run only when all of these are true:

- Nexus is open.
- Desktop companion awareness is enabled.
- Companion awareness is not paused.
- The user has not recently interacted with Nexus.
- The user appears active outside Nexus.
- Nexus interaction timestamps are in-memory app-session state only. They must
  not be persisted, migrated, or reused across app sessions.

Quiet observation must not compete with direct chat. If the user is actively
using Nexus, normal conversation has priority.

### Privacy Enforcement

The stable release is blocked if any v0.4.0 path exposes raw desktop content to
the model, logs, localStorage, issue reports, support reports, or Settings.

Forbidden raw content includes:

- screenshots and OCR dumps
- full clipboard contents
- active window titles
- private message bodies
- private file paths
- exact timers or timestamp trails

When an input cannot be safely summarized, the behavior must be to drop it or
fall back to a safe unknown state, not to mask and forward it.

### Lifecycle And Purge

- Pausing companion awareness immediately clears the recent local companion
  summary.
- Disabling context awareness immediately clears the recent local companion
  summary.
- Clearing the recent summary removes the stored coarse summary.
- Recent summaries are scoped to the current app session; restart or session
  mismatch must clear the stored summary instead of replaying historical
  desktop activity as current context.
- Recent summaries must also match the current in-memory renderer lifecycle.
  Browser or renderer restore must not reconstruct a previous lifecycle's
  summary even when sessionStorage is restored.
- Recent summaries must also be dropped if they predate the current session,
  exceed the hard 24-hour safety cap, or appear to come from the future.

## Required Verification

Run these before preparing the stable tag:

```bash
npm run verify:release
npm run package:dir:smoke
npm run desktop-context-privacy:audit
npm run message-privacy:audit
npm run error-redaction:audit
npm run ipc:audit
npm run distribution:audit
npm run prerelease-check -- v0.4.0
```

Targeted v0.4.0 checks should also cover:

- quiet observation summary construction
- direct Nexus interaction priority over quiet observation
- Nexus interaction state lifecycle before quiet observation handoff
- invalid timing inputs dropping instead of producing partial summaries
- unknown activity fallback preserving the full safe summary schema
- sanitized prompt formatting
- recent companion summary storage and clearing
- previous-session companion summary purge
- restored lifecycle provenance mismatch purge
- cross-session localStorage summary conflict cleanup
- invalid JSON localStorage summary residue cleanup
- stale, pre-session, and future companion summary purge
- transparency summary output
- settings pause and clear behavior
- exact-time leak prevention
- disabled and paused paths

## Evidence Collected

- `npm run verify:release` — passed locally on the `v0.4.0` package version.
  This covered typecheck, lint, 2053 tests, production build, storage audit,
  heavy module audit, architecture audit, source-size audit, performance
  baseline, companion boundary audit, message privacy audit, desktop context
  privacy audit, vault security audit, error redaction audit, IPC audit,
  distribution audit, and SQLite smoke.
- `npm run prerelease-check -- v0.4.0 --only=E --quick` — passed locally with
  10 blocker checks, 0 warnings, and 0 failures after stable README and release
  note entry points were switched from beta to `v0.4.0`.
- `npm run prerelease-check -- v0.4.0 --skip=A` — passed locally with 28
  blocker checks, 0 warnings, and 0 failures. Stage A was intentionally skipped
  because the final commit, clean working tree, tag absence, remote HEAD, and CI
  checks can only be validated after the release changes are committed and the
  final tag is being prepared.
- External sanitized release-readiness review — confirmed no remaining
  functional, privacy, or lifecycle blocker based on the provided gate summary;
  the only remaining requirement is the formal Stage A release-integrity check
  after the final commit and before the `v0.4.0` tag.
- `npm run prerelease-check -- v0.4.0 --only=A` — partially passed after the
  local candidate commit. A.1-A.5 passed: tag format, package version, local tag
  absence, remote tag absence, and clean working tree. A.6-A.7 remain pending
  because the candidate commit is on `codex/v0.4.0-stable-candidate`, not yet
  `origin/main`, and therefore has no CI run on the final main HEAD.

## Manual Checks

Before the stable tag:

- Settings -> Memory shows pause and clear controls without changing unrelated
  control sizes.
- Settings explains observation, storage, and model reach without raw desktop
  content.
- Returning to Nexus after being away can preserve continuity without exact
  minute or second wording.
- Pausing companion awareness removes the active summary from the visible state.
- The app still behaves like v0.3 normal chat when desktop companion awareness
  is disabled.

## Beta Feedback Review

Review beta feedback before stable. Do not expand scope to solve every report.
Only block stable for:

- privacy leaks
- monitoring-like or stopwatch-like wording in v0.4.0 surfaces
- pause, clear, or disable controls not working
- direct chat losing priority to quiet observation
- cross-platform breakage in the existing summary contract

Reports about proactive check-ins, richer timing language, or pet behavior
belong to later v0.4.x or v0.5 planning.

## Rollback

If a stable blocker appears:

- disable the quiet observation summary path first
- keep normal chat, memory settings, and pause controls usable
- clear recent local companion summaries
- do not ship v0.5 pet behavior as a workaround
- publish another beta instead of promoting the stable tag
