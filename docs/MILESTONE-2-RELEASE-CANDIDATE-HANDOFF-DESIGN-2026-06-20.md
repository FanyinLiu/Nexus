# Milestone 2 Release Candidate Handoff Design - 2026-06-20

## Problem

The v0.3.5 candidate already has a companion-first product theme, local
verification evidence, and green PR CI, but the final merge/tag operator still
needs one concise handoff that answers:

- what users should remember about this release,
- what evidence has already passed,
- what must still run only after merge to `main`,
- which release risks are known and intentionally not hidden, and
- which next phase keeps Nexus focused on companionship instead of task-agent
automation.

Without that handoff, the release can pass technically while still feeling
unclear to users.

## Technical Design

- Add `docs/RELEASE-CANDIDATE-v0.3.5-HANDOFF.md` as a release-candidate
  operator note.
- Keep the handoff documentation-only. It does not replace `docs/RELEASING.md`
  and does not introduce updater, signing, IPC, storage, migration, or runtime
  behavior.
- Record the PR, head commit, branch, CI status, user-facing headline,
  already-collected local evidence, remaining post-merge commands, residual
  trust risks, rollback path, and recommended companion-first next phase.
- Extend `tests/release-spotlight.test.ts` so the handoff cannot silently drop
  the merge/tag evidence, packaged/presence smoke evidence, signing warnings,
  or companion-not-agent boundary.

## Impact

- User-facing docs get a stable release explanation for v0.3.5:
  visible memory plus readable desktop companion presence.
- Release operators get a compact checklist for the exact work that remains
  after PR merge.
- No app code, packaged runtime behavior, data schema, IPC contract, or
  dependency graph changes.

## Risks and Mitigations

- Risk: the handoff duplicates release process details and can drift from
  `docs/RELEASING.md`.
  Mitigation: keep it scoped to v0.3.5 evidence and post-merge commands, while
  stating that `docs/RELEASING.md` remains authoritative process docs.
- Risk: stale evidence could be mistaken for final release evidence.
  Mitigation: the handoff explicitly says Stage A must run after merge because
  it verifies the exact release head and tag state.
- Risk: the release theme could drift back toward automation.
  Mitigation: the focused test requires the companion boundary and next-phase
  companion-first options to remain in the handoff.

## Rollback

- Delete `docs/RELEASE-CANDIDATE-v0.3.5-HANDOFF.md`.
- Remove the handoff-specific assertion block from
  `tests/release-spotlight.test.ts`.
- Revert the ROADMAP, ARCHITECTURE, and CHANGELOG notes for this handoff.

Because the change is documentation and tests only, rollback has no user-data,
runtime, installer, signing, IPC, or storage side effects.

## Acceptance

- The handoff names the memorable v0.3.5 upgrade in user language.
- The handoff records the PR, branch, head commit, green CI status, local
  verification evidence, post-merge release commands, residual signing/runtime
  risks, and rollback path.
- The handoff says Nexus is not adding a Codex-style work agent, task planner,
  autonomous executor, or new automation surface in v0.3.5.
- The focused release spotlight test fails if the handoff loses merge/tag
  evidence, smoke evidence, residual trust warnings, or the companion-first
  next-phase recommendation.
