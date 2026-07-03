# Nexus v0.4.5 Draft Release Hardening Handoff

Status: Draft hardening handoff; not a release.

This document freezes the current v0.4 draft stack so it can be reviewed before
Klein decides whether to prepare another release. It does not publish v0.4.5,
change the package version, create a tag, create a GitHub Release, or switch the
README stable entry point.

## Release State Lock

- Package version remains at the active stable `0.4.1` until a future release
  is explicitly promoted.
- `v0.4.1` remains the current stable release entry point.
- `v0.4.2`, `v0.4.3`, `v0.4.4`, and `v0.4.5` remain stacked draft review
  layers.
- No package version bump.
- No tag.
- No GitHub Release.
- No README stable-entry switch.
- No new product behavior.

## Stacked Draft Graph

- v0.4.1 -> v0.4.0: coarse time language, no new sensing.
- v0.4.2 -> v0.4.1: local check-in decision policy, no external notification
  channel.
- v0.4.3 -> v0.4.2: Settings transparency view model, no raw activity
  timeline.
- v0.4.4 -> v0.4.3: beta feedback labels and copy safety, no feedback
  analytics or adaptive copy.
- v0.4.5 -> v0.4.1-v0.4.4: release-state hardening only, no feature expansion.

If one draft layer is dropped or rewritten before release, every later draft in
the graph must be rechecked against the same privacy and no-release invariants.

## Hardening Scope

v0.4.5 exists to keep release state coherent:

- source-only audit for the v0.4 draft stack
- quick PR guard for version and stable-entry invariants
- cross-document agreement on stable vs draft status
- explicit no-release guardrails
- repeatable local verification commands
- rollback notes for disabling desktop companion awareness while leaving chat,
  memory, and settings usable
- v0.5 handoff boundary for later desktop pet behavior

It must not tune check-in behavior, add sensing sources, add analytics, change
runtime copy, alter Settings layout, or introduce pet movement.

## Required Draft Invariants

The v0.4 draft stack is not ready for release review if any of these fail:

- `package.json` version is still the active stable `0.4.1`.
- Root and localized README files still link `RELEASE-NOTES-v0.4.1.md` as the
  stable entry point.
- Draft release notes for `v0.4.2` through `v0.4.5` are marked Draft and include
  the no package version bump, no tag, no GitHub Release, and no README stable
  switch boundary for future draft slices.
- `docs/V0.4_DESKTOP_COMPANION_AWARENESS.md`, `docs/ROADMAP.md`,
  `CHANGELOG.md`, and this document agree that `v0.4.5` is a draft hardening
  layer.
- No document claims `v0.4.5` is stable.

## Verification Commands

CI only enforces quick audit; full audit is non-blocking release evidence.

Before this draft can be considered ready for maintainer review, run:

```bash
npm run v04:draft-stack:audit:quick
npm run v04:draft-stack:audit
npm run verify:release
npm run package:dir:smoke
npm run desktop-context-privacy:audit
npm run message-privacy:audit
npm run error-redaction:audit
npm run ipc:audit
npm run distribution:audit
git diff --check
```

Expected local smoke warnings remain acceptable when unchanged:

- macOS local package uses ad-hoc signing and skips notarization.
- Optional KWS/SenseVoice models may be missing in local developer smoke.
- Electron/Node deprecation warnings can appear during local packaging or
  launch.

## Privacy Assertions

v0.4.5 must preserve the v0.4 privacy boundary:

- model-facing desktop companion context uses sanitized summaries only
- rough time buckets only; no exact second-level timers
- no raw screenshots, OCR dumps, clipboard bodies, private message bodies, file
  paths, user IDs, or session traces in prompts, logs, localStorage, support
  reports, release reports, or feedback helpers
- feedback labels remain non-training, non-adaptive, non-scoring, local, and
  non-persistent
- pausing desktop companion awareness removes the model-facing summary path
- active chat with Nexus takes priority over proactive companionship

## Rollback Matrix

- Drop v0.4.2: keep quiet observation silent; do not ship local check-in
  payloads.
- Drop v0.4.3: keep existing Settings controls; do not expose a partial
  transparency view model.
- Drop v0.4.4: keep community feedback qualitative; do not use structured
  labels or copy guardrails as release evidence.
- Drop v0.4.5: release review must manually prove every no-release invariant
  before any future tag.

For a privacy issue, disable the desktop companion awareness summary path first
while keeping chat, memory, and settings usable. Do not ship v0.5 desktop pet
behavior as a workaround for v0.4 sensing or copy issues.

## Hand-Off To v0.5

v0.5 remains the desktop pet behavior line: mouse-following, typing-following,
idle reactions, and desktop-state reactions. It should start only after the
v0.4 draft stack proves that quiet observation is pauseable, explainable,
privacy-bounded, and free of unresolved monitoring-like copy.
