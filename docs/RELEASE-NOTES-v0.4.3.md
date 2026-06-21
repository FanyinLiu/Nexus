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
- Kept storage lifetime visible as a short-lived session summary that is purged
  when awareness is paused or disabled.
- Preserved a hard `rawContentVisible: false` invariant for the transparency
  contract.
- Added a lightweight invariant check so status labels, row ordering, clear
  action state, coarse time language, and raw-content boundaries cannot drift
  silently.

Paused awareness blocks model reach, but clearing an already-existing recent
local summary remains available because it deletes local companion data.

## Privacy Boundary

The transparency view model must not carry raw window titles, screenshots,
clipboard bodies, message bodies, file paths, exact minute/second durations, or
desktop activity timelines.

## Not Included

- No formal v0.4.3 release yet.
- No package version bump.
- No tag or GitHub Release.
- No README stable-entry switch.
- No external notifications, message sending, tool execution, productivity
  score, raw timeline, new sensing source, pet movement, or desktop window
  control.
