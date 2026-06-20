# Milestone 6 Slice 5 — Desktop Presence State Preview

## Problem

M6 already added the companion activity state contract and visual motion
tokens, but most of that behavior is visible only when Nexus happens to be
idle, thinking, listening, speaking, waiting, errored, or offline at runtime.
That makes the upgrade harder for users and release QA to remember.

Nexus needs a small in-app way to see the desktop companion states without
turning the product into a task runner or adding heavy always-on rendering.

## Technical Design

- Add a pure preview helper to `features/pet/activityState.ts`:
  - ordered `COMPANION_ACTIVITY_PHASES`,
  - `resolveCompanionActivityPreviewState(phase)` that produces the same
    `CompanionActivityState` objects used by the pet window.
- Add a compact `CompanionStatePreview` under Chat / Companion Profile:
  - buttons for idle, thinking, listening, speaking, waiting, error, offline,
  - localized state labels via the existing status keys,
  - localized motion labels for breathe, think, listen, speak, wait, error,
    and offline,
  - Sprite avatars reuse `SpritePetCanvas` and preview the mapped runtime
    sprite state,
  - Live2D avatars do not load a second renderer in settings; they show the
    same state/motion contract that the desktop pet window uses.
- Add focused tests that ensure the preview covers every companion activity
  phase and uses the same sprite/motion mapping as runtime.

No dependencies, IPC channels, storage writes, migrations, permissions, or
secret-handling changes are introduced.

## Impact

- Users can see the memorable desktop presence states from settings.
- Release QA can verify the state contract without forcing voice/chat/network
  activity.
- Sprite companions get a lightweight visual preview; Live2D remains lazy and
  budgeted in the desktop pet window.

## Risks

- The preview could drift away from runtime behavior if it duplicates mapping.
- Extra controls in Chat settings could crowd the companion profile section.
- Loading Live2D inside settings would add resource pressure.

## Mitigations

- The preview helper reuses `resolveCompanionActivityState` instead of
  duplicating status, motion, or sprite mapping.
- The UI stays compact and uses existing settings card patterns.
- Live2D preview is intentionally contract-only in settings.

## Rollback

Remove the preview helper, `CompanionStatePreview`, its locale keys/styles, and
the focused test additions. No data rollback is needed.

## Acceptance

- Chat / Companion Profile shows the desktop state preview.
- Selecting each state updates the active label and motion line.
- Sprite avatars visually switch to the runtime sprite state mapped from the
  selected companion state.
- Focused pet activity tests cover all preview phases.
- Existing build, lint, i18n, full tests, and pet visual smoke continue to pass.
