# Nexus v0.5.2

**Status: Stable unsigned release.** The owner recorded a version-scoped
maintainer exception in `docs/RELEASING.md` to promote this exact tree after the
automated gate, waiving the standard beta flow and the multi-day beta validation
window. No multi-day conversation evidence or cross-platform physical-device
validation is claimed. Official binaries must still be rebuilt from the release
commit by the protected tag workflow.

Patch on 0.5.1. Privacy switches now hold in the main process, logs and MCP
output are redacted, reminders survive clock changes and voice sessions, deleted
memories stay deleted, and error and approval copy uses plain language.

## What changed

### Privacy and security

- **Saved privacy switches are enforced in the main process.** When the saved
  active-window switch is off, or companion awareness is paused, a snoozed
  reminder no longer reads the window title or classifies fullscreen.
- **Chat logs no longer keep credentials embedded in a base URL.** MCP server
  stderr is line-buffered and redacted before it reaches the run log.
- **Webview tags are disabled, and every attach attempt is denied.** The
  preload bridge exposes 48 fewer renderer methods, and every IPC handler must
  begin with the trusted-sender check.
- **Voice sidecar scripts inside `app.asar` are rejected.** `child_process`
  cannot run a file that only exists inside the archive, so the path resolves as
  missing with an actionable warning instead.
- **Typing awareness stays off by default.** A denied macOS Accessibility grant
  keeps the hook stopped; both guards are pinned by tests.

### Reliability

- **The pet window recovers from load failures.** A failed main-frame load
  retries twice, then shows a local retry page on first launch. Showing the pet
  again, including from the tray, grants one fresh attempt.
- **Takeover panels rebuild without churn.** A failed hidden-panel rebuild backs
  off from 5 seconds up to 120 seconds, reclaim re-checks visibility before
  destroying the panel, and resume or unlock gets a 30-second grace period.
- **Clock rollback no longer skips later reminders.** A trigger stamp later than
  the current time is not treated as delivered for a recurring reminder; a
  one-shot reminder is not replayed after a rollback.
- **Queued reminders wait through voice sessions.** Deferred notices hold while
  listening or continuous voice owns the microphone, release once when the
  session ends, and use a 30-second stuck-session fallback. Stopping all keeps
  the queued reminders in one chat line.
- **Deleted memories stay deleted.** Deleting one memory writes a salted
  fingerprint tombstone, never the wording. Later extraction, model reconcile,
  and daily consolidation skip it; adding the fact by hand removes the
  tombstone, and clear-all drops the tombstones too.

### Wording and settings

- **Errors use plain language in all five languages.** Raw technical details go
  to the log instead of the user-facing message, and main-process error copy is
  localized.
- **Approval dialogs are plain and localized.** MCP and plugin approval copy is
  available in all five languages and points to Settings → Connection, with the
  revoke path at Settings → Connection → Advanced → MCP.
- **Copy matches the current settings.** The FAQ points at the current settings
  names, voice status no longer uses engine terms, memory clearing calls the
  inbox the notebook, integration entries use Connections, and ElevenLabs voice
  labels are translated.
- **External-link confirmation can be turned off.** It stays on by default, and
  turning it off still normalizes and checks the URL before anything opens.
- **Startup no longer prompts for permissions.** Startup only inspects features
  the user already enabled, read-only. The OS prompt or Settings guidance runs
  only when the user turns a feature on.
- **Manual updates are documented.** Windows and Linux have no automatic update;
  users download from the official GitHub Release and verify SHA-256.

### Cleanup and dependencies

- Removed dead pet roaming/free-mode locomotion and its 45ms timer.
- Electron 43.8.8 and electron-updater 6.8.12.

## Update channel (v0.5.2): unsigned-manual

This release keeps the unsigned-manual profile under a new version-scoped
exception. Windows and Linux publish installers and `SHA256SUMS-*.txt` only; no
`latest*.yml` or `.sig` files are published, and there is no automatic update on
Windows or Linux. macOS arm64 is ad-hoc signed and updates by manual download
from the official GitHub Release.

## Validation boundary

The release commit must pass `verify:release`, the Live2D smoke, packaged smoke,
the sustained runtime gate, and `prerelease-check -- v0.5.2`. Cross-platform CI
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

- Headline scope: main-process privacy enforcement and redaction, reminder and
  window reliability, plain-language errors and approvals, and dead-code
  cleanup.
- Out of scope: signed or notarized installers and automatic updates on Windows
  and Linux.
- No telemetry.

## Known issues

- No cross-platform physical-device evidence is claimed.
- The macOS and Windows builds remain unsigned, so the first launch can show a
  system trust prompt.
- Removing the dead pet roaming timer is not a measured performance claim; it
  only removes unused code.
- Typing-awareness and macOS Accessibility behavior are covered by tests, not
  re-validated on physical devices in this release.
