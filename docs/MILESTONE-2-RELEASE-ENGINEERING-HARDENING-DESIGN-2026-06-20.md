# Milestone 2 Release Engineering Hardening Design - 2026-06-20

## Problem

After the v0.3.5 release-candidate alignment pass, Nexus had good release,
IPC, and project-alignment checks, but several engineering boundaries were
still easy to drift:

- Electron main-process JavaScript was not explicitly covered by an environment
  aware lint block.
- Renderer localStorage keys did not have a single migration/classification
  contract.
- Heavy renderer modules could be imported eagerly by accident.
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
- Add `npm run heavy:audit` to keep renderer embeddings, OCR, browser VAD,
  Live2D, Pixi, and ONNX-related packages lazy-loaded or vendor-loaded.
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

## Risks

- JS lint can surface historical main-process issues as the rule set becomes
  stricter. This pass intentionally leaves noisy cleanup rules off and catches
  only lower-noise hazards first.
- The storage contract can become stale if future storage constants are added
  without updating the registry; that is intentional and should fail loudly.
- Heavy-module audit is heuristic source scanning, not a complete bundler
  proof. It guards the current known failure surfaces.

## Rollback

Revert the new scripts, npm script wiring, `distribution:audit` imports, the
small IPC primitive split, the agent README, and this design doc. Because no
runtime state, user data, IPC names, migrations, or dependencies changed, no
user-data rollback is required.

## Acceptance

- `npm run lint`
- `npm run storage:audit`
- `npm run heavy:audit`
- `npm run companion-boundary:audit`
- `npm run ipc:audit`
- focused engineering guardrail tests
- `npm run verify:pr`
- `npm run verify:release`
