# Milestone 6 Slice 7 — Release Spotlight Actions

## Problem

v0.3.5 now has a clear in-app story: visible memory and readable desktop
companion states. The About / Help spotlight explains that story, but it still
leaves users to hunt through Settings to inspect memory controls or the
Companion Profile state preview.

For a companion app, the release note should lead directly to the companion
surface it describes. This should stay local UI navigation, not automation.

## Technical Design

- Add typed release spotlight actions to `features/releaseNotes`:
  - `review_memory` opens the existing Memory settings section,
  - `preview_companion` opens the existing Chat / Companion Profile section.
- Pass the existing `SettingsDrawer.handleOpenSettingsSection` callback through
  `ConsoleSection` into `AboutPanel`.
- Render compact in-app buttons under the spotlight list.
- Add localized action labels for zh-CN, zh-TW, en-US, ja, and ko.
- Extend the focused release spotlight test to assert action order, target
  sections, and translation registration.

No dependencies, IPC channels, storage writes, migrations, permissions, network
calls, model requests, or automation tools are introduced.

## Impact

- Users who read the v0.3.5 spotlight can immediately inspect the two memorable
  upgrades: memory controls and desktop state preview.
- The release story becomes actionable without adding a task-agent workflow.
- QA can verify the action contract without rendering the full settings drawer.

## Risks

- Buttons could crowd the About / Help panel.
- Opening Chat settings could be mistaken for starting a chat task.
- If section IDs change, stale spotlight actions could point to the wrong
  section.

## Mitigations

- Keep only two short actions.
- Labels describe inspection and preview, not task execution.
- Target section IDs are typed and covered by focused tests.

## Rollback

Remove the spotlight actions from `releaseSpotlight.ts`, remove the
`AboutPanel` buttons and callback plumbing, remove the action locale keys and
test assertions. No data rollback is needed.

## Acceptance

- About / Help shows two in-app actions under the v0.3.5 spotlight.
- The memory action opens the existing Memory settings section.
- The companion action opens the existing Chat / Companion Profile section.
- Focused spotlight tests, i18n audit, build, lint, full tests, and pet visual
  smoke pass.
