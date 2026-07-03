# Nexus v0.4.1 — Companion UI, Settings, and Reliability Hardening

v0.4.1 is the first stable follow-up to the v0.4 desktop companion awareness
foundation. It does not turn Nexus into an autonomous work agent and it does not
start the v0.5 desktop-pet window-control line. This release focuses on making
the companion surface, Settings, release checks, and privacy boundaries easier
to trust before the next product layer ships.

## Highlights

- **Companion UI source organization** — the panel, composer, message, dial,
  collapsed, rhythm, motion, and visual-lock styles are split into focused
  source files so the companion surface can keep evolving without turning the
  main stylesheet into one large edit point.
- **Settings surface hardening** — Settings gets clearer source structure,
  source-only surface audits, and an explicit options architecture document so
  the Settings UI can follow the chat surface without hiding too much behavior
  in one component.
- **Settings drawer performance guard** — the Settings drawer entry stays lazy.
  Styles load as a dedicated CSS chunk and the lazy JS entry remains tiny, so
  opening Settings does not reintroduce raw CSS string injection or push large
  Settings rules onto the startup path.
- **Image4 companion field guardrails** — Image4 panel state, signal rendering,
  activity labels, composer state, visual rhythm, and color boundaries now have
  source-level contracts and tests.
- **Custom companion-name wake word sync** — companion-name changes now have a
  dedicated wake-word synchronization layer so future voice wake behavior can
  track user naming choices without importing app-level code into feature
  modules.
- **Runtime privacy and redaction hardening** — desktop context, message
  privacy, vault, support logs, runtime log sanitization, memory-vector support
  buffers, and network-error redaction are covered by stricter source-only
  audits.
- **Release upload prep** — `docs/GITHUB_UPLOAD_PREP.md` records the intended PR
  framing, review order, performance baseline, and verification commands for
  this large v0.4.1 review branch.

## What Changed

### UI and Settings

- Split the companion panel CSS into focused modules under
  `src/app/styles/panel-companion*.css`.
- Added the Image4 companion field, rhythm grid, signal, activity label, chat
  preview, companion state, and composer state modules.
- Added Settings surface reference docs, options architecture docs, and source
  audits for Settings, chat, composer, forms, focus management, streaming, and
  agent-activity surfaces.
- Kept local UI QA screenshots and metrics out of the repository through the
  `docs/ui-qa/` ignore rule; source-backed review docs stay committed instead.

### Performance

- Changed `src/app/settingsDrawerEntry.ts` so Settings styles are imported as
  normal lazy CSS resources rather than bundled as raw CSS strings in JavaScript.
- Expanded `scripts/performance-baseline.mjs` with separate budgets for:
  - total CSS
  - largest CSS chunk
  - initial CSS chunk
  - Settings drawer lazy CSS
  - Settings drawer lazy JS entry
- Added failure checks when the Settings lazy CSS or lazy JS entry disappears,
  because that usually means Settings styles moved back into the startup path.
- Updated `docs/PACKAGE_STARTUP_OPTIMIZATION.md` with the new baseline:
  Settings drawer lazy CSS at about 554 KB and Settings drawer lazy JS entry at
  about 0.1 KB.

### Companion Awareness and Voice Boundaries

- Kept desktop companion awareness focused on coarse, privacy-bounded summaries.
- Preserved the v0.4 rule that time language should feel approximate and
  companion-like, not stopwatch-like.
- Added or tightened tests for coarse time labels, localized exact-time leak
  detection, check-in policy behavior, summary storage, and transparency view
  models.
- Added a companion wake-word synchronization layer for custom companion names.

### Privacy, Security, and Release Checks

- Added runtime log sanitization and memory-vector support log buffering with
  redaction-focused tests.
- Split error-redaction audit phrases and rules into focused source files.
- Extended message privacy, desktop context privacy, vault security, and network
  error-redaction audits.
- Added or expanded source-only release, storage, IPC, architecture, and
  boundary audit fixture tests.
- Updated `verify:pr` so the new UI, privacy, performance, and release gates run
  together.

## Still Out of Scope

v0.4.1 does not include:

- external proactive notifications
- message sending
- tool execution without explicit user action
- productivity scoring
- raw desktop activity timelines
- new sensing sources
- pet mouse-following, typing-following, or desktop-window control
- a new public release process beyond the `v0.4.1` tag and GitHub Release

Those remain later v0.4.x or v0.5 work.

## Distribution Notes

Until Nexus has signed installers and notarized macOS distribution, manual
installs may still show platform trust prompts:

- macOS may show Gatekeeper or quarantine warnings. If you intentionally
  downloaded Nexus from the official GitHub Release, remove quarantine only for
  that downloaded app bundle.
- Windows may show SmartScreen warnings because the installer is not yet backed
  by broad code-signing reputation.

Do not download installers from mirrors or reposted archives.

## Verification

The local upload-prep checks for this branch passed before promotion to the
v0.4.1 candidate:

```bash
git diff --check
npm run source-size:audit
npm run performance:baseline
npm run distribution:audit
npm run verify:pr
npm audit --omit=dev
```

Before publishing the final GitHub Release, run the release gates on the final
pushed commit:

```bash
npm run verify:release
npm run prerelease-check -- v0.4.1
npm run package:dir:smoke
```
