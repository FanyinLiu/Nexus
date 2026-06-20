# Milestone 4 - Main-process Storage Adapter and SQLite Foundation

Status: completed and validated in this branch.

## Goal

Introduce a main-process local data foundation before moving chat, memory,
permissions, or audit-relevant logs out of renderer `localStorage`.

This milestone deliberately does not migrate existing user data yet. Renderer
`localStorage` remains the authoritative read/write source until the SQLite
adapter has domain-level tests, packaged smoke coverage, and per-domain
migration/rollback plans.

## Problem

- Heavy user data still lives in renderer `localStorage`, including chat,
  long-term memory, plans, timelines, letters, and metering data.
- The app has no versioned main-process storage schema, migration ledger, or
  rollback target that later data migrations can rely on.
- Adding a SQLite backend without smoke and packaging validation would risk
  breaking installer builds across platforms.

## Design

- Add `electron/services/localDataStore.js` as the main-process storage
  foundation.
- Use Electron/Node's built-in `node:sqlite` API for the current backend instead
  of adding a third-party native SQLite addon:
  - `userData/local-data/nexus.sqlite`,
  - metadata tables,
  - migration ledger,
  - domain registry,
  - generic low-risk mirror record table.
- Keep a readable metadata manifest next to the database:
  - `userData/local-data/manifest.json`,
  - manifest format `nexus-local-data-manifest`,
  - backend `sqlite`,
  - schema version `3`.
- Keep the manifest metadata-only:
  - backend,
  - schema version,
  - created/updated timestamps,
  - migration ledger,
  - future domain registry.
- Add export/import scaffolding at the service layer:
  - default exports are metadata-only before user-controlled export flows,
  - service-only record exports can include the low-risk onboarding mirror for
    tests and future export design,
  - import currently plans/validates compatible snapshots and does not write
    domain data.
- Add rollback scaffolding that renames `local-data` aside instead of deleting
  it, preserving any future data while returning the app to the legacy
  renderer-storage authority.
- Initialize the local data foundation during `app.whenReady()`.
- Add `local-data:status` as a read-only IPC status method. The renderer sees
  only health, backend, schema version, migration counts, and non-path error
  categories.
- Add `local-data:mirror-onboarding` as the first narrow write IPC. It accepts
  only normalized onboarding completion timestamps, writes a best-effort SQLite
  mirror, and returns write status without returning record payloads.

## Slice 1 SQLite Decision

No SQLite package was introduced in the first slice.

Reason:

- The current repo has no SQLite dependency.
- Common Electron SQLite packages are native dependencies and must be validated
  against `electron-builder`, ASAR unpacking, rebuild behavior, and signing on
  macOS, Windows, and Linux.
- A versioned storage adapter and migration ledger can be built and tested
  without that dependency first.

Slice 2 below adds the SQLite backend after adding smoke and packaging gates.

## Impact Scope

- Main process:
  - local-data service,
  - app startup initialization,
  - read-only IPC registration.
- Renderer:
  - preload exposes `localDataStatus()`,
  - preload exposes `localDataMirrorOnboarding()` for the onboarding mirror,
  - TypeScript ambient type gains local-data status and mirror result types.
- No React UI changes.
- Existing onboarding `localStorage` remains the authoritative source.
- No chat, memory, vault, permission, or audit-log data migration.

## Migration

Applied automatically on startup:

- `0001-create-local-data-manifest`
  - from schema version `0`,
  - to schema version `1`,
  - creates the manifest and first migration ledger entry.
- `0002-create-sqlite-local-data-foundation`
  - from schema version `1`,
  - to schema version `2`,
  - creates SQLite metadata tables, `schema_migrations`, and an empty
    `domain_registry`.
- `0003-create-domain-records-and-onboarding-mirror`
  - from schema version `2`,
  - to schema version `3`,
  - creates `local_data_records`,
  - registers the low-risk onboarding mirror domain.

The migration chain is idempotent. Re-running initialization after schema
version `3` does not rewrite the manifest or duplicate ledger entries.

## Rollback

Rollback options:

- Disable the `initializeLocalDataStore()` startup call and local-data IPC
  registration.
- Use `rollbackLocalDataStore()` to rename `userData/local-data` to a
  `local-data.disabled-*` directory. The directory is preserved; no user data is
  deleted.
- Existing renderer `localStorage` remains authoritative throughout this
  milestone, so application behavior falls back to the pre-M4 path.

No authoritative data migration rollback is required because onboarding remains
owned by renderer `localStorage`; the SQLite onboarding row is only a mirror.

## Known Risks

- A corrupted manifest makes the local-data adapter unhealthy. The app still
  starts with renderer storage, and the status IPC reports a non-path error
  category.
- `node:sqlite` is still marked experimental in the current Node runtime and
  must stay covered by smoke and packaging gates as Electron, Node, and
  supported platforms change.
- Future migrations must avoid expanding `local-data:status` into a data export
  surface. User records and sensitive memory exports should require explicit
  user-controlled export flows.
- The onboarding mirror is best-effort. A failed mirror write must not block
  first-run completion or change what the user sees.

## User Documentation

- There is no visible user workflow change in this slice.
- Existing chats, memories, settings, and localStorage data stay in place.
- Onboarding completion timing is mirrored into SQLite for migration readiness,
  but the app still reads onboarding state from existing renderer storage.
- If the new local-data manifest is unavailable or invalid, Nexus continues to
  use the existing renderer storage path.

## Developer Documentation

- `localDataStore` owns SQLite initialization, manifest metadata, schema
  versioning, migration ledger, domain registry, low-risk mirror records,
  metadata-first export/import planning, and rollback-by-rename.
- Do not add domain tables or records directly to the manifest. Later slices
  should register domains behind the adapter and keep migrations idempotent.
- Do not expose userData paths, raw filesystem errors, or record payloads
  through renderer status IPC. Mirror write IPC should return status only.
- Keep both Node and Electron SQLite smoke checks wired before release packaging.

## Validation Results

- Focused local-data tests passed:
  `node --experimental-strip-types --test tests/local-data-store.test.ts`
  - 8 tests passed.
- Focused local-data plus IPC contract tests passed:
  `node --experimental-strip-types --test tests/local-data-store.test.ts tests/ipc-contract-audit.test.ts`
  - 20 tests passed.
- Focused local-data, IPC contract, payload schema, and onboarding storage tests
  passed:
  `node --experimental-strip-types --test tests/ipc-payload-schema.test.ts tests/local-data-store.test.ts tests/ipc-contract-audit.test.ts tests/storage-ui-state.test.ts`
  - 49 tests passed.
- SQLite runtime smoke checks passed:
  - `npm run sqlite:smoke`
  - `npm run sqlite:smoke:electron`
- IPC audit passed after adding `local-data:status`:
  - `npm run ipc:audit`
  - 0 warnings, 0 errors.
  - Preload invoke/main handler counts increased from 172 to 173 for
    `local-data:mirror-onboarding`.
- Full regression suite passed:
  - `npm test`
  - 1932 tests passed, 0 failed.
- Build and static checks passed:
  - `npm run build`
  - `npm run lint`
  - `git diff --check`
- Release, packaging, and documentation audit gates passed:
  - `npm run verify:release`
  - `npm run distribution:audit`
  - `npm run i18n:audit`
  - `npm run release:trust:audit`
  - `npm run package:dir:smoke`
- Known environment notes:
  - `npm run sqlite:smoke` reports Node's `ExperimentalWarning` for
    `node:sqlite`; Electron smoke passes.
  - Release trust audit still reports the expected unsigned macOS and Windows
    warnings for the current local/CI posture.
  - Packaged smoke still reports missing optional KWS/SenseVoice models and
    disabled torch-backed Python sidecars in this environment.

## Acceptance Results

- Main-process SQLite storage foundation exists and initializes on app startup.
- Schema versioning and an idempotent migration ledger exist in SQLite and in
  the metadata manifest.
- Domain registry and a generic record table exist.
- The onboarding domain is registered as a low-risk renderer-localStorage mirror.
- Rollback preserves the local-data directory, including `nexus.sqlite`, instead
  of deleting it.
- Export/import scaffolding exists; default exports stay metadata-only and
  imports still do not write record payloads.
- Renderer storage remains authoritative; no existing user data is migrated or
  deleted.

## Suggested Next M4 Slice

- Add a second small domain or start a chat-session migration design with a
  read-only audit of legacy localStorage shape before moving records.

## Implementation Slice 2 - SQLite Backend and Packaging Gate

Status: completed and validated in this branch.

Problem:

- Slice 1 provided the storage adapter and migration ledger, but it still used
  a JSON manifest as the only persisted backend.
- The v1.0 target requires chat, memory, permissions, and audit-relevant data
  to move into main-process SQLite later.
- Introducing a native SQLite addon without explicit smoke and packaging gates
  could break Electron development, ASAR packaging, or platform release builds.

Dependency decision:

- Use Electron/Node's built-in `node:sqlite` API instead of adding a third-party
  native addon.
- Reason: it gives the Electron main process a synchronous SQLite API without
  adding an extra native module, ASAR unpack rule, rebuild step, or
  Node/Electron ABI split.
- A trial with `better-sqlite3` exposed the exact risk this slice was designed
  to catch: `electron-builder` rebuilt the package for Electron ABI, and a
  later Node smoke failed with a Node module version mismatch. The dependency
  was removed before landing the final implementation.
- `node:sqlite` currently emits Node's ExperimentalWarning, so Electron/Node
  version upgrades must keep this smoke-covered until the API is stable enough
  for v1.0.

Design:

- Keep `localDataStore` as the single main-process adapter.
- Add `userData/local-data/nexus.sqlite` as the SQLite database file.
- Raise the local-data schema target to version `2`.
- Keep `manifest.json` as readable metadata only; SQLite is now the backend
  that stores schema metadata, migrations, and the empty domain registry.
- Add migration `0002-create-sqlite-local-data-foundation`:
  - creates SQLite metadata tables,
  - creates `schema_migrations`,
  - creates an empty `domain_registry`,
  - preserves migration `0001` when upgrading an existing `json-ledger`
    manifest from Slice 1.
- Load `node:sqlite` lazily during initialization so SQLite runtime failures
  become an unhealthy `local-data:status` instead of a top-level app crash.
- Add `npm run sqlite:smoke`, which opens a temporary SQLite database through
  Node, enables WAL mode, writes a small table, reads it back, and deletes the
  temp directory.
- Add `npm run sqlite:smoke:electron`, which performs the same driver-level
  check inside the Electron main process.
- Run `sqlite:smoke` in `verify:release` and in release CI before platform
  installer builds.
- Extend `distribution:audit` so SQLite smoke wiring drift is checked from
  source.

Impact scope:

- Main process:
  - local-data backend becomes SQLite,
  - startup still initializes through the same adapter,
  - `local-data:status` remains read-only metadata.
- Packaging:
  - no extra SQLite npm dependency is added,
  - release CI runs SQLite smoke before packaging,
  - packaged smoke verifies app startup with the SQLite foundation initialized.
- No renderer UI changes.
- No domain data migration.
- No API key, chat, memory, permission, or audit-log payload is exposed to the
  renderer.

Migration:

- Fresh profiles apply:
  - `0001-create-local-data-manifest`,
  - `0002-create-sqlite-local-data-foundation`.
- Existing Slice 1 profiles with a `json-ledger` manifest preserve the
  `0001` applied timestamp and append `0002`.
- Corrupt manifests are not overwritten; the adapter reports unhealthy and
  existing renderer storage remains authoritative.

Rollback:

- Revert the `node:sqlite` backend changes, SQLite smoke scripts, release CI
  smoke steps, and schema version `2` migration.
- Or call `rollbackLocalDataStore()` to rename the whole `local-data` directory
  to `local-data.disabled-*`; this preserves `manifest.json`, `nexus.sqlite`,
  and any future sidecar files.
- Since no chat or memory records are migrated, existing renderer
  `localStorage` remains the runtime source of truth after rollback.

Known risks:

- Only the current local machine can perform a packaged smoke test in this
  branch. Windows and Linux validation is enforced by the release workflow when
  those runners package the app.
- `node:sqlite` is still marked experimental by Node in this runtime and may
  require API review when Electron or Node versions change.
- The current SQLite database has only metadata tables and an empty domain
  registry; domain-level migrations still need separate design and rollback
  plans.

Validation results:

- Focused checks passed:
  - `npm run sqlite:smoke`
  - `npm run sqlite:smoke:electron`
  - `node --experimental-strip-types --test tests/local-data-store.test.ts tests/ipc-contract-audit.test.ts`
  - 18 focused tests passed.
- Audit and release gates passed:
  - `npm run ipc:audit`
  - `npm run distribution:audit`
  - `npm run i18n:audit`
  - `npm run release:trust:audit`
  - `npm run verify:release`
- Full build/test/package gates passed:
  - `npm test` - 1922 tests passed.
  - `npm run build`
  - `npm run lint`
  - `npm run package:dir:smoke`
  - `git diff --check`
- Known environment notes:
  - Node emits `ExperimentalWarning` for `node:sqlite`; this is accepted for this
    slice and kept behind smoke gates.
  - Release trust audit still has 2 expected unsigned macOS/Windows warnings.
  - Packaged smoke still reports optional missing KWS/SenseVoice models and
    disabled torch-backed Python sidecars in this environment.

Acceptance results:

- SQLite database file is created under `local-data`.
- Schema version is `2`.
- Migration ledger contains both `0001` and `0002`.
- Existing Slice 1 `json-ledger` manifests migrate forward without losing the
  original `0001` timestamp.
- Export/import scaffolding remains metadata-only.
- Renderer `localStorage` remains authoritative for all current user data.

Suggested next M4 slice:

- Add domain registration and a small non-critical domain mirror behind the
  SQLite adapter before moving chat or long-term memory records.

## Implementation Slice 3 - Domain Registry and Onboarding Mirror

Status: completed and validated in this branch.

Problem:

- Slice 2 created a SQLite foundation but did not yet prove a real domain could
  be registered, mirrored, validated, exported in a controlled way, and rolled
  back.
- Moving chat or long-term memory first would be too risky because those records
  are user-facing, larger, and privacy-sensitive.
- The next step needed a small domain that exercises the same adapter path
  without changing runtime authority.

Design:

- Raise the local-data schema target to version `3`.
- Add migration `0003-create-domain-records-and-onboarding-mirror`:
  - creates `local_data_records`,
  - keeps `domain_registry` as the source of domain metadata,
  - registers the `onboarding` domain with `sourceStorageKey:
    nexus:onboarding`,
  - marks the mirror as renderer-localStorage-authoritative, non-secret, and
    not user-content.
- Add `mirrorLocalDataOnboardingState()` in the main-process local-data service.
- Add `local-data:mirror-onboarding` IPC:
  - trusted sender required,
  - schema validation required,
  - unknown fields rejected,
  - accepted fields limited to `completedAt`, `firstConversationAt`, and
    `firstConversationElapsedMs`,
  - handler returns only status metadata.
- Update renderer onboarding storage so existing localStorage writes trigger a
  best-effort mirror. A mirror failure does not block first-run completion.
- Default local-data exports remain metadata-only. Service-level tests can opt
  into records with `includeRecords: true`; import planning still never writes
  record payloads.

Impact scope:

- Main process:
  - schema target becomes `3`,
  - generic record table is available,
  - onboarding domain registration is automatic and idempotent.
- Renderer:
  - onboarding storage writes call the mirror bridge best-effort,
  - localStorage remains the read/write authority.
- IPC:
  - preload/main invoke count increases to `173`,
  - payload validation coverage increases by one schema-validated channel.
- No chat, long-term memory, API key, permission, or audit-log migration.

Migration:

- Fresh profiles now apply `0001`, `0002`, and `0003`.
- Existing schema version `2` profiles apply only `0003`.
- Existing Slice 1 `json-ledger` profiles still preserve the original `0001`
  timestamp and append `0002` and `0003`.
- Invalid onboarding mirror payloads are rejected before creating SQLite data.

Rollback:

- Disable the renderer mirror call and `local-data:mirror-onboarding` IPC.
- Revert schema version `3` and migration `0003` before release, or call
  `rollbackLocalDataStore()` to rename `local-data` aside.
- Because onboarding localStorage remains authoritative, deleting or disabling
  the mirror does not lose runtime onboarding state.

Known risks:

- The mirror is best-effort and can lag localStorage if SQLite is unavailable.
  That is acceptable in this slice because the mirror is not authoritative.
- The generic record table is intentionally simple. Chat and memory migrations
  still need separate shape audits, record-level migration plans, and rollback
  checks before use.
- `node:sqlite` remains experimental in the Node runtime and stays behind smoke
  gates.

Validation results:

- Focused checks passed:
  - `node --experimental-strip-types --test tests/ipc-payload-schema.test.ts tests/local-data-store.test.ts tests/ipc-contract-audit.test.ts tests/storage-ui-state.test.ts`
  - 49 tests passed.
  - `npm run sqlite:smoke`
  - `npm run sqlite:smoke:electron`
  - `npm run ipc:audit`
- Full gates passed:
  - `npm test` - 1926 tests passed.
  - `npm run build`
  - `npm run lint`
  - `npm run verify:release`
  - `npm run distribution:audit`
  - `npm run i18n:audit`
  - `npm run release:trust:audit`
  - `npm run package:dir:smoke`
  - `git diff --check`
- Known environment notes:
  - Node emits `ExperimentalWarning` for `node:sqlite`; this remains accepted
    behind smoke gates.
  - Release trust audit still has 2 expected unsigned macOS/Windows warnings.
  - Packaged smoke still reports optional missing KWS/SenseVoice models and
    disabled torch-backed Python sidecars in this environment.

Acceptance results:

- Schema version is `3`.
- Migration ledger contains `0001`, `0002`, and `0003`.
- `domain_registry` contains the `onboarding` domain.
- `local_data_records` can mirror and delete the onboarding `state` record.
- Invalid mirror payloads are rejected before database creation.
- Renderer receives status-only mirror results and no record payloads.
- Existing onboarding localStorage remains authoritative.

Suggested next M4 slice:

- Audit the current chat-session localStorage shape and design a read-only
  migration dry-run report before writing chat records into SQLite.

## Implementation Slice 4 - Chat Storage Dry-run Audit

Status: completed and validated in this branch.

Problem:

- Chat is the first large user-content domain targeted for SQLite migration.
- Existing data can live under both `nexus:chat:sessions` and the legacy flat
  `nexus:chat` key.
- Calling existing loaders mutates storage by compacting and migrating legacy
  data, which is not acceptable for a migration audit step.
- Sending raw chat records to the main process before a reviewed migration plan
  would widen the privacy surface and make rollback harder.

Design:

- Add a renderer-side, pure dry-run builder for chat localStorage.
- Inputs are raw localStorage strings for `nexus:chat:sessions` and
  `nexus:chat`.
- Output is a content-free migration report:
  - raw byte counts,
  - source key presence,
  - normalized session/message counts,
  - role counts,
  - time range,
  - content byte estimate,
  - issue codes and severities,
  - whether a future migration would need user confirmation.
- The dry-run must not:
  - call existing mutating chat loaders,
  - write to localStorage,
  - send message content, titles, reasoning traces, tool results, or URLs over
    IPC,
  - create SQLite chat records.
- Export the report builder for tests and future settings/dev surfaces.

Impact scope:

- Renderer storage utilities only.
- Tests for legacy and session-shaped chat localStorage.
- Documentation only for main-process storage architecture.
- No Electron IPC changes.
- No SQLite schema change.
- No chat, memory, permission, or audit-log migration.

Migration:

- No data migration is performed in this slice.
- The report uses the same normalizers as current chat storage to estimate what
  a later migration would preserve or drop.

Rollback:

- Remove the dry-run module, export, and tests.
- No user data rollback is needed because no storage is written.

Known risks:

- The report is a localStorage-shape audit, not proof that a full SQLite chat
  migration is safe.
- Content byte estimates are approximate and intentionally do not expose
  content.
- Future migration still needs a separate confirmation UI, SQLite write path,
  import/export behavior, and rollback strategy.

Validation results:

- Focused checks passed:
  - `node --experimental-strip-types --test tests/chat-migration-dry-run.test.ts tests/chat-storage.test.ts`
  - 9 tests passed.
  - `npm run build`
  - `npm run lint`
  - `npm run ipc:audit`
  - `npm run distribution:audit`
- Full gates passed:
  - `npm test` - 1930 tests passed.
  - `npm run verify:release`
  - `npm run i18n:audit`
  - `npm run release:trust:audit`
  - `npm run package:dir:smoke`
  - `git diff --check`
- Known environment notes:
  - Node emits `ExperimentalWarning` for `node:sqlite`; this remains accepted
    behind smoke gates.
  - Release trust audit still has 2 expected unsigned macOS/Windows warnings.
  - Packaged smoke still reports optional missing KWS/SenseVoice models and
    disabled torch-backed Python sidecars in this environment.

Acceptance results:

- Dry-run produces useful summaries for empty, valid session, legacy flat, and
  malformed JSON inputs.
- Dry-run reports do not contain message content or session titles.
- Tests prove localStorage is not mutated.
- Build, lint, test, and packaging gates remain green.

Suggested next M4 slice:

- Design the first confirmed chat SQLite write path:
  - explicit user confirmation,
  - migration preview from the dry-run report,
  - content-bearing IPC payload schema,
  - record-level rollback/export behavior,
  - no renderer readback of records until the white-box history UI is designed.

## Implementation Slice 5 - Confirmed Chat Migration Service Path

Status: completed and validated in this branch.

Problem:

- Slice 4 can audit chat localStorage without content leakage, but it cannot
  prove that content-bearing chat records can be written to main-process SQLite.
- A production IPC/UI migration is high-risk because it moves private chat
  content across the renderer/main boundary.
- Before exposing that path, the service layer needs a tested write,
  rollback-by-domain, and content-free audit record.

Design:

- Keep production renderer behavior unchanged: chat localStorage remains
  authoritative and no UI triggers migration.
- Add a renderer-side migration package builder that normalizes the same
  `nexus:chat:sessions` and legacy `nexus:chat` shapes as the dry-run report.
- Add main-process service functions only:
  - `planChatLocalDataMigration()` validates a content-bearing package and
    returns content-free counts and issue codes,
  - `applyChatLocalDataMigration()` requires an explicit confirmation flag
    before writing,
  - `rollbackChatLocalDataMigration()` deletes only the chat-session domain
    records.
- Store migrated chat sessions as records under the `chat-sessions` local-data
  domain.
- Add a `local-data-audit` domain record for each confirmed migration. The audit
  payload must include counts, timestamps, and action kind, not chat content.
- Do not add IPC in this slice. A future slice must add user confirmation UI and
  content-bearing IPC schema before production migration can be triggered.

Impact scope:

- Renderer storage utilities for migration package construction.
- Main-process local-data service for service-only chat write/rollback.
- Tests for package construction, content-free planning, confirmed writes,
  audit records, and rollback.
- No UI changes.
- No production IPC changes.
- No existing localStorage writes or deletions.

Migration:

- No automatic user migration is performed.
- Tests and future tools can call the service with a package and
  `confirmed: true`.
- The service rejects unconfirmed or malformed packages without writing records.

Rollback:

- `rollbackChatLocalDataMigration()` deletes `chat-sessions` records only.
- Existing renderer localStorage remains authoritative and untouched.
- The broader `rollbackLocalDataStore()` directory rename remains available.

Known risks:

- Chat records are stored as JSON domain records first, not normalized relational
  chat/message tables. This keeps the first write path small but is not the
  final query/index shape.
- A future IPC/UI slice still must provide explicit user confirmation and avoid
  renderer readback until the white-box history/memory UI exists.
- Audit records prove that a migration was applied, but they are not yet a full
  user-visible audit log.

Validation results:

- Focused checks passed:
  - `node --experimental-strip-types --test tests/local-data-store.test.ts tests/chat-migration-dry-run.test.ts tests/chat-storage.test.ts`
  - 18 tests passed.
  - `npm run sqlite:smoke`
  - `npm run sqlite:smoke:electron`
  - `npm run build`
  - `npm run lint`
  - `npm run ipc:audit`
  - `npm run distribution:audit`
- Full gates passed:
  - `npm test` - 1931 tests passed.
  - `npm run verify:release`
  - `npm run i18n:audit`
  - `npm run release:trust:audit`
  - `npm run package:dir:smoke`
  - `git diff --check`
- Known environment notes:
  - Node emits `ExperimentalWarning` for `node:sqlite`; this remains accepted
    behind smoke gates.
  - Release trust audit still has 2 expected unsigned macOS/Windows warnings.
  - Packaged smoke still reports optional missing KWS/SenseVoice models and
    disabled torch-backed Python sidecars in this environment.

Acceptance results:

- Migration package construction preserves normalized chat content only in the
  package, not in dry-run reports.
- Planning and apply results never include chat content.
- Applying without confirmation writes nothing.
- Applying with confirmation writes chat records and a content-free audit
  record.
- Rollback removes chat records without touching onboarding or audit records.
- Build, lint, test, and release gates remain green.

Suggested next M4 slice:

- Add a disabled-by-default IPC/UI migration preview surface that shows the
  content-free dry-run summary, asks for explicit user confirmation, and then
  calls the service write path without returning chat records to renderer.

## Implementation Slice 6 - Disabled Chat Migration IPC Boundary

Status: completed and validated in this branch.

Problem:

- Slice 5 proved the main-process service write path, but there was still no
  preload/IPC boundary for a future user-confirmed migration UI.
- A content-bearing chat migration IPC is high-risk because it crosses private
  chat content from renderer to main.
- The IPC boundary must be inventoryable before UI work, but it must not be
  accidentally usable in production.

Design:

- Add two preload/main-process IPC methods:
  - `local-data:chat-migration-apply`,
  - `local-data:chat-migration-rollback`.
- Keep both handlers disabled unless
  `NEXUS_ENABLE_LOCAL_DATA_CHAT_MIGRATION=1`.
- Require trusted sender checks.
- Add schema validation for the content-bearing migration package:
  - maximum 30 sessions,
  - maximum 500 messages per session,
  - maximum 200,000 characters per message content/reasoning field,
  - unknown fields rejected.
- Require `confirmed: true` in both IPC and service paths before any write or
  rollback.
- Classify both new channels as high-risk `local-user-data` in the IPC contract
  audit.
- Treat the service's content-free `local-data-audit` records as the audit path
  for confirmed apply/rollback operations.
- Return only counts, status, and audit record ids. Do not return chat records
  or message content to renderer.

Impact scope:

- Electron IPC/preload contract only.
- Ambient renderer types for future UI usage.
- IPC audit script and tests.
- No user-visible UI.
- No automatic chat migration.
- Existing chat localStorage remains authoritative.

Migration:

- No automatic migration is performed.
- With the feature flag off, IPC apply/rollback returns disabled status after
  schema validation and writes nothing.
- With the feature flag on, handlers still require `confirmed: true` and call
  the Slice 5 service path.

Rollback:

- Remove the two preload methods and IPC handlers.
- Remove the two payload schemas and IPC audit classification.
- Existing localStorage and SQLite records are unaffected by removing the IPC
  boundary.

Known risks:

- The IPC boundary is intentionally present but disabled by default. Future UI
  work must keep the feature flag and explicit confirmation behavior until the
  user-facing preview is ready.
- The schema permits `toolResult` as bounded service-validated JSON. Future
  relational chat tables may want stricter tool-result sub-schemas.

Validation results:

- Focused checks passed:
  - `node --experimental-strip-types --test tests/ipc-contract-audit.test.ts tests/ipc-payload-schema.test.ts tests/local-data-store.test.ts`
  - 38 tests passed.
  - `npm run ipc:audit`
  - `npm run lint`
  - `npm run build`
- Full gates passed:
  - `npm test` - 1932 tests passed.
  - `npm run verify:release`
  - `npm run i18n:audit`
  - `npm run release:trust:audit`
  - `npm run package:dir:smoke`
  - `git diff --check`
- Known environment notes:
  - Node emits `ExperimentalWarning` for `node:sqlite`; this remains accepted
    behind smoke gates.
  - Release trust audit still has 2 expected unsigned macOS/Windows warnings.
  - Packaged smoke still reports optional missing KWS/SenseVoice models and
    disabled torch-backed Python sidecars in this environment.

Acceptance results:

- Preload/main handler counts increased to `175`.
- High-risk handler count increased to `39`.
- New chat migration IPC channels have trusted sender, schema validation,
  permission confirmation hints, and audit coverage.
- Disabled-by-default handlers write nothing unless the feature flag is enabled.
- Renderer types expose future apply/rollback methods without exposing readback
  of chat records.

Suggested next M4 slice:

- Build a disabled-by-default settings preview panel that reads only the
  content-free dry-run report, explains what would migrate, and requires a
  user confirmation before calling the feature-flagged IPC apply path.

## Implementation Slice 7 - Hidden Chat Migration Preview Panel

Status: completed and validated in this branch.

Problem:

- Slice 6 exposed the high-risk apply/rollback IPC boundary, but there was no
  user-visible dry-run review surface to exercise it safely.
- The renderer still owns legacy chat `localStorage`; any preview must avoid
  displaying or returning chat titles, message bodies, reasoning text, tool
  result URLs, or SQLite record payloads.
- The UI must be impossible to reach accidentally in production while the chat
  migration remains non-authoritative.

Design:

- Add `src/lib/storage/chatMigrationPreview.ts` as a content-free summary layer
  over the existing dry-run report.
- Gate the Settings preview panel behind
  `VITE_NEXUS_ENABLE_LOCAL_DATA_CHAT_MIGRATION_UI=1`.
- Keep the actual write path behind the existing main-process
  `NEXUS_ENABLE_LOCAL_DATA_CHAT_MIGRATION=1` gate.
- Place the panel in Settings -> History so it is adjacent to existing chat
  export/import controls but separate from normal archived-session content.
- Show only aggregate counts, byte estimates, role distribution, source-key
  presence, date range, and dry-run issue codes.
- Require a local checkbox and a confirmation dialog before constructing the
  content-bearing migration package and calling `localDataApplyChatMigration`.
- Display disabled/blocked bridge errors directly, including the expected
  disabled-IPC result when the main-process flag is not enabled.
- Do not add SQLite record readback, post-migration history viewing, automatic
  migration, or a production rollback button in this slice.

Impact scope:

- Renderer settings UI and styles.
- Renderer-only chat migration preview summary helper.
- Locale dictionaries and i18n key inventory.
- Dry-run tests for preview gating and content-free summary behavior.
- Roadmap, architecture, and changelog documentation.

Migration:

- No automatic migration is performed.
- With `VITE_NEXUS_ENABLE_LOCAL_DATA_CHAT_MIGRATION_UI` unset, the panel renders
  nothing.
- With the UI flag on but the main-process flag off, applying returns a
  disabled result and writes nothing.
- With both flags on, applying still requires the checkbox, dialog confirmation,
  IPC schema validation, trusted sender checks, and service confirmation.

Rollback:

- Remove `ChatMigrationPreviewPanel` from `HistorySection`.
- Remove `chatMigrationPreview.ts` and its barrel export.
- Remove the locale keys and CSS classes.
- Existing localStorage and SQLite data are unaffected by removing this preview.
- If a developer enabled both flags and applied a migration, use the existing
  feature-flagged rollback IPC/service path or retained localStorage snapshots
  for recovery; rollback UI remains a future reviewed slice.

Known risks:

- This is a developer preview, not the final production migration flow.
- It can send content-bearing packages only after explicit UI confirmation and
  only when the main-process gate is enabled, but future production UX still
  needs clearer backup/export guidance before broad release.
- It does not verify SQLite records from the renderer because readback would
  expand the privacy surface; main-process/local-data tests remain the source of
  write-path verification.

Validation results:

- Focused checks passed:
  - `node --experimental-strip-types --test tests/chat-migration-dry-run.test.ts`
  - 6 tests passed.
  - `npm run build`
  - `npm run lint`
  - `npm run i18n:audit`
- Full gates passed:
  - `npm test` - 1934 tests passed.
  - `npm run verify:release`
  - `npm run ipc:audit`
  - `npm run release:trust:audit`
  - `npm run package:dir:smoke`
  - `git diff --check`
- Known environment notes:
  - Node still emits `ExperimentalWarning` for `node:sqlite`.
  - Release trust audit still has 2 expected unsigned macOS/Windows warnings.
  - Packaged smoke still reports optional missing KWS/SenseVoice models and
    disabled torch-backed Python sidecars in this environment.

Acceptance results:

- UI preview is disabled unless
  `VITE_NEXUS_ENABLE_LOCAL_DATA_CHAT_MIGRATION_UI=1`.
- Apply still cannot write unless
  `NEXUS_ENABLE_LOCAL_DATA_CHAT_MIGRATION=1` is set in the main process.
- Preview summaries exclude chat titles, message content, reasoning traces,
  tool result URLs, and session ids.
- Applying requires both a checkbox and confirmation dialog before the
  content-bearing package is created and sent.
- Renderer receives only apply status, counts, and audit record id from the
  IPC path; no SQLite chat records are read back.

Suggested next M4 slice:

- Add a developer-only migration export/backup and rollback review surface that
  stays content-explicit, confirms destructive rollback separately, and keeps
  normal users on legacy localStorage until the full chat migration is ready.

## Implementation Slice 8 - Hidden Chat Migration Backup and Rollback Review

Status: completed and validated in this branch.

Problem:

- Slice 7 could apply a developer-confirmed migration, but it did not provide a
  clear backup step before sending content-bearing chat data to the main
  process.
- Rollback existed in the main-process service and IPC boundary, but the hidden
  UI did not expose it with a separate destructive confirmation.
- A backup surface must be honest that it contains full chat content while still
  keeping normal preview summaries content-free.

Design:

- Extend the hidden Settings history migration panel with a content backup
  section.
- Build a `nexus-chat-migration-backup` JSON envelope that explicitly sets
  `includesMessageContent: true` and contains the migration package under a
  single content-bearing field.
- Require a confirmation dialog before creating and downloading the backup
  envelope.
- Keep the backup export local to the renderer download flow; it does not add a
  new main-process readback/export IPC and does not read SQLite chat records.
- Add a separate rollback review section with its own checkbox and confirmation
  dialog before calling `localDataRollbackChatMigration({ confirmed: true })`.
- Keep rollback behind the existing main-process
  `NEXUS_ENABLE_LOCAL_DATA_CHAT_MIGRATION=1` gate and trusted/schema-validated
  IPC handler.
- Return/display only rollback status, deleted-record count, and audit id.

Impact scope:

- Hidden Settings migration preview UI.
- Renderer-only backup envelope helper and filename helper.
- Locale dictionaries and i18n key inventory.
- Dry-run/preview tests.
- Roadmap, architecture, and changelog documentation.

Migration:

- No automatic migration is performed.
- Backup export is available only when the hidden UI flag is enabled and the
  current dry-run has migratable chat data.
- Backup export is explicitly content-bearing and must be confirmed every time.
- Rollback writes nothing unless both the hidden UI is visible and the existing
  main-process migration IPC gate is enabled.

Rollback:

- Remove the backup and rollback sections from `ChatMigrationPreviewPanel`.
- Remove `buildChatMigrationBackupEnvelope()` and
  `buildChatMigrationBackupFileName()`.
- Remove the locale keys and CSS classes.
- Existing localStorage chat history remains authoritative and is not affected.
- Already-migrated SQLite chat-session records can still be removed by the
  service/IPC rollback path while that path remains enabled.

Known risks:

- Backup files contain full chat content by design. The UI warns before export,
  but future production UX should add stronger destination guidance and perhaps
  native save dialogs with audit metadata.
- The rollback review cannot show whether SQLite records currently exist
  because this slice intentionally avoids record readback to the renderer.
- This remains a developer-only migration tool, not a production migration
  workflow for normal users.

Validation results:

- Focused checks passed:
  - `node --experimental-strip-types --test tests/chat-migration-dry-run.test.ts`
  - 7 tests passed.
  - `npm run i18n:audit`
  - `npm run build`
  - `npm run lint`
- Full gates passed:
  - `npm test` - 1935 tests passed.
  - `npm run verify:release`
  - `npm run ipc:audit`
  - `npm run release:trust:audit`
  - `npm run package:dir:smoke`
  - `git diff --check`
- Known environment notes:
  - Node still emits `ExperimentalWarning` for `node:sqlite`.
  - Release trust audit still has 2 expected unsigned macOS/Windows warnings.
  - Packaged smoke still reports optional missing KWS/SenseVoice models and
    disabled torch-backed Python sidecars in this environment.

Acceptance results:

- Backup export is hidden behind
  `VITE_NEXUS_ENABLE_LOCAL_DATA_CHAT_MIGRATION_UI=1`.
- Backup envelope explicitly marks that it includes full chat message content.
- Content-free preview summaries remain content-free.
- Rollback requires a checkbox, a confirmation dialog, and the existing
  feature-flagged rollback IPC/service path.
- Renderer still does not receive SQLite chat records.

Suggested next M4 slice:

- Add a post-apply local-data status/audit summary that stays metadata-only and
  helps developers verify whether the migration and rollback actions happened
  without exposing chat records back to the renderer.

## Implementation Slice 9 - Metadata-only Chat Migration Status Summary

Status: completed and validated in this branch.

Problem:

- Slice 8 intentionally avoided SQLite record readback, so developers could apply
  or roll back the hidden migration path but could not verify the resulting local
  data state from the same panel.
- A verification surface must not become a back door for chat content, session
  IDs, titles, paths, or record payloads to flow back into the renderer.
- The status surface must stay disabled by default with the rest of the
  developer-only migration IPC.

Design:

- Add `getChatLocalDataMigrationStatus()` in the main-process local-data service.
- Count `chat-sessions` records and stored messages inside the main process only.
- Read only the latest chat migration audit action from `local-data-audit`:
  `chat-sessions-migration-applied` or
  `chat-sessions-migration-rolled-back`.
- Return only metadata:
  - `recordCount`
  - `messageCount`
  - `lastAuditRecordId`
  - `lastAuditAction`
  - `lastAuditAt`
  - `recordPayloadsIncluded: false`
- Do not return SQLite record IDs, session titles, message bodies, tool result
  payloads, userData paths, or raw audit payloads.
- Expose `local-data:chat-migration-status` through preload only when
  `NEXUS_ENABLE_LOCAL_DATA_CHAT_MIGRATION=1` is enabled.
- Keep the hidden Settings panel manual-refreshable and automatically refresh the
  metadata status after successful apply/rollback actions.

Impact scope:

- Main-process local-data service metadata summary.
- One disabled-by-default no-payload IPC/preload bridge.
- Hidden Settings history migration preview UI and CSS.
- Locale dictionaries and i18n key inventory.
- Local-data and IPC contract tests.
- Roadmap, architecture, and changelog documentation.

Migration:

- No automatic chat migration is performed.
- No schema migration is required; this reads existing `local_data_records`
  metadata and audit entries from schema version `3`.
- Existing renderer `localStorage` chat history remains authoritative.
- The status summary initializes the local-data foundation if needed, but it does
  not create, expose, or mutate chat-session records.

Rollback:

- Remove `getChatLocalDataMigrationStatus()`, the
  `local-data:chat-migration-status` handler, and the preload method.
- Remove the hidden panel local-status section and related locale/CSS entries.
- Existing localStorage and SQLite records remain untouched.
- Apply and rollback IPC paths continue to work independently while enabled.

Known risks:

- The message count is derived by parsing stored chat-session payloads inside the
  main process. Malformed payloads count as zero messages instead of exposing
  payload errors to the renderer.
- Audit metadata can show that a migration or rollback occurred, but it is not a
  full history viewer and does not prove semantic content correctness.
- This remains a developer-only migration tool, not a production migration flow
  for normal users.

Validation results:

- Focused checks passed:
  - `node --experimental-strip-types --test tests/local-data-store.test.ts tests/ipc-contract-audit.test.ts tests/ipc-bridge-contract.test.ts`
  - 29 tests passed.
- Full gates passed:
  - `npm run i18n:audit` - 2157 keys, 0 missing/extra/duplicate across all locales.
  - `npm run ipc:audit` - 176 preload invoke channels, 176 main handler channels, 0 warnings, 0 errors.
  - `npm run build`
  - `npm run lint`
  - `npm test` - 1935 tests passed.
  - `npm run verify:release`
  - `npm run release:trust:audit` - ok=7, warning=2, error=0.
  - `npm run package:dir:smoke`
  - `git diff --check`
- Known environment notes:
  - Node still emits `ExperimentalWarning` for `node:sqlite`.
  - Release trust audit still has 2 expected unsigned macOS/Windows warnings.
  - Packaged smoke still reports optional missing KWS/SenseVoice models,
    disabled torch-backed Python sidecars, and Electron builder/Node
    deprecation warnings in this environment.

Acceptance results:

- Hidden panel can refresh post-apply/rollback status without reading SQLite chat
  records into the renderer.
- The status IPC carries no renderer payload and is inventoried by the IPC audit.
- The returned status is metadata-only and explicitly marks
  `recordPayloadsIncluded: false`.
- Tests prove private message text, private titles, and source session IDs are
  absent from the status summary.

Suggested next M4 slice:

- Decide whether the hidden developer migration flow is sufficient for M4 or
  whether one more pre-M5 slice should add a release-disabled import rehearsal
  for exported backup envelopes before the full chat/memory migration milestone.
