# Nexus v0.5.2 Stable Release Handoff

Status: Stable unsigned release handoff.

v0.5.2 is the current stable version. The owner recorded a version-scoped
maintainer exception in `RELEASING.md` to promote this exact tree after the
automated gate, waiving the standard beta flow and the multi-day beta
validation window. No multi-day conversation evidence or cross-platform
physical-device validation is claimed. Official binaries must still be rebuilt
from the release commit by the protected tag workflow.

## Release content boundary

- Saved privacy switches are enforced in the main process. A snoozed reminder
  no longer reads the window title when the saved active-window switch is off
  or companion awareness is paused.
- Base-URL credentials are redacted from chat logs, and MCP server stderr is
  line-buffered and redacted before it reaches the run log.
- Webview tags are disabled, every attach attempt is denied, the preload bridge
  exposes 48 fewer renderer methods, and every IPC handler must begin with the
  trusted-sender check.
- Voice sidecar scripts found inside `app.asar` are rejected instead of being
  passed to `child_process`.
- The pet window retries a failed load, then shows a local retry page on first
  launch; a user-initiated show grants one fresh attempt.
- Failed hidden-panel takeover rebuilds back off from 5 seconds up to 120
  seconds, reclaim re-checks visibility first, and resume or unlock gets a
  30-second grace period.
- Clock rollback no longer makes later recurring reminders look delivered.
  Queued reminders wait through listening and continuous voice, then continue
  once when the session ends.
- Deleting one memory writes a salted fingerprint tombstone so later
  extraction, model reconcile, and daily consolidation do not learn it again.
  Manual re-add removes the tombstone; clear-all drops the tombstones.
- User-facing errors and main-process approval dialogs use plain language in
  all five languages. External-link confirmation can be turned off (default
  on) without skipping URL safety checks. Startup no longer prompts for
  microphone or screen access.
- Removed dead pet roaming/free-mode locomotion and its 45ms timer. Electron is
  43.8.8 and electron-updater is 6.8.12.

## Evidence boundary

The release commit must pass `verify:release`, Live2D smoke, packaged smoke,
the sustained runtime gate, and `prerelease-check -- v0.5.2`. CI must be green
on macOS, Windows, and Linux before the protected tag workflow publishes
artifacts. No cross-platform physical-device evidence is claimed.

No multi-day conversation evidence is claimed. Typing-awareness and macOS
Accessibility behavior are covered by tests, not re-validated on physical
devices in this release. Removing the dead roaming timer is not a measured
performance claim.

The macOS arm64 build remains ad-hoc signed and not notarized. The Windows x64
installer remains unsigned. Users should use only the official GitHub Release
and verify the published platform checksum.

## Unsigned update channel record — 2026-11-12

The owner (音梵) explicitly authorized v0.5.2 to publish without
`NEXUS_UPDATE_SIGNING_KEY`, keeping the same `unsigned-manual` profile as
v0.5.1 under a new version-scoped exception. The Windows/Linux `latest*.yml`
and `.sig` files are removed before checksums and upload, so no unsigned
manifest reaches clients that would refuse it. Installers and every platform's
`SHA256SUMS-*` still publish.

Consequences for this version:

- Windows and Linux have no automatic update. Users must download later
  versions manually from the official GitHub Releases.
- macOS remains ad-hoc signed with manual-download updates.
- Windows remains `NotSigned` with the expected SmartScreen warning.
- No gate was waived: tag provenance, `release:unsigned:gate`,
  `prerelease-check`, packaging, checksum generation, remote asset closure, and
  draft publication all still run.

This exception is scoped to v0.5.2 only. v0.5.3 and later must restore the
signed profile or record a new version-scoped exception before tagging.

## Promotion record

The v0.5.2 stable promotion updates the package version, release spotlight,
README stable entries, release notes, changelog, roadmap, and release audit
anchors from v0.5.1. The v0.5.1 notes and handoff remain as the previous public
stable record.
