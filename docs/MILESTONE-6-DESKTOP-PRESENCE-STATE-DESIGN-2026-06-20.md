# Milestone 6 Slice 1 — Desktop Presence State Contract

## Problem

The pet window already has Live2D, sprite animation, voice controls, ambient
presence, and chat busy indicators, but those signals are still interpreted in
several places. A companion can therefore look idle while the voice stack is
listening, look merely "busy" while waiting for a user decision, or fall back to
generic status copy after an error.

For Nexus v1.0 this is a product problem, not just a UI cleanup: a desktop
companion should visibly reflect what it is doing without becoming a task-agent
dashboard.

## Technical Design

- Add a pure `features/pet/activityState` resolver.
- Resolve one ordered phase:
  `offline -> error -> waiting -> speaking -> listening -> thinking -> idle`.
- Keep the state content-minimized. The state includes phase, mood, optional
  task label, reason, updated timestamp, render booleans, status translation key,
  and an optional sprite fallback state. It does not include chat content,
  memory content, secrets, model output, or tool payloads.
- Bind PetView status dot, accessible status label, Sprite pet state, and Live2D
  listening/speaking inputs to the same resolved state.
- Keep full Live2D rendering lazy and unchanged. This slice only feeds the
  existing renderer with a normalized state.

## Impact

- `PetView` stops recomputing visible activity from separate voice/chat flags.
- Sprite avatars can show waiting/error/offline fallback rows using existing
  atlas states.
- Live2D keeps the same expression pipeline, but its listening/speaking flags
  now come from the shared companion activity state.
- The status indicator gains explicit error/offline classes.

## Risks

- A future caller may map too many internal task concepts into the visible
  state and make the companion feel like an operations panel.
- Runtime snapshot online/error fields are still partial; this slice prepares
  the contract but does not claim every subsystem is already bound.
- Sprite fallback rows reuse existing art, so offline/waiting can look similar
  until richer art ships.

## Rollback

Remove `activityState.ts`, revert the PetView bindings to direct voice/chat
flags, and remove the added status labels/classes. No data migration or storage
rollback is required.

## Acceptance

- Unit tests cover phase priority and render flags.
- `PetView` has one shared source for visible companion activity.
- No new dependency is introduced.
- Existing Live2D and sprite render paths remain lazy.
