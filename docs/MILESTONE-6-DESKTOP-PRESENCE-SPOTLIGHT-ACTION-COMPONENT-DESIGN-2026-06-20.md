# Milestone 6 Slice 9 — Shared Release Spotlight Actions

## Problem

Settings home and About / Help now both expose the v0.3.5 release spotlight
actions. The first implementation duplicated the same button mapping in two
places. That is a small drift risk: one surface could later open Memory while
the other opens a different section, or one could gain wording/styling fixes
without the other.

For a stable release candidate, the two surfaces should share one action
renderer.

## Technical Design

- Add a small `ReleaseSpotlightActions` React component.
- Keep the source of truth in `CURRENT_RELEASE_SPOTLIGHT.actions`.
- Let the caller provide only:
  - the translated text function,
  - the local settings-section opener,
  - surface-specific wrapper/icon class names.
- Reuse the component from both Settings home and About / Help.

No dependencies, IPC channels, storage writes, migrations, permissions, network
calls, model requests, or automation tools are introduced.

## Impact

- Settings home and About / Help keep identical action behavior.
- Future release spotlight action edits happen in one place.
- The user-visible behavior remains unchanged from Slice 8.

## Risks

- A shared component could accidentally leak styling assumptions between the
  two surfaces.
- Making the action callback required would remove the existing safe fallback in
  isolated About / Help render contexts.

## Mitigations

- Surface-specific class names stay caller-provided.
- The component returns `null` when no callback is available, matching the
  current optional About / Help behavior.

## Rollback

Inline the action button rendering back into Settings home and About / Help,
then remove `ReleaseSpotlightActions`. No data rollback is needed.

## Acceptance

- Settings home and About / Help both render release spotlight actions through
  the shared component.
- The action targets remain Memory and Companion Profile.
- Focused release spotlight tests, i18n audit, build, lint, full tests, and pet
  visual smoke pass.
