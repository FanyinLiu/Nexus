# Nexus v0.5.1

**Status: Stable unsigned release.** The owner recorded a version-scoped
maintainer exception in `docs/RELEASING.md` to promote this exact tree after the
automated gate, waiving the standard beta flow and the multi-day beta validation
window. No multi-day conversation evidence or cross-platform physical-device
validation is claimed. Official binaries must still be rebuilt from the release
commit by the protected tag workflow.

Patch on 0.5.0. Fixes a few things you actually hit: packaged voice, reminders
after you interrupt the pet, reminders when the pet freezes, and the panel left
around after a new user's first setup.

## What changed

- **Qwen3 voice is back in packaged builds.** 0.5.0 left the Qwen3 voice files
  out of the installer; this build includes them again, so that voice path can
  start.
- **Interrupting the pet no longer loses reminders.**
  - Typing a message, talking over her, or starting a new voice chat only cuts
    the current line. Queued reminders and letters wait until the pet finishes its
    reply and is idle, then continue; an interrupted reminder is read again once.
  - Ending a voice chat yourself with the button: the pet stays quiet for about
    15 seconds, then continues if nothing new has started.
- **Reminders still fire when the pet window is gone or frozen.** The panel
  takes over — one-shot, daily, weekly, and repeating alike (weather, search,
  and scheduled-chat tasks aren't taken over: if the pet unfreezes, the most
  recent missed run catches up; if the pet or app restarts, runs due more than
  30 seconds earlier are skipped). It keeps working even if the panel has been
  hidden a long time. Reminders (including repeating ones) due within about
  30 seconds before launch are delivered now instead of dropped; reminders that
  came due while the app was closed are not replayed.
- **A bit less memory after a new user finishes onboarding.** The first time the
  panel is hidden, it's released — about 120 MiB less for as long as the panel
  stays closed. The first reopen after that is a little slower (about 0.25 s),
  first time only, and the saving goes away once it's open again. Existing users
  are unaffected.

## Update channel (v0.5.1): unsigned-manual

This release keeps the v0.5.0 unsigned-manual profile. Windows and Linux publish
installers and `SHA256SUMS-*.txt` only; no `latest*.yml` or `.sig` files are
published, and there is no automatic update on Windows or Linux. macOS arm64 is
ad-hoc signed and updates by manual download from the official GitHub Release.

## Validation boundary

The release commit must pass `verify:release`, the Live2D smoke, packaged smoke,
the sustained runtime gate, and `prerelease-check -- v0.5.1`. Cross-platform CI
must be green on macOS, Windows, and Linux. No cross-platform physical-device
evidence is claimed.

## macOS unsigned auto-update limitation

The macOS arm64 build is ad-hoc signed, not Apple Developer ID signed or
notarized. Gatekeeper may require right-click → Open or
`xattr -dr com.apple.quarantine /Applications/Nexus.app`. Unsigned macOS builds
only check for a new version and open the official release page; the update is
downloaded and installed by hand.

## Windows unsigned installer limitation

The Windows x64 installer is `NotSigned`. SmartScreen may show an
unknown-publisher warning. Bypassing that warning is not a security guarantee.
Use only the official GitHub Release and verify its published SHA-256 checksum.

## Scope boundary

- Headline scope: packaged Qwen3 voice, interrupt handling that
  only cuts the current line, panel reminder takeover when the pet is offline,
  and first-use panel memory reclaim.
- Out of scope: signed or notarized installers and automatic updates on Windows
  and Linux.
- No telemetry.

## Known issues

- No cross-platform physical-device evidence is claimed.
- The macOS and Windows builds remain unsigned, so the first launch can show a
  system trust prompt.
- No human-listening acceptance is claimed for the packaged Qwen3 voice path.
