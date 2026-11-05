# Nexus v0.5.0 Stable Release Handoff

Status: Stable unsigned release handoff.

v0.5.0 is the current stable version. The owner recorded a version-scoped
maintainer exception in `RELEASING.md` to promote this exact tree after the
automated gate, waiving the standard beta flow and the multi-day beta
validation window. No multi-day conversation evidence or cross-platform
physical-device validation is claimed. Official binaries must still be rebuilt
from the release commit by the protected tag workflow.

## Release content boundary

- Notebook for things she could not say yet. Unread notes open beside her,
  the last 15 days stay, and red-dot counts are gone.
- Reminders show only the key point. Notifications keep the short line.
- Optional reminder strip beside the pet. It does not take keyboard focus,
  then tucks itself away.
- Mouse-near glance, once, then a wait before the next glance.
- Quiet while typing. Off by default. It only knows that you are typing,
  never which keys.
- Away summary count when you return.
- “Diary” is now “Daily log.”
- Letters to the future: a short lead-in, then the original text unchanged.
  Speech and notifications keep only that lead-in.

## Evidence boundary

The release commit must pass `verify:release`, Live2D smoke, packaged smoke,
the sustained runtime gate, and `prerelease-check -- v0.5.0`. CI must be green
on macOS, Windows, and Linux before the protected tag workflow publishes
artifacts. No cross-platform physical-device evidence is claimed.

Local isolated-data acceptance on macOS arm64 was recorded against tip
`663c8c03`. That note is not cross-platform physical-device evidence.

The macOS arm64 build remains ad-hoc signed and not notarized. The Windows x64
installer remains unsigned. Users should use only the official GitHub Release
and verify the published platform checksum.

Repository Actions secrets must include `NEXUS_UPDATE_SIGNING_KEY`, or the
Windows and Linux update-manifest signing step fails and the release workflow
cannot publish.

## Promotion record

The v0.5.0 stable promotion updates the package version, release spotlight,
README stable entries, release notes, changelog, roadmap, and release audit
anchors from v0.4.8. The v0.4.8 notes and handoff remain as the previous public
stable record.
