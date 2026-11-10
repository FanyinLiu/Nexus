# Nexus v0.5.1 Stable Release Handoff

Status: Stable unsigned release handoff.

v0.5.1 is the current stable version. The owner recorded a version-scoped
maintainer exception in `RELEASING.md` to promote this exact tree after the
automated gate, waiving the standard beta flow and the multi-day beta
validation window. No multi-day conversation evidence or cross-platform
physical-device validation is claimed. Official binaries must still be rebuilt
from the release commit by the protected tag workflow.

## Release content boundary

- The packaged Qwen3 Python voice script is included again. 0.5.0 left it out
  of the installer, so that voice path could not start.
- Interrupting the pet only cuts the current line. Queued reminders and letters
  wait until the reply finishes and the pet is idle, then continue; an
  interrupted reminder is read again once.
- Ending a voice chat with the button keeps the pet quiet for about 15 seconds
  before it continues.
- The panel takes over one-shot, daily, weekly, and repeating reminders when the
  pet window is gone or frozen, including after a long hide. Weather, search,
  and scheduled-chat tasks stay with the pet window.
- After a new user finishes onboarding, the first hidden panel is released.
  About 120 MiB less is used while it stays closed; the first reopen is about
  0.25 s slower, first time only. Existing users are unaffected.

## Evidence boundary

The release commit must pass `verify:release`, Live2D smoke, packaged smoke,
the sustained runtime gate, and `prerelease-check -- v0.5.1`. CI must be green
on macOS, Windows, and Linux before the protected tag workflow publishes
artifacts. No cross-platform physical-device evidence is claimed.

No multi-day conversation evidence and no human-listening acceptance for the
packaged Qwen3 voice path are claimed.

The macOS arm64 build remains ad-hoc signed and not notarized. The Windows x64
installer remains unsigned. Users should use only the official GitHub Release
and verify the published platform checksum.

## Unsigned update channel record — 2026-11-10

The owner (音梵) explicitly authorized v0.5.1 to publish without
`NEXUS_UPDATE_SIGNING_KEY`, keeping the same `unsigned-manual` profile as
v0.5.0. The Windows/Linux `latest*.yml` and `.sig` files are removed before
checksums and upload, so no unsigned manifest reaches clients that would refuse
it. Installers and every platform's `SHA256SUMS-*` still publish.

Consequences for this version:

- Windows and Linux have no automatic update. Users must download later
  versions manually from the official GitHub Releases.
- macOS remains ad-hoc signed with manual-download updates.
- Windows remains `NotSigned` with the expected SmartScreen warning.
- No gate was waived: tag provenance, `release:unsigned:gate`,
  `prerelease-check`, packaging, checksum generation, remote asset closure, and
  draft publication all still run.

This exception is scoped to v0.5.1 only. v0.5.2 and later must restore the
signed profile or record a new version-scoped exception before tagging.

## Promotion record

The v0.5.1 stable promotion updates the package version, release spotlight,
README stable entries, release notes, changelog, roadmap, and release audit
anchors from v0.5.0. The v0.5.0 notes and handoff remain as the previous public
stable record.
