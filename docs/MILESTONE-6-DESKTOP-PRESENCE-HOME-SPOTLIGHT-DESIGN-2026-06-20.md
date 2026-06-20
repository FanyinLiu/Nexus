# Milestone 6 Slice 8 — Settings Home Release Spotlight

## Problem

The v0.3.5 release spotlight explains the memorable upgrade and now includes
local actions, but it still lives inside Console -> About / Recap. Users can
miss it because the Settings home shows only section rows unless they know to
open the Console detail group.

For v0.3.5 to be remembered, the theme should be visible at the Settings entry
point: visible memory plus readable desktop companion states.

## Technical Design

- Reuse `CURRENT_RELEASE_SPOTLIGHT` as the single release-theme source.
- Render a compact Settings home spotlight above the normal section rows.
- Show the release eyebrow, title, short summary, and the same local actions:
  - Review Memory -> existing Memory settings section,
  - Preview Companion -> existing Chat / Companion Profile section.
- Keep the existing About / Help spotlight as the detailed version.
- Add focused tests that keep the shared spotlight contract actionable.

No dependencies, IPC channels, storage writes, migrations, permissions, network
calls, model requests, or automation tools are introduced.

## Impact

- Users see the v0.3.5 theme immediately when opening Settings.
- The two memorable upgrades are one click away from the first settings screen.
- The release message remains consistent because Settings home and About / Help
  use the same spotlight contract.

## Risks

- The Settings home could feel like a marketing surface.
- The extra block could crowd small windows.
- Duplicating copy would let About / Help and Settings home drift apart.

## Mitigations

- The card stays compact, uses existing settings styles, and contains only two
  local actions.
- The summary is clamped on small screens and buttons wrap.
- Copy comes from `CURRENT_RELEASE_SPOTLIGHT`; no duplicate release strings are
  introduced.

## Rollback

Remove the Settings home spotlight markup/styles and this design note. The
existing About / Help spotlight and release action contract can remain. No data
rollback is needed.

## Acceptance

- Settings home shows the v0.3.5 release theme before the normal section rows.
- The home spotlight can open Memory and Companion Profile via existing local
  settings navigation.
- Focused release spotlight tests, i18n audit, build, lint, full tests, and pet
  visual smoke pass.
