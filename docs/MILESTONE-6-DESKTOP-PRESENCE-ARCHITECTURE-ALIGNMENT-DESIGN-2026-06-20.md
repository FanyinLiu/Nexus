# Milestone 6 Slice 12 — Desktop Presence Architecture Alignment

## Problem

v0.3.5 now has a visible companion upgrade: memory sources are inspectable and
the desktop companion exposes idle, thinking, listening, speaking, waiting,
error, and offline states. The code already keeps these behaviors small and
companion-first, but the architecture document needs to name the same module
boundaries so future work does not treat the presence system as a task-agent
dashboard.

## Technical Design

- Update `docs/ARCHITECTURE.md` with a companion presence flow that maps
  chat/voice/runtime signals into `features/pet/activityState`, then into
  `PetView`, Sprite, Live2D, status labels, and data attributes.
- Document that the resolved companion state is content-minimized and must not
  carry chat text, memory text, secrets, model output, tool arguments, paths, or
  audit payloads.
- Keep memory source visibility documented as a separate white-box provenance
  flow through memory trace IDs, runtime-only detail resolution, and Settings
  Memory focus/edit/delete/pause controls.
- Document that `features/releaseNotes` remains content-only release copy and
  local Settings navigation, not updater, IPC, migration, tool, voice, or task
  execution logic.
- Correct the architecture note about feature barrels: there is no aggregate
  `src/features/index.ts` today, so modules should use feature-specific
  `index.ts` surfaces until an aggregate barrel is added deliberately.

## Impact

- Documentation aligns with the current `features/pet/activityState`,
  `PetView`, `CompanionStatePreview`, memory trace, and release spotlight code.
- Future Live2D, voice, and memory work has a clearer place to attach without
  widening the visible state object.
- No runtime behavior, user data, IPC, migrations, dependencies, or release
  packaging change in this slice.

## Risks

- Documentation can drift again if future slices add voice or Live2D state
  fields without updating the architecture flow.
- The existing legacy `features/agent` and errand surfaces may still make the
  repo look task-agent-oriented unless future UI copy keeps them secondary.

## Rollback

Revert the architecture, roadmap, changelog, and test updates. No data or code
rollback is required.

## Acceptance

- `docs/ARCHITECTURE.md` names the companion presence flow, memory provenance
  separation, releaseNotes content-only boundary, and missing aggregate feature
  barrel.
- `docs/ROADMAP.md` lists the architecture-alignment slice under M6.
- `CHANGELOG.md` records the v0.3.5 architecture alignment.
- A focused test guards the architecture anchors so the v0.3.5 companion-first
  boundary does not drift before release.
