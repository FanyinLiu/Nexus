# Nexus v0.4.2 Release Candidate Handoff

Release state: `final_candidate`
Evidence baseline head: `d99ba0b6`

v0.4.2 promotes the Check-In Policy slice from the v0.4 draft stack into the
current stable entry point. It keeps the desktop companion awareness line local,
coarse, and conservative: decide locally first, suppress repeats before any
payload is built, and never turn the companion into a Codex-style work agent.

## Scope

- Gentle check-ins are local in-app decisions before emission.
- Active chat, recent dismissals, stale return-to-Nexus windows, and duplicate
  same-signal activity keep the companion silent.
- In-app payloads stay passive short-TTL data objects.
- External notifications, message sending, tool execution, activity-history UI,
  mouse-following, typing-following, or pet window control remain out of scope.

## Release Boundary

v0.4 desktop companion awareness begins with quiet local observation and keeps
rough time language only. v0.4.2 still does not expose raw screenshots, full
clipboard content, precise timers, private messages, or unredacted desktop text
to model prompts, logs, localStorage, or support reports.

## Required Local Evidence

Before tagging v0.4.2, run:

```bash
npm run verify:pr
npm run sqlite:smoke
npm run core-path:smoke:built
npm run prerelease-check -- v0.4.2 --quick
```

The final tag and GitHub Release should only be created after the working tree
is clean and Klein explicitly asks to publish.
