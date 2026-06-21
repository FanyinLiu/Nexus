# Nexus v0.4 Release Hardening Handoff

## Status

- Scope: v0.4 desktop companion awareness release line.
- State: hardening checklist for the first v0.4 beta and later stable handoff.
- Product theme: Nexus can stay quietly present after the user opens it, notice
  coarse time passing, and speak with low-frequency companion care without
  becoming a screen recorder, stopwatch, or autonomous work agent.
- Evidence baseline head: `517b822` plus local working-tree v0.4 changes.

This handoff does not replace [Releasing Nexus](RELEASING.md). It adds the
v0.4-specific proof that desktop companion awareness still respects the v0.3
privacy posture before a beta or stable tag is created.

## Release Boundary

v0.4 includes:

- quiet observation when Nexus is open but unused
- rough time buckets instead of exact elapsed timers
- a check-in policy that respects pause, cooldowns, focus, and quiet hours
- Settings transparency for what is observed, stored, and sent to the model
- a clear community feedback path for timing, tone, permission friction, and
  false positives

v0.4 does not include:

- mouse following or animated desktop pet reactions
- automatic mouse or keyboard control
- raw screen recording history
- precise productivity analytics
- reading files, private messages, or clipboard contents without explicit user
  action
- sending messages, opening apps, editing files, or changing settings without
  confirmation

## Required Evidence Before Tagging

Run these checks from a clean release branch before creating a v0.4 beta or
stable tag:

```bash
npm run verify:release
npm run package:dir:smoke
npm run desktop-context-privacy:audit
npm run message-privacy:audit
npm run error-redaction:audit
npm run ipc:audit
npm run distribution:audit
```

For a final tag, also run the normal pre-release gate:

```bash
npm run prerelease-check -- v0.4.0-beta.1
```

Use the actual tag being prepared. The beta suffix may change, and the stable
tag must not include `-beta.N`.

## Evidence Collected

- `npm run verify:release` — passed locally. This includes forced typecheck,
  lint, 2037 tests, production build, storage/heavy/architecture/source-size/
  performance/companion-boundary/message-privacy/desktop-context-privacy/vault/
  error-redaction/IPC/distribution audits, and SQLite smoke.
- `npm run package:dir:smoke` — passed locally. The unpacked macOS arm64 app
  launched, loaded the renderer, and exited cleanly.
- `npm run prerelease-check -- v0.4.0-beta.1 --skip=A --quick` — passed with
  16 blocker checks, 0 warnings, and 0 failures. Stage A remains final-branch
  only because it requires the actual package version, clean working tree,
  local/remote tag absence, `HEAD === origin/main`, and CI success.
- `npm run prerelease-check -- v0.4.0-beta.1 --skip=A` — passed with 20
  blocker checks, 0 warnings, and 0 failures. This includes `verify:release`,
  Electron smoke, packaged smoke, coverage at 90.37%, bundle budget,
  benchmarks, security, asset integrity, docs/compliance, and privacy/
  governance checks.
- `npm run prerelease-check -- v0.4.0-beta.1 --only=A` — expected local
  blocker state. Tag format, local tag absence, remote tag absence, and CI check
  passed. Remaining blockers before tagging are:
  - commit or otherwise clean the working tree
  - land the release head so `HEAD === origin/main`

Expected local smoke warnings remain:

- macOS local package uses ad-hoc signing and skips notarization.
- Optional KWS/SenseVoice models may be missing in local developer smoke.
- Electron/Node deprecation warnings can appear during local packaging or
  launch.

## v0.4 Privacy Assertions

The release is not ready if any assertion below is unproven:

- Model-facing desktop companion context uses sanitized summaries only.
- Time wording is coarse: just started, a while, about half an hour, about an
  hour, or two hours or more.
- Prompt text, UI text, logs, localStorage, support reports, and release
  reports do not include raw screenshots, OCR dumps, full clipboard contents,
  private message bodies, private file paths, or exact second-level timers.
- The recent companion summary stores only short-lived coarse fields.
- Pausing desktop companion awareness removes the prompt summary path.
- Pausing or disabling desktop companion awareness clears the recent local
  companion summary instead of leaving stale status in Settings.
- Clearing the recent companion summary removes the local coarse summary.
- Check-ins are rate-limited, dismissible, and suppressed during focus or quiet
  hours.
- Active chat with Nexus takes priority over proactive companionship.

## Manual Visual Checks

Before a v0.4 beta is tagged, check the app in day, warm-day, and night themes:

- Settings -> Memory shows the companion awareness pause control.
- Settings -> Memory explains what Nexus observes, stores, and sends to the
  model without showing raw desktop content.
- The clear recent summary control is visible and does not enlarge unrelated
  buttons.
- Text remains readable in the current panel size.
- Returning to Nexus after being away can show continuity copy without exact
  minute or second language.

## Community Feedback Gate

Keep the GitHub **Beta Validation Report** template active for v0.4 reports.
Maintainers should look for:

- check-ins that feel too early, too late, too frequent, cold, or monitoring-like
- time wording that feels unnatural in zh-CN, zh-TW, en-US, ja, or ko
- OS permission friction around screen, accessibility, notification, or window
  access
- false positives that can be reproduced with safe test fixtures
- any sign that raw desktop content reached screenshots, logs, prompts, or
  issue reports

Feedback that reports raw private content should be redacted before triage.

## Rollback

If v0.4 desktop companion awareness regresses before tagging:

- Disable the awareness summary path while keeping normal chat usable.
- Keep memory settings and existing v0.3 transparency controls intact.
- Preserve the pause setting so users do not lose their preference.
- Remove or suppress proactive check-in copy before removing the underlying
  privacy guards.
- Do not ship v0.5 desktop pet behavior as a workaround for v0.4 sensing
  issues.

If a beta is already published and a privacy issue is found, do not replace the
tag. Publish a higher beta tag after fixing the issue and call out the privacy
boundary in the release notes.

## Hand-Off To v0.5

v0.5 can start only after the v0.4 line proves that:

- companion awareness stays quiet by default
- users can pause and clear it
- the model receives only sanitized coarse summaries
- community feedback does not show unresolved monitoring-like copy or hidden raw
  desktop content

The next line is desktop pet behavior: mouse, typing, idle, and desktop-state
reactions that remain non-blocking and accessible.
