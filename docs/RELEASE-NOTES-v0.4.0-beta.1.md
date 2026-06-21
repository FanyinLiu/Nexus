# Nexus v0.4.0-beta.1 — Desktop companion awareness begins.

> **Beta.** This is the first v0.4 desktop companion awareness beta. It starts
> the quiet loop that lets Nexus understand that time passes after the user
> opens Nexus and then works elsewhere. It is for validation before a stable
> v0.4 release.

## What changes for users

### Nexus can stay quietly aware while open

When desktop context awareness is enabled and Nexus is open but not being used
directly, Nexus can form a short-lived companion summary:

- whether the user has not interacted with Nexus recently
- a broad activity class such as coding, reading, browsing, idle, or switching
- a rough elapsed-time bucket such as "a while" or "about half an hour"
- whether Nexus should stay quiet because the user appears focused

The point is companionship continuity, not surveillance or productivity
scoring.

### Time language is deliberately rough

v0.4 starts with companion-like time wording:

- just started
- a while
- about half an hour
- about an hour
- two hours or more

Nexus should not speak like a stopwatch. Exact minute and second durations stay
out of companion copy.

### Check-ins are policy-gated

The first check-in policy is intentionally conservative. It can reason about:

- long continuous activity
- frequent switching
- long idle after activity
- returning to Nexus after being away

It also respects pause, cooldowns, focus, and quiet hours. The beta should help
validate whether the timing feels caring, too early, too late, or too frequent.

### Settings explains the privacy boundary

Memory settings now includes desktop companion awareness transparency:

- what Nexus can observe
- what it stores
- what reaches the model
- how to pause awareness
- how to clear the recent companion summary

The visible summary stays coarse and does not show raw desktop content.
Pausing companion awareness or turning desktop context awareness off clears the
recent local companion summary so old awareness state does not linger in
Settings.

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
- exact second-level timers
- hidden activity logs

## What stays out of this beta

- No v0.5 desktop pet mouse-following or typing reactions yet.
- No automatic mouse or keyboard control.
- No file reading or message sending without explicit user action.
- No productivity dashboard or raw activity timeline.
- No new autonomous work-agent behavior.

## Beta validation focus

Please use the GitHub **Beta Validation Report** template and include:

- whether Nexus was open but unused
- whether you were actively chatting with Nexus
- what broad desktop activity was happening
- whether the time wording felt natural
- whether any check-in felt caring, cold, nagging, or monitoring-like
- whether pause and clear controls were easy to find
- whether OS permissions were confusing

Do not attach raw screenshots, clipboard contents, private window titles,
private message text, or private file paths unless they are safe test fixtures.

## Known issues

- The beta still needs real-world validation across macOS, Windows, and Linux
  permission flows.
- Copy may need tuning per locale after beta feedback.
- v0.5 desktop pet behavior is intentionally deferred until this awareness loop
  is stable and trusted.
