# Milestone 6 Slice 11 — Changelog Release Cutover

## Problem

The v0.3.5 desktop-presence and release-spotlight work was already described in
release notes, README copy, and the in-app spotlight, but the top of
`CHANGELOG.md` still listed those same v0.3.5 items under `Unreleased`. That
made the release state ambiguous for readers preparing a GitHub release: the
version looked both shipped and not yet shipped.

## Technical Design

- Move the v0.3.5 presence, spotlight, and release-theme guard entries from
  `Unreleased` into the existing `[0.3.5]` section.
- Leave `Unreleased` as an explicit empty bucket.
- Extend the release spotlight test so future v0.3.5 copy does not drift back
  into `Unreleased`.

No dependencies, IPC channels, storage writes, migrations, permissions, network
calls, model requests, or automation tools are introduced.

## Impact

- Release readers see one clear current target: `[0.3.5]`.
- GitHub release preparation can reuse the changelog without deciding whether
  v0.3.5 items belong to a future release.
- The product theme stays focused on visible memory and readable companion
  presence.

## Risks

- If later work lands before the v0.3.5 tag, it must be placed deliberately
  either under `Unreleased` or under a new target version.
- Tests that inspect changelog sections can be brittle if the file structure is
  changed substantially.

## Mitigations

- The test checks only the v0.3.5 release boundary and a few headline entries,
  not the whole changelog body.
- `Unreleased` remains present, so future work still has an obvious destination.

## Rollback

Move the entries back to `Unreleased` and remove the changelog boundary
assertions. No runtime or data rollback is needed.

## Acceptance

- `CHANGELOG.md` has an explicit empty `Unreleased` section.
- The v0.3.5 desktop presence, spotlight, and README theme guard entries live
  under `[0.3.5]`.
- Focused release spotlight tests, i18n audit, build, lint, full tests, and
  release/package smoke gates pass.
