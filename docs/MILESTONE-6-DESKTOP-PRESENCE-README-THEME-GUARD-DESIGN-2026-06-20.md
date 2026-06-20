# Milestone 6 Slice 10 — README Release Theme Guard

## Problem

The v0.3.5 release theme was updated to "visible memory plus readable companion
presence", but the root README still led with the older memory-only wording.
That creates a user-facing mismatch: GitHub visitors could miss the desktop
companion presence upgrade even though the release notes, in-app spotlight, and
Settings home already describe it.

## Technical Design

- Update the root README v0.3.5 block to name both headline upgrades:
  - visible memory provenance and controls,
  - readable desktop companion states.
- Extend the release spotlight test so the root README and both v0.3.5 release
  notes keep the same theme.
- Keep this as a documentation and test guard only.

No dependencies, IPC channels, storage writes, migrations, permissions, network
calls, model requests, or automation tools are introduced.

## Impact

- Users landing on the repository can understand the 0.3.5 upgrade without
  opening deeper docs.
- Release QA now has a focused test that catches future drift between README
  copy and release notes.
- The product boundary stays explicit: this is companionship and memory
  transparency, not a Codex-style work-agent expansion.

## Risks

- Text assertions can become too brittle if release wording changes.
- Root README copy can grow too long and bury the short release message.

## Mitigations

- The test checks only the core theme, companion state list, and boundary
  sentence rather than every line of prose.
- The README keeps the upgrade summary as a short block plus bullets.

## Rollback

Revert the README copy update and remove the documentation alignment test. No
runtime or data rollback is needed.

## Acceptance

- The root README v0.3.5 block names both visible memory and readable companion
  presence.
- The release spotlight test verifies README, English release notes, and
  Chinese release notes stay aligned.
- Focused release spotlight tests, i18n audit, build, lint, full tests, and pet
  visual smoke pass.
