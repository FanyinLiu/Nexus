# Nexus v1.0 M4 Storage Migration Inventory

This note is the M4 implementation contract. It prepares the
localStorage-to-main-process-SQLite migration without moving runtime reads yet,
and now includes the first main-process SQLite foundation plus a non-destructive
structured copy path for already-backed-up chat and memory snapshots.

## Objective

Make the current renderer localStorage surface visible, classified, and
release-gated, then establish a main-process SQLite schema and migration
ledger, a non-destructive local snapshot backup path, and a structured
chat/memory copy target before introducing read-through migration or rollback
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
dependency, creates schema version 3, and initializes private tables for:

- `storage_schema_migrations`
- `storage_backups`
- `local_storage_migration_ledger`
- `storage_migration_events`
- `local_storage_backup_runs`
- `local_storage_backup_items`
- `local_storage_copy_runs`
- `local_storage_copy_items`
- `memory_sources`
- `chat_sessions`
- `chat_messages`
- `memories`
- `daily_memory_entries`

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

`storage:backup-local-snapshot` and
`window.desktopPet.backupLocalStorageSnapshot()` add the first non-destructive
backup bridge for chat, memory, daily memory, and relationship summary keys.
The renderer can send bounded raw localStorage strings for an allowlisted key
set; the main process writes a private backup JSON file, records the run and
items in SQLite, marks the relevant ledger rows as `backed-up`, and emits a
private-safe migration event. The IPC response returns only key names, counts,
domains, a backup file name, and a sha256 hash. It never returns localStorage
values, absolute backup paths, or any mutation signal, and it leaves source
localStorage untouched.

`storage:copy-local-snapshot` and
`window.desktopPet.copyLocalStorageSnapshot()` add the first non-destructive
structured copy step after a snapshot backup exists. The main process reads the
private SQLite backup rows by backup id, writes chat sessions/messages,
long-term memories, daily memory entries, and memory-source references into
schema v3 tables, records copy run/item rows, and marks copied keys in the
ledger. The response returns only counts, copied/skipped key names, and policy
flags. It does not return values, does not delete source localStorage, and keeps
runtime/read-through migration disabled. Relationship-shaped localStorage is
backed up but skipped by this copy step until a dedicated relationship table or
view is introduced.

`src/lib/storage/localSnapshotBackup.ts` centralizes the renderer-side
collection of the current chat, chat session, long-term memory, daily memory,
legacy memory, and relationship localStorage keys. The helper is intentionally
manual-call only; no startup path automatically backs up or copies user data
yet.

## Impact Scope

Electron main-process services, package scripts, v1 milestone governance, docs,
preload/IPC contracts, and test coverage. Runtime renderer storage behavior is
intentionally unchanged.

## Risks

Static scanning can miss dynamically constructed storage keys. The SQLite
foundation proves schema and ledger readiness, not read-through migration or
packaged Electron compatibility. Treat these reports as a work queue and
release-candidate gate, not as completed user-data migration evidence. The
`storage:status` IPC is diagnostic-only; it must not be used as proof that chat
or memory reads have migrated. Snapshot backups and structured copy prove that
allowlisted chat/memory data can be copied into private local files, ledger
rows, and schema v3 tables without mutating source localStorage, but they are
not restore, rollback, or read-through evidence yet.

## Rollback Plan

Remove `electron/services/sqliteStorage.js`,
`scripts/m4-sqlite-foundation-audit.mjs`,
`electron/ipc/storageIpc.js`,
`scripts/m4-storage-migration-audit.mjs`, the `m4:sqlite:foundation` and
`m4:storage:audit` package scripts, the M4 evidence-gate entry in
`scripts/v1-milestone-audit.mjs`, `src/lib/storage/localSnapshotBackup.ts`,
this document, and the focused tests. Delete only generated files under
`artifacts/v1` and any local `storage/backups/*.local-storage-snapshot.json`
files created during manual testing. Source localStorage is not changed.

## Data Migration And Rollback

No runtime user data migration is performed in this slice. The foundation
creates schema migration, backup, localStorage migration ledger, migration
event, snapshot run/item, structured copy run/item, chat, memory, and source
reference tables. The snapshot backup path can copy allowlisted chat/memory
values into a local private backup file and SQLite ledger, and the structured
copy path can then write backed-up chat/memory rows into schema v3 tables. Both
paths preserve source localStorage and keep runtime/read-through migration
disabled. The future migration must keep source localStorage values until the
SQLite copy is verified, write a private-safe backup before mutation, record
each key in the migration ledger, and provide a restore or downgrade command for
each schema version.

## Tests And Evidence

Run:

```bash
npm run m4:storage:audit -- --require-inventory-ready --output artifacts/v1/m4-storage-migration.json
npm run m4:sqlite:foundation -- --require-ready --output artifacts/v1/m4-sqlite-foundation.json
npm run m4:storage:audit -- --sqlite-foundation-file artifacts/v1/m4-sqlite-foundation.json --require-inventory-ready --output artifacts/v1/m4-storage-migration.json
node --experimental-strip-types --test tests/m4-sqlite-foundation.test.ts tests/m4-storage-migration-audit.test.ts tests/v1-milestone-audit.test.ts
node --experimental-strip-types --test tests/storage-ipc.test.ts tests/storage-local-snapshot-backup.test.ts tests/ipc-bridge-contract.test.ts tests/m3-ipc-security-audit.test.ts
npm run v1:milestone:audit -- --m4-storage-file artifacts/v1/m4-storage-migration.json --require-ready
```

The stricter migration gate is expected to fail until real SQLite read-through
migration, restore, and rollback code exists:

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
built-in `node:sqlite`, schema version 3, and private-safe migration, backup,
snapshot, structured copy, chat, memory, source reference, ledger, and event
tables. Read-only `storage:status` IPC is wired through preload, requires
trusted sender validation, is covered by the global high-risk IPC audit wrapper,
validates its response shape, and redacts the absolute database path.
`storage:backup-local-snapshot` now backs up allowlisted
chat/memory/relationship localStorage values into a local backup file and
SQLite ledger, validates request and response shapes, redacts absolute paths,
and preserves source localStorage. `storage:copy-local-snapshot` now copies
already-backed-up chat sessions/messages, long-term memories, and daily memory
entries into schema v3 tables, records copied/skipped item rows, keeps
relationship state backed up but skipped, returns only private-safe counts and
keys, and preserves source localStorage. Runtime read-through migration is not
enabled.

M4 is not accepted as complete. Strict v1 acceptance should keep blocking on M4
until packaged-runtime SQLite evidence, read-through migration, real renderer
snapshot backup evidence, restore/rollback, and cross-platform evidence exist.

## Known Gaps

- Packaged Electron `node:sqlite` behavior still needs smoke evidence.
- Relationship state is backed up but not structured-copied until a dedicated
  table or view exists.
- Read-through storage IPC contracts are not implemented.
- Restore, rollback, and schema downgrade tooling are not implemented.
- Snapshot backup and structured copy evidence is available, but no automated
  release gate invokes it against a real renderer profile yet.
- Existing localStorage data remains the runtime source of truth.

## Next Stage Tasks

- Capture chat/memory localStorage snapshot backup and structured copy evidence
  from a real renderer profile.
- Extend storage IPC for read-through chat and memory migration.
- Implement read-through migration for chat and memory first.
- Add fixture-based migration, corruption, backup, and rollback tests.
