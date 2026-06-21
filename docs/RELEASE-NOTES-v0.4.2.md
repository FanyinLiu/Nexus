# Nexus v0.4.2 — Check-In Policy

Status: Draft. Do not publish until Klein explicitly asks for the final release
gate, tag, and GitHub Release.

This follow-up release keeps the v0.4 desktop companion awareness line local and
conservative. It hardens when a gentle in-app check-in may be considered; it
does not send messages, trigger tools, create external notifications, or publish
a new release.

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
- stale return-to-Nexus signals expire
- the same activity signal cannot repeat inside the emission window
- recently dismissed signals stay suppressed
- local in-app payloads are dismissible and short-lived

### In-app payloads stay passive

`buildCompanionCheckInInAppPayload` produces a local, expiring data object only.
It does not schedule timers, write storage, send notifications, or call tools.

## Still out of scope

This release does not include:

- No formal v0.4.2 release yet.
- No package version bump.
- No tag or GitHub Release.
- No README stable-entry switch.
- external notifications
- message sending
- tool execution
- persistent check-in history
- cross-session check-in carryover
- new desktop sensing sources
- activity-history UI
- mouse-following, typing-following, or pet window control

Those remain later v0.4.x or v0.5 work.

## Validation focus

Release validation should cover:

- active chat priority
- quiet hours and cooldowns
- focus suppression
- stale return-to-Nexus windows
- duplicate same-signal suppression
- dismiss suppression
- signal-key stability
- passive in-app payload shape
- five-locale gentle copy without surveillance or exact timer wording

Recommended focused checks:

```bash
node --experimental-strip-types --test tests/companion-check-in-policy.test.ts
npx tsc -b --pretty false
```
