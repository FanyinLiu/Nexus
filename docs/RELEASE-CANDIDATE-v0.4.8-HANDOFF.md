# Nexus v0.4.8 Stable Release Handoff

Status: Stable unsigned release handoff.

v0.4.8 is the current stable version. It was promoted through the standard beta
flow after the `v0.4.8-beta.1` release of 2026-10-15 and its beta validation
window. The planned `0.4.8-beta.2` package was dropped; this tree ships directly
as stable. Official binaries must still be rebuilt from the release commit by
the protected tag workflow.

## Release content boundary

- gaze follow and coarse typing awareness, with the frameless backdrop off by
  default
- Warm companion, System look, and A little character appearances in light and
  dark
- Telegram and Discord message cards on the companion panel
- Voice auto-detect, on-demand SenseVoice, and GLM-ASR / OmniVoice sidecars that
  start only when chosen and voice is on
- memory v2 records, open-loop follow-ups, one proactive agenda, and editable
  memory cards
- memory clear that also removes the search copy, storage logs, presence notes,
  and update snapshots
- five plain settings pages, language-first onboarding, and plain error notices
- Live2D as the only pet type, with Mao, Haru, and Hiyori as the bundled choices
- October 2026 catalog defaults, `MiniMax-M2.7` retirement handling, and
  `gpt-transcribe` as the custom speech-to-text default
- Electron 43.7.11, window-bound capabilities, and flush-before-install updates

## Evidence boundary

The release commit must pass `verify:release`, Live2D smoke, packaged smoke, the
sustained runtime gate, and `prerelease-check -- v0.4.8`. CI must be green on
macOS, Windows, and Linux before the protected tag workflow publishes artifacts.
No cross-platform physical-device evidence is claimed.

The macOS arm64 build remains ad-hoc signed and not notarized. The Windows x64
installer remains unsigned. Users should use only the official GitHub Release
and verify the published platform checksum.

## Promotion record

The v0.4.8 stable promotion updates the package version, release spotlight,
README stable entries, release notes, changelog, roadmap, and release audit
anchors from v0.4.7. The v0.4.7 notes and handoff remain as the previous public
stable record, and the v0.4.8-beta.1 notes remain as the beta record.
