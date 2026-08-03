# Nexus v0.4.5 Draft Release Hardening Handoff

Status: Draft hardening handoff; not a release.

This document freezes the current v0.4 draft stack so it can be reviewed before
Klein decides whether to prepare another release. It does not publish v0.4.5,
change the package version, create a tag, create a GitHub Release, or switch the
README stable entry point.

Boundary anchor: current public stable release v0.4.4; v0.4.5 remains the
only later draft.

## Release State Lock

- Package version: `0.4.5-beta.1` — the v0.4.5 draft layer entered the
  standard beta flow (RELEASING.md Stage 1) on 2026-08-02. The beta carries
  the accumulated maintenance below; it is a manual-download validation
  slice, never an auto-update target.
- `v0.4.4` remains the current public stable release entry point.
- `v0.4.5` remains the only stacked draft review layer — the beta slice is
  part of that layer, not a stable promotion.
- No package version bump to `0.4.5` stable yet — the stable bump happens
  only when the beta window closes and the protected tag is pushed.
- No tag for the stable `v0.4.5` yet.
- No GitHub Release for the stable `v0.4.5` yet (the beta tag goes through
  the same protected workflow and stays a GitHub pre-release).
- No README stable-entry switch — READMEs keep `v0.4.4` as the stable
  entry point and list the beta as a preview block.
- No new product behavior.

## Stacked Draft Graph

- v0.4.1 -> v0.4.0: coarse time language, no new sensing.
- v0.4.3 -> v0.4.2: Settings transparency view model, no raw activity
  timeline.
- v0.4.4 -> v0.4.3: maintenance and hardening only, no user-visible
  behavior change; shipped as the current stable release.
- v0.4.5 -> v0.4.4: release-state hardening plus accumulated maintenance
  (eslint-plugin-react-hooks 7.1.1 with 58 violations cleared, high-risk IPC
  schemas switched from strip to reject), no feature expansion.

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

Maintenance accumulated on `main` after the v0.4.4 stable release also belongs
to this layer, still with no user-facing behavior change:

- eslint-plugin-react-hooks 7.1.1 upgrade with all 58 React Compiler-era lint
  violations cleared through behavior-preserving rewrites
- high-risk IPC payload schemas tightened from stripping unknown fields to
  rejecting them, with the `mcp:sync-servers` caller sanitizing persisted
  entries and a guard test preventing regression

It must not tune check-in behavior, add sensing sources, add analytics, change
runtime copy, alter Settings layout, or introduce pet movement.

## Required Draft Invariants

The v0.4 draft stack is not ready for release review if any of these fail:

- `package.json` version is still the current stable release `0.4.4`.
- Root and localized README files identify current stable `v0.4.4` and link
  `RELEASE-NOTES-v0.4.4.md` as the stable entry point.
- Draft release notes for `v0.4.5` are marked Draft and include
  the no package version bump, no tag, no GitHub Release, and no README stable
  switch boundary for future draft slices.
- `docs/V0.4_DESKTOP_COMPANION_AWARENESS.md`, `docs/ROADMAP.md`,
  `CHANGELOG.md`, and this document agree that `v0.4.5` is a draft hardening
  layer, with public stability at `v0.4.4`.
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

## Evidence Collected

Local draft-hardening evidence collected for this handoff:

- `npm run v04:draft-stack:audit` — passed locally with full mode, static source
  only, current public stable release `v0.4.4`, draft release `v0.4.5`,
  and 0 errors.
- `npm run verify:release` — passed locally. This includes `npm run verify:pr`,
  `npm run sqlite:smoke`, and `npm run core-path:smoke:built`; the test suite
  reported 2511 tests, SQLite smoke passed, and core-path smoke passed.
- `npm run package:dir:smoke` — passed locally. The unpacked macOS app launched
  from `release-smoke`, loaded the renderer, and reported packaged app loaded
  successfully.
- `git diff --check` — passed locally.

Beta flow evidence (2026-08-03):

- `prerelease-check -- v0.4.5-beta.1` — 30/30 checks passed, 0 warnings,
  including packaged smoke, packaged sustained runtime (RSS 1.0033x vs
  baseline), coverage 90.58%, and bundle 83 KB.
- CI green on all three platforms (macOS / Windows / Linux) at the release
  commit.
- `v0.4.5-beta.1` published as a GitHub pre-release with full platform asset
  closure (dmg/zip, exe, AppImage/deb/tar.gz, latest*.yml, SHA256SUMS-*).

Two release-path defects were found and fixed during the beta:

- Linux deb verification: Debian forbids `-` in version numbers, so
  electron-builder emits `0.4.5~beta.1`; the verifier now compares the
  Debian-normalized form (`scripts/verify-linux-release.mjs`, with a
  regression test).
- A draft created before a tag force-move failed publish's tag-binding
  check; the stale draft was deleted (tag kept) and the workflow rerun so
  `ensure-release` rebinds the draft to the current tag commit.

The expected local smoke warnings remained limited to ad-hoc macOS signing,
skipped notarization, optional missing KWS/SenseVoice models, and Electron/Node
deprecation warnings. Temporary smoke artifacts such as `release-smoke` and
`output/core-path-smoke` were removed after verification.

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
- The deferred feedback slice is dropped (decided 2026-08-01): keep community
  feedback qualitative; do not use structured labels or copy guardrails as
  release evidence.
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
