# Nexus v0.4.0-beta.1 Release Candidate Handoff

## Status

- Evidence baseline head: `d454731394b1077f689c41c70563503a406e3e99`.
- Published beta head: `d454731394b1077f689c41c70563503a406e3e99`.
- Branch: `main`.
- State: published prerelease.
- Release:
  [`v0.4.0-beta.1`](https://github.com/FanyinLiu/Nexus/releases/tag/v0.4.0-beta.1).
- Product theme: v0.4 desktop companion awareness begins. Nexus can stay
  quietly present after the user opens it, notice coarse time passing, and use
  low-frequency companion care without becoming a screen recorder, stopwatch,
  productivity dashboard, or Codex-style work agent.

This beta handoff is the version-specific entry point for
`v0.4.0-beta.1`. The durable release-hardening checklist is
[v0.4 Release Hardening Handoff](RELEASE-CANDIDATE-v0.4-HARDENING.md).

## Evidence Collected

- `npm run verify:release` — passed locally.
- `npm run package:dir:smoke` — passed locally; the unpacked macOS arm64 app
  launched, loaded the renderer, and exited cleanly.
- `npm run prerelease-check -- v0.4.0-beta.1 --skip=A` — passed with 20
  blocker checks, 0 warnings, and 0 failures.
- `npm run prerelease-check -- v0.4.0-beta.1 --only=A` — version and tag checks
  passed on `main` before tagging.
- GitHub PR
  [#106](https://github.com/FanyinLiu/Nexus/pull/106) merged into `main` with
  commit `d454731394b1077f689c41c70563503a406e3e99`.
- Tag `v0.4.0-beta.1` points to
  `d454731394b1077f689c41c70563503a406e3e99`.
- Release Build run `27901490144` passed, including preflight, Windows, macOS,
  Linux, and publish jobs.
- Published assets include Windows `.exe`, macOS `.dmg` and `.zip`, Linux
  `.AppImage`, `.deb`, `.tar.gz`, updater metadata, and `SHA256SUMS`.
- Pausing or disabling desktop companion awareness now clears the recent local
  companion summary so Settings does not keep stale awareness status after the
  user pauses the feature.

## Scope

Included in this beta:

- quiet observation when Nexus is open but unused
- coarse time language instead of exact timers
- conservative check-in policy
- Settings transparency for observation, storage, model reach, pause, and clear
- community beta feedback path for timing, tone, interruption feel, permissions,
  privacy boundaries, and false positives

Out of scope:

- v0.5 desktop pet mouse-following or typing reactions
- automatic mouse or keyboard control
- raw desktop recording history
- productivity analytics
- file reading, message sending, app opening, or settings changes without
  explicit user action

## Publication Result

`v0.4.0-beta.1` has been tagged, pushed, built, and published. Do not reuse the
tag for fixes; publish a higher beta if a regression is found.

## Known Local Smoke Warnings

- macOS local package uses ad-hoc signing and skips notarization.
- Optional KWS/SenseVoice models may be missing in local developer smoke.
- Electron/Node deprecation warnings can appear during local packaging or
  launch.

## Rollback

- If the companion awareness summary regresses, disable the awareness summary
  path while keeping normal chat, Memory settings, and the pause setting usable.
- If beta feedback reports monitoring-like copy, ship a higher beta with copy
  changes; do not reuse the tag.
- If a privacy issue is found after publication, publish a higher beta tag and
  call out the privacy boundary in the release notes.
