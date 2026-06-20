# Milestone 2 Release Engineering Hardening Design - 2026-06-20

## Problem

After the v0.3.5 release-candidate alignment pass, Nexus had good release,
IPC, and project-alignment checks, but several engineering boundaries were
still easy to drift:

- Electron main-process JavaScript was not explicitly covered by an environment
  aware lint block.
- Renderer localStorage keys did not have a single migration/classification
  contract.
- Several renderer browser-storage keys lived outside the original storage
  helper and could be missed by a helper-only scan.
- Heavy renderer modules could be imported eagerly by accident.
- Renderer modules did not have an automated source-layer boundary check, so
  shared code could drift upward toward app/view orchestration.
- Very large source files had no budget gate, making cleanup and review harder
  to keep incremental.
- `verify:release` was the only named local gate, so PR-level verification and
  release-level verification were not clearly separated.
- Legacy `features/agent/` naming could read like a Codex-style work-agent
  direction even though the product direction is companionship.

## Technical Design

- Add a conservative JS lint block for `electron/` and `scripts/` that catches
  undefined/runtime hazards without forcing a noisy full cleanup of historical
  empty cleanup blocks.
- Add `scripts/storage-contract.mjs` plus `npm run storage:audit` to require
  every renderer localStorage key to declare its domain, classification,
  authority, and migration posture.
- Extend `npm run storage:audit` from the storage helper to all renderer source
  files, including inline browser-storage calls, session keys, prefix keys, and
  the legacy VTube Studio auth token key marked as `secret-adjacent`.
- Add `npm run heavy:audit` to keep renderer embeddings, OCR, browser VAD,
  Live2D, Pixi, and ONNX-related packages lazy-loaded or vendor-loaded.
- Add `npm run architecture:audit` to fail inverted renderer imports such as
  shared libraries depending on app/view composition.
- Add `npm run source-size:audit` to keep normal source files below the
  large-file budget, with explicit allowances for generated i18n catalogs and
  the current local data store service.
- Tighten `npm run ipc:audit` so warnings fail now that the IPC baseline is
  already 0 warnings / 0 errors.
- Add `npm run companion-boundary:audit` and `src/features/agent/README.md` so
  the old agent-named folder is documented as companion task support, not a
  work-agent expansion.
- Add `npm run verify:pr` as the day-to-day gate and make
  `npm run verify:release` reuse it before running the SQLite smoke check.
- Split IPC schema primitives into `electron/ipc/payloadSchemaPrimitives.js`
  while keeping every public validator in `payloadSchemas.js`.

## Impact Scope

- Runtime behavior: unchanged.
- Data/storage migration: none.
- IPC channel names and payload shapes: unchanged.
- New dependencies: none.
- User-facing UI: unchanged.
- Developer workflow: new audit scripts and a clearer PR/release verification
  split.
- Maintainer workflow: PR verification now catches storage-contract drift,
  inverted renderer boundaries, and source-file bloat before release work.

## Risks

- JS lint can surface historical main-process issues as the rule set becomes
  stricter. This pass intentionally leaves noisy cleanup rules off and catches
  only lower-noise hazards first.
- The storage contract can become stale if future storage constants are added
  without updating the registry; that is intentional and should fail loudly.
- The all-source storage scan is heuristic. It is designed to catch the current
  browser-storage patterns without reading user data, not to replace TypeScript
  or runtime migration tests.
- Heavy-module audit is heuristic source scanning, not a complete bundler
  proof. It guards the current known failure surfaces.
- The architecture boundary audit is a coarse import-direction guard. If a
  future module legitimately needs a new layer rule, update the rule and design
  doc in the same slice.
- The source-size audit can force earlier extraction work when files approach
  the budget. That is intentional, but generated files need explicit budgets.

## Rollback

Revert the new scripts, npm script wiring, `distribution:audit` imports, the
small IPC primitive split, the agent README, and this design doc. If only the
second hardening slice needs rollback, revert `architecture-boundary-audit.mjs`,
`source-size-audit.mjs`, the all-source storage-audit expansion, and their npm
script/test/doc wiring. Because no runtime state, user data, IPC names,
migrations, or dependencies changed, no user-data rollback is required.

## Acceptance

- `npm run lint`
- `npm run storage:audit`
- `npm run heavy:audit`
- `npm run architecture:audit`
- `npm run source-size:audit`
- `npm run companion-boundary:audit`
- `npm run ipc:audit`
- focused engineering guardrail tests
- `npm run verify:pr`
- `npm run verify:release`
