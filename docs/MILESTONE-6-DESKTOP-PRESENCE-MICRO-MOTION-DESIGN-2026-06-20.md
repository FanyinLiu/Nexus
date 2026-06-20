# Milestone 6 Slice 2 — Desktop Presence Micro-Motion

## Problem

Slice 1 gave the pet window one source of truth for what Nexus is doing, but a
status contract alone is still easy to miss. The companion needs small, visible
body-language changes so users can remember the upgrade without Nexus becoming
a task dashboard.

This slice keeps the product direction companion-first: movement should say
"I'm here / I'm listening / I'm thinking", not "I am running an autonomous
agent plan".

## Technical Design

- Extend the pure companion activity state with a `motionToken`.
- Map phases to a small visual vocabulary:
  `breathe`, `think`, `listen`, `speak`, `wait`, `error`, `offline`.
- Write the phase and motion token onto the pet stage as data attributes.
- Drive both Live2D and Sprite shells through the same CSS-only micro-motion
  layer:
  - idle: slow breathing lift,
  - thinking: subtle ponder bob,
  - listening: attentive lift,
  - speaking: soft speech bounce,
  - waiting: restrained attention pulse,
  - offline: dimmed presence.
- Animate only `transform` and opacity. No new timers, workers, model loads,
  renderer IPC, media processing, or dependencies are added.
- Respect `prefers-reduced-motion`.

## Impact

- The visible pet now changes posture for the states introduced in Slice 1.
- Live2D, Sprite, and future VTS-style renderers can share the same motion
  token instead of each inventing a separate state map.
- Existing Sprite frame animation and Live2D expression/lip-sync paths remain
  unchanged; the motion layer wraps them.

## Risks

- Too much motion can feel distracting in a desktop companion.
- Outer-shell transforms can visually stack with model-specific animation.
- Offline/error states should not create false alarm during startup.

Mitigations:

- Motions are small, slow, and mostly transform-only.
- Reduced-motion users get no looping micro-motion.
- The pet window still binds `offline` conservatively; this slice prepares the
  visual language without making startup appear broken.

## Rollback

Remove the motion token from `activityState.ts`, remove the data attributes in
`PetView`, and delete the `pet-presence-*` CSS block. No data migration,
storage rollback, or renderer contract rollback is required.

## Acceptance

- Unit tests cover motion-token mapping for every activity category.
- `PetView` exposes the current motion token without exposing chat, memory, or
  secret data.
- The implementation adds no dependency and no persistent background work.
- `prefers-reduced-motion` disables looping presence motion.
