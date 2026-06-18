# Nexus v1.0 M4 Storage Migration Inventory

This note is the M4 implementation contract. It prepares the
localStorage-to-main-process-SQLite migration without moving user data yet, and
now includes the first main-process SQLite foundation.

## Objective

Make the current renderer localStorage surface visible, classified, and
release-gated, then establish a main-process SQLite schema and migration
ledger before introducing read-through migration, real backups, or rollback
tooling.

## Problem Analysis

Nexus already has many storage helpers under `src/lib/storage`, but long-lived
chat, memory, settings, permission, runtime, and audit-like data still depend on
renderer localStorage. Some feature-local keys also live outside the central
storage module. A safe SQLite migration needs both an inventory and a
main-process ledger first so the project does not lose data, skip rollback
paths, or accidentally expose private values through new IPC.

## Technical Design

`scripts/m4-storage-migration-audit.mjs` statically reads `src/**/*`,
`electron/**/*`, and `package.json`. It produces
`artifacts/v1/m4-storage-migration.json` with:

- storage key names, source files, line numbers, domains, and migration
  priority;
- direct localStorage/sessionStorage access counts, with central storage-core
  access separated from feature-local access;
- required M4 domain coverage for chat, memory, permissions/settings, and
  audit/log style stores;
- SQLite dependency status and whether dependency review is still required;
- migration guardrails requiring source localStorage preservation, backup before
  mutation, rollback tooling, and macOS/Windows/Linux coverage.

The report does not read localStorage values or copy chat text, memory bodies,
API keys, audit log entries, local file contents, or source ids.

`electron/services/sqliteStorage.js` is the first main-process SQLite
foundation. It selects built-in `node:sqlite` before adding a packaged native
dependency, creates schema version 1, and initializes private tables for:

- `storage_schema_migrations`
- `storage_backups`
- `local_storage_migration_ledger`
- `storage_migration_events`

`scripts/m4-sqlite-foundation-audit.mjs` initializes that schema in a bounded
database path and writes `artifacts/v1/m4-sqlite-foundation.json`. The report
records engine availability, schema/table readiness, backup/rollback ledger
readiness, and privacy guarantees. It does not read renderer localStorage and
does not copy user chat, memory, secrets, files, or audit log contents.

`electron/ipc/storageIpc.js` exposes the first read-only storage bridge through
`storage:status` and `window.desktopPet.storageStatus()`. The handler requires a
trusted sender, returns only foundation readiness, schema/table counts, and
privacy flags, validates the response before renderer exposure, and redacts
absolute database paths. It is not a read-through migration API.

## Impact Scope

Electron main-process services, package scripts, v1 milestone governance, docs,
preload/IPC contracts, and test coverage. Runtime renderer storage behavior is
intentionally unchanged.

## Risks

Static scanning can miss dynamically constructed storage keys. The SQLite
foundation proves schema and ledger readiness, not read-through migration or
packaged Electron compatibility. Treat these reports as a work queue and
release-candidate gate, not as user-data migration evidence. The `storage:status`
IPC is diagnostic-only; it must not be used as proof that chat or memory reads
have migrated.

## Rollback Plan

Remove `electron/services/sqliteStorage.js`,
`scripts/m4-sqlite-foundation-audit.mjs`,
`electron/ipc/storageIpc.js`,
`scripts/m4-storage-migration-audit.mjs`, the `m4:sqlite:foundation` and
`m4:storage:audit` package scripts, the M4 evidence-gate entry in
`scripts/v1-milestone-audit.mjs`, this document, and the focused tests. Delete
only generated files under `artifacts/v1` if they were created locally. No
persisted user data is changed.

## Data Migration And Rollback

No user data migration is performed in this slice. The foundation creates a
schema migration table, backup table, localStorage migration ledger, and
private-safe migration event table. The future migration must keep source
localStorage values until the SQLite copy is verified, write a private-safe
backup before mutation, record each key in the migration ledger, and provide a
restore or downgrade command for each schema version.

## Tests And Evidence

Run:

```bash
npm run m4:storage:audit -- --require-inventory-ready --output artifacts/v1/m4-storage-migration.json
npm run m4:sqlite:foundation -- --require-ready --output artifacts/v1/m4-sqlite-foundation.json
npm run m4:storage:audit -- --sqlite-foundation-file artifacts/v1/m4-sqlite-foundation.json --require-inventory-ready --output artifacts/v1/m4-storage-migration.json
node --experimental-strip-types --test tests/m4-sqlite-foundation.test.ts tests/m4-storage-migration-audit.test.ts tests/v1-milestone-audit.test.ts
node --experimental-strip-types --test tests/storage-ipc.test.ts tests/ipc-bridge-contract.test.ts tests/m3-ipc-security-audit.test.ts
npm run v1:milestone:audit -- --m4-storage-file artifacts/v1/m4-storage-migration.json --require-ready
```

The stricter migration gate is expected to fail until real SQLite migration,
backup, and rollback code exists:

```bash
npm run m4:storage:audit -- --require-migration-ready
npm run v1:milestone:audit -- --m4-storage-file artifacts/v1/m4-storage-migration.json --require-acceptance-evidence
```

## User Documentation

User-facing storage location, export, backup, and restore docs should be added
with the actual SQLite migration. This inventory stage is developer-facing.

## Acceptance Results

Inventory scaffolding is implemented. The audit identifies storage keys across
chat, memory, permissions/settings, audit/log style data, runtime cache, and
other support domains. SQLite foundation scaffolding is implemented with
built-in `node:sqlite`, schema version 1, and private-safe migration, backup,
rollback, ledger, and event tables. Read-only `storage:status` IPC is wired
through preload, requires trusted sender validation, is covered by the global
high-risk IPC audit wrapper, validates its response shape, and redacts the
absolute database path. Runtime migration is not enabled.

M4 is not accepted as complete. Strict v1 acceptance should keep blocking on M4
until packaged-runtime SQLite evidence, read-through migration, backup,
rollback, and cross-platform evidence exist.

## Known Gaps

- Packaged Electron `node:sqlite` behavior still needs smoke evidence.
- Read-through storage IPC contracts are not implemented.
- Backup, restore, rollback, and schema downgrade tooling are not implemented.
- Existing localStorage data remains the runtime source of truth.

## Next Stage Tasks

- Extend storage IPC for read-through chat and memory migration.
- Implement read-through migration for chat and memory first.
- Add fixture-based migration, corruption, backup, and rollback tests.
