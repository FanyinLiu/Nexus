# Nexus v0.4.0 — Desktop companion awareness foundation

> **Stable.** This release starts the v0.4 desktop companion awareness line with
> a quiet observation foundation. It keeps the companion continuity path
> privacy-bounded and deliberately does not expand into proactive check-ins or
> v0.5 desktop pet behavior.

## What changes for users

### Nexus can keep quiet companionship continuity

When desktop context awareness is enabled, Nexus is open, and the user is
active elsewhere instead of directly chatting with Nexus, Nexus can keep a
short-lived companion awareness summary.

That summary is deliberately small:

- a broad activity class
- a rough elapsed-time bucket
- whether the user appears focused
- whether Nexus should stay silent

The purpose is companionship continuity. Nexus should not behave like a
stopwatch, productivity monitor, screen recorder, or autonomous work agent.

### The summary is session-bound

The recent companion summary is scoped to the current app session and renderer
lifecycle. Nexus drops the stored summary if it belongs to another session,
was written by a previous renderer lifecycle, predates the current session, is
older than the hard 24-hour safety cap, appears to come from the future, or
fails schema validation.

This prevents a previous desktop activity stretch from being replayed later as
current context.

### Settings keeps the privacy boundary visible

Memory settings explains:

- what desktop companion awareness can observe
- what is stored locally
- what reaches the model
- how to pause companion awareness
- how to clear the recent companion summary

Pausing companion awareness, disabling context awareness, or clearing the recent
summary removes the local recent summary.

## Privacy boundary

Allowed:

- sanitized companion summaries
- broad activity classes
- rough time buckets
- short-lived recent summary metadata

Not allowed:

- raw screenshots
- full OCR dumps
- full clipboard contents
- private message bodies
- private file paths
- exact timers or timestamp trails
- hidden activity logs
- productivity scoring

## Out of scope

This stable release does not include:

- proactive check-in expansion
- new desktop sensing sources
- mouse-following, typing-following, or desktop pet window control
- productivity dashboards or raw activity timelines
- automatic mouse or keyboard control
- file reading, app opening, message sending, or settings changes without
  explicit user action

## Distribution notes

Until Nexus has signed installers and notarized macOS distribution, local
manual installs may still show platform trust prompts:

- macOS may show Gatekeeper or quarantine warnings. If you intentionally
  downloaded the app from the official GitHub Release, remove quarantine only
  for that downloaded app bundle.
- Windows may show SmartScreen warnings because the installer is not yet backed
  by broad code-signing reputation.

Do not download installers from mirrors or reposted archives.

## Validation focus

This stable release is prepared against:

- `npm run verify:release`
- `npm run package:dir:smoke`
- `npm run desktop-context-privacy:audit`
- `npm run message-privacy:audit`
- `npm run error-redaction:audit`
- `npm run ipc:audit`
- `npm run distribution:audit`
- `npm run prerelease-check -- v0.4.0`

The stable handoff is
[Nexus v0.4.0 Stable Release Checklist](RELEASE-CANDIDATE-v0.4.0-STABLE.md).
