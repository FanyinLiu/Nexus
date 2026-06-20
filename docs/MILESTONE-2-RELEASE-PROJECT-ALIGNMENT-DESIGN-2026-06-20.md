# Milestone 2 Slice — Release Project Alignment Calibration

## Problem

v0.3.5 has accumulated several release-candidate refinements: visible memory,
desktop companion state, release spotlight actions, packaged smoke docs,
architecture alignment, and handoff evidence. Those pieces need to stay aligned
as one project state, otherwise the release can look ready while a doc, test, or
entry-point map still points at stale assumptions.

## Technical Design

- Correct `docs/ARCHITECTURE.md` so its public-entry-point section lists only
  aggregate barrels that actually exist today.
- Keep feature entry-point examples limited to real
  `src/features/<feature>/index.ts` files.
- Refresh `docs/RELEASE-CANDIDATE-v0.3.5-HANDOFF.md` past the stale
  `48e6b78` baseline and record the current verified test counts.
- Add a focused project-alignment test that checks:
  - `package.json` version matches the in-app release spotlight version.
  - v0.3.5 release notes, changelog, README, and handoff stay on the same
    version and companion-first theme.
  - The release handoff no longer points at stale baseline evidence.
  - Architecture-documented entry points exist on disk.

## Impact

- No runtime behavior changes.
- No user data, IPC, permissions, migrations, dependencies, or packaging config
  changes.
- Release docs become less likely to drift after small handoff-only commits.

## Risks

- The alignment test is intentionally documentation-sensitive; future release
  wording changes may need a matching test update.
- The handoff still requires checking the latest PR head and CI after every
  pushed commit, because a commit cannot safely embed its own final hash.

## Rollback

Revert the architecture, roadmap, changelog, handoff, design doc, and
project-alignment test changes. No app or data rollback is required.

## Acceptance

- Architecture public-entry-point docs match existing files.
- v0.3.5 handoff no longer references `48e6b78`.
- A focused test guards version, theme, handoff, and architecture entry-point
  alignment.
- Full tests, build, lint, and GitHub CI pass after the calibration commit.
