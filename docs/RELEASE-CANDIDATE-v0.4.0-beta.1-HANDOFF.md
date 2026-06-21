# Nexus v0.4.0-beta.1 Release Candidate Handoff

## Status

- Evidence baseline head: `517b822` plus local working-tree v0.4 changes.
- Branch: local working tree.
- State: locally validated for beta preparation; final tag is blocked only by
  release-branch process items recorded below.
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
  now pass after the package version bump. Remaining blockers are clean working
  tree and release head alignment with `origin/main`.
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

## Remaining Required Steps

Before tagging `v0.4.0-beta.1`:

```bash
git status --short
npm run prerelease-check -- v0.4.0-beta.1 --only=A
git tag v0.4.0-beta.1
git push origin v0.4.0-beta.1
gh run watch --repo FanyinLiu/Nexus
```

Do not tag until the working tree is clean, the release commit has landed, and
`HEAD === origin/main`.

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
