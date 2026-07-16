# Nexus v0.4.2 — Check-In Policy

Status: Release candidate. This local code candidate is not a public release;
it has no tag or GitHub Release.
No tag or GitHub Release
No README stable-entry switch
Tag and publish only after the final release gate passes and Klein explicitly
asks for the GitHub Release.

This follow-up release keeps the v0.4 desktop companion awareness line local and
conservative. It hardens when a gentle in-app check-in may be considered; it
does not send messages, trigger tools, or create external notifications.

## Maintenance update

- The main panel keeps a lightweight Live2D companion at the center, with text, voice, and the latest turn visible on one screen.
- Settings and the companion panel share a calmer compact visual system with larger hit targets for critical icon controls.
- Connection tests show when they were checked and become stale after request-relevant configuration changes instead of remaining falsely ready.
- Live2D vendor/model failures can retry cleanly, and local runtime audits can read ready and first-frame milestones.

## What changes

### Decide is separate from emit

The companion check-in policy can now return a local decision without directly
scheduling, rendering, persisting, or repeating UI. This keeps the policy safe
for polling loops: a repeated call can be suppressed before any in-app payload
is built.

### Repeated check-ins are suppressed

The policy now guards against the cases that would make a companion line feel
like nagging:

- active chat with Nexus suppresses every check-in signal
- invalid current and helper timestamps cannot trigger or suppress signals
- stale return-to-Nexus signals expire
- the same activity signal cannot repeat inside the emission window
- recently dismissed signals stay suppressed
- local in-app payloads are dismissible and short-lived with bounded integer TTLs

### In-app payloads stay passive

`buildCompanionCheckInInAppPayload` produces a local, expiring data object only.
It does not schedule timers, write storage, send notifications, or call tools.

## Still out of scope

This release does not include:

- external notifications
- message sending
- tool execution
- persistent check-in history
- cross-session check-in carryover
- new desktop sensing sources
- activity-history UI
- mouse-following, typing-following, or pet window control

Those remain later v0.4.x or v0.5 work.

## Distribution notes

v0.4.2 keeps the same unsigned desktop distribution posture as the previous
public builds:

- macOS users may see Gatekeeper quarantine warnings. Download only from GitHub
  Releases, move `Nexus.app` to `/Applications`, and use the documented
  quarantine removal command only when the file source is trusted.
- Windows users may see SmartScreen warnings because the installer is not yet
  code-signed. Download only from GitHub Releases, choose **More info**, then
  **Run anyway** if the filename and source match the release.

## Validation focus

Release validation should cover:

- active chat priority
- invalid current and helper timestamp suppression
- quiet hours and cooldowns
- focus suppression
- stale return-to-Nexus windows
- duplicate same-signal suppression
- dismiss suppression
- signal-key stability
- passive in-app payload shape and integer TTL bounds
- five-locale gentle copy without surveillance or exact timer wording

Recommended focused checks:

```bash
node --experimental-strip-types --test tests/companion-check-in-policy.test.ts
npx tsc -b --pretty false
```
