# Nexus v0.4.3 — User-Facing Transparency

Status: Draft. Do not publish until Klein explicitly asks for the final release
gate, tag, and GitHub Release.

v0.4.3 keeps building the desktop companion awareness line after the stable
v0.4.0 foundation, the v0.4.1 coarse-time-language draft, and the v0.4.2
check-in-policy draft. This slice is about making the Settings transparency
surface easier to trust without adding new sensing, new prompts, or a new
release entry point.

## What Changed

- Added a deterministic companion-awareness transparency view model for the
  Settings block.
- Split the transparency explanation into labeled rows for what Nexus can
  observe, what reaches the model, and what is stored locally.
- Exposed explicit local reasons for blocked model reach and unavailable
  clear-summary actions.
- Added a local check-in rationale model so Settings can explain whether Nexus
  is staying quiet or allowed to appear gently without exposing raw signal keys.
- Added visible Settings rows for the recent coarse companion summary and the
  privacy boundary, so users can see what exists locally without seeing raw
  desktop content.
- Wired the chat desktop-context path to record the most recent local check-in
  decision, so active chat turns explain why proactive companionship stays
  quiet.
- Kept storage lifetime visible as short-lived session companion state: the
  recent summary plus a safe recent check-in decision are purged when awareness
  is paused or disabled.
- Preserved a hard `rawContentVisible: false` invariant for the transparency
  contract.
- Added a lightweight invariant check so status labels, row ordering, clear
  action state, check-in rationale, coarse time language, and raw-content
  boundaries cannot drift silently.

Paused awareness blocks model reach, but clearing an already-existing recent
local summary remains available because it deletes local companion data.

## Privacy Boundary

The transparency view model must not carry raw window titles, screenshots,
clipboard bodies, message bodies, file paths, exact minute/second durations, or
desktop activity timelines.

The check-in transparency model exposes only coarse reason groups such as active
chat, quiet hours, focus protection, cooldown, duplicate suppression, or
eligible gentle appearance. It does not carry raw window titles or raw signal
keys.

The recent check-in decision stored for Settings is ephemeral and contains only
`reason`, `surface`, `priority`, and a boolean `signalKeyPresent`; it does not
persist the raw signal key.

The recent summary row shows only a coarse elapsed label and a broad activity
label. The privacy boundary row is static copy that keeps screenshots,
clipboard bodies, exact timers, file paths, and message bodies out of the UI
contract.

The current runtime writer is passive: it records the decision used for
Settings transparency, but it does not emit a proactive line, notification, or
message.

## Not Included

- No formal v0.4.3 release yet.
- No package version bump.
- No tag or GitHub Release.
- No README stable-entry switch.
- No external notifications, message sending, tool execution, productivity
  score, raw timeline, new sensing source, pet movement, or desktop window
  control.
