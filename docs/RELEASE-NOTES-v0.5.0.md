# Nexus v0.5.0

**Status: Stable unsigned release.** The owner recorded a version-scoped
maintainer exception in `docs/RELEASING.md` to promote this exact tree after the
automated gate, waiving the standard beta flow and multi-day validation window.
No multi-day conversation evidence or cross-platform physical-device validation
is claimed. Official binaries must still be rebuilt from the release commit by
the protected tag workflow.

v0.5.0 is about one thing: she lives on your computer, not only inside a window
you open when you want to talk.

She watches the moment. If you are fullscreen, in Do Not Disturb, on the lock
screen, or typing, she stays quiet and remembers; when you are free, she speaks.

## What changed

- She writes it down first. When she has something to say and cannot interrupt,
  it goes into her notebook, and she may softly say she noted something — no
  more red-dot counts.
- Notebook. When there is unread, click her to open the notebook next to her.
  The last 15 days stay there. Expand a row, then mark done, snooze, or open
  the chat. Click outside or press Esc to close.
- Reminders show only the key point. Notifications keep the short line, not the
  full paragraph.
- Reminder strip. A reminder can appear as a small strip beside the pet without
  stealing keyboard focus, then tuck itself away. Turn “Reminder strip” off in
  Settings if you prefer the ordinary bubble path.
- When the mouse comes near, she glances once, then waits before glancing again.
- Quiet while typing. Off by default; turn on “Typing awareness” under
  Settings → Window. When on, she only knows that you are typing — never which
  keys.
- On return, she can tell you how many items piled up while you were away.
- “Diary” is now “Daily log” — the page she keeps for each day.
- Letters to the future. When one arrives she says a short lead-in, then shows
  your original text unchanged. Speech and notifications keep only that lead-in
  so nearby people or a lock screen do not see the letter body.

## Privacy

Typing awareness is off by default and never records key content. The microphone
stays off until you tap it. Notifications and stored records keep the key point,
not the full text.

## Validation boundary

The release commit must pass `verify:release`, the Live2D smoke, packaged smoke,
the sustained runtime gate, and `prerelease-check -- v0.5.0`. Cross-platform CI
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

- Headline scope: proactive delivery (notebook), reminder key points, reminder
  strip, mouse-near glance, quiet-while-typing, away summary count, and daily
  log copy.
- Out of scope: voiceprint wake (0.6), camera (0.7), signed/notarized installers.
- No telemetry.

## Known issues

- No cross-platform physical-device evidence is claimed.
- The macOS and Windows builds remain unsigned, so the first launch can show a
  system trust prompt.
- Repository Actions secrets must include `NEXUS_UPDATE_SIGNING_KEY`, or the
  Windows/Linux update-manifest signing step fails and the release workflow
  cannot publish.
