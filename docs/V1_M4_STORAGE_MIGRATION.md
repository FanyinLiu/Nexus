# Nexus v1.0 M4 Storage Migration Inventory

This note is the M4 implementation contract. It prepares the
localStorage-to-main-process-SQLite migration without moving runtime reads yet,
and now includes the first main-process SQLite foundation, a non-destructive
structured copy path for already-backed-up chat and memory snapshots, and a
private restore-bundle fixture plus a redacted read-through preview IPC and
evidence gate.

## Objective

Make the current renderer localStorage surface visible, classified, and
release-gated, then establish a main-process SQLite schema and migration
ledger, a non-destructive local snapshot backup path, a structured chat/memory
copy target, restore evidence, and a renderer-visible redacted read-through
preview before introducing runtime read-through migration.

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

`scripts/m4-storage-snapshot-copy-evidence.mjs` runs the backup and structured
copy code paths end to end against either synthetic `--sample` data or a private
renderer export passed with `--input`. It writes
`artifacts/v1/m4-storage-snapshot-copy-evidence.json` with only key names,
counts, readiness flags, and privacy checks. It does not copy chat text, memory
bodies, relationship notes, raw localStorage values, private backup file
contents, or absolute SQLite/backup paths into the public report.

`exportLocalStorageSnapshotRestoreBundle()` reconstructs a manual-confirmed
restore bundle from an existing SQLite backup id. The bundle is a private local
file that intentionally contains the backed-up localStorage values needed for a
rollback, but the public result and evidence report expose only key names,
counts, hash verification, and policy flags. It records a migration event and
does not mutate renderer localStorage or enable read-through migration.
`m4:storage:restore:evidence` runs that fixture from sample or private
renderer-export input and writes
`artifacts/v1/m4-storage-restore-evidence.json`.

`queryLocalStorageReadThroughPreview()` adds a read-through preview over copied
schema v3 chat and memory rows. It can locate a copy run by backup id or copy id
and return counts, source storage keys, safe role/category aggregates,
freshness flags, and policy flags. The preview is exposed to the renderer
through `storage:read-through-preview` and
`window.desktopPet.queryLocalStorageReadThroughPreview()` with trusted sender
checks, request validation, response validation, and preload type coverage. It
does not return chat content, chat session titles, memory bodies, source refs,
localStorage raw values, or absolute paths. `m4:storage:read-through:evidence`
runs backup, structured copy, and this preview query from sample or private
renderer-export input, then writes
`artifacts/v1/m4-storage-read-through-evidence.json`. The report sets
`previewQueryEnabled: true` but keeps `runtimeMigrationEnabled: false` and
`readThroughMigrationEnabled: false`.

`setLocalStorageReadThroughMode()` adds the first user-confirmed runtime
read-through feature-flag contract. It is exposed as
`storage:set-read-through-mode` and
`window.desktopPet.setLocalStorageReadThroughMode()`. Enabling requires an
existing copied run, `copyId`, `userConfirmed: true`, readable chat or memory
rows, preserved source localStorage, and a non-destructive runtime state. The
response returns only the selected copy id, backup id, domains, readiness
counts, confirmation flags, and rollback hints; it does not return chat text,
memory bodies, raw localStorage values, or paths. Disabling clears the flag,
returns ledger rows to `copied`, and records an audit event. This is the
guarded switch contract for renderer read-through data access.

`queryLocalStorageReadThroughData()` adds the first guarded data-bearing
read-through path. It is exposed as `storage:read-through-data` and
`window.desktopPet.readLocalStorageReadThroughData()`. Unlike the redacted
preview, this response can return copied chat text, chat session data, long-term
memory bodies, and daily memory entries, so it only succeeds when an existing
copy run has `readThroughMigrationEnabled`, source localStorage is preserved,
destructive runtime migration is disabled, and the mode was enabled through the
user-confirmed switch above. The IPC response explicitly sets
`containsUserData: true` and `sqliteValuesReturned: true`, blocks raw
localStorage values and absolute paths, and keeps `valuesCopiedToAuditLog:
false`. The renderer startup adapter hydrates chat and memory React state from
that response without writing fallback localStorage. This is still a
transitional renderer hydration path, not the final sensitive-memory boundary or
main-process write store.

`downgradeNexusStorageSchema()` and `m4:storage:downgrade:evidence` add the
first offline schema downgrade fixture for the M4 SQLite store. The evidence
path runs snapshot backup, structured copy, restore-bundle export, and then a
schema v3 to v2 downgrade that removes structured copy tables after writing a
private database backup and migration events. The public report exposes only
counts, table names, file-name/hash presence, and policy flags; it does not
copy chat text, memory bodies, raw localStorage values, restore bundle contents,
or absolute paths.

## Impact Scope

Electron main-process services, package scripts, v1 milestone governance, docs,
preload/IPC contracts, renderer startup hydration, memory/chat hooks, and test
coverage. Runtime writes still keep source localStorage as the fallback.

## Risks

Static scanning can miss dynamically constructed storage keys. The SQLite
foundation proves schema and ledger readiness, not read-through migration or
packaged Electron compatibility. Treat these reports as a work queue and
release-candidate gate, not as completed user-data migration evidence. The
`storage:status` IPC is diagnostic-only; it must not be used as proof that chat
or memory reads have migrated. Snapshot backups, structured copy, restore
bundle export, and their evidence scripts prove that allowlisted chat/memory
data can be copied into private local files, ledger rows, schema v3 tables, and
a private rollback bundle without mutating source localStorage. They are not
automatic in-app restore evidence yet. The read-through preview evidence and
renderer IPC prove queryability of the copied rows as a redacted summary, but
they are not runtime migration or an automatic fallback switch. The
user-confirmed read-through mode IPC proves the guarded switch can be enabled
and disabled for a copied run, but renderer chat/memory modules still need a
main-process read path with localStorage fallback before localStorage stops
being the source of truth.

## Rollback Plan

Remove `electron/services/sqliteStorage.js`,
`scripts/m4-sqlite-foundation-audit.mjs`,
`electron/ipc/storageIpc.js`,
`scripts/m4-storage-migration-audit.mjs`,
`scripts/m4-storage-snapshot-copy-evidence.mjs`,
`scripts/m4-storage-restore-evidence.mjs`,
`scripts/m4-storage-read-through-evidence.mjs`,
`scripts/m4-storage-downgrade-evidence.mjs`, the `m4:sqlite:foundation`,
`m4:storage:audit`, `m4:storage:snapshot-copy:evidence`,
`m4:storage:restore:evidence`, `m4:storage:read-through:evidence`, and
`m4:storage:downgrade:evidence` package scripts,
the M4 evidence-gate entry in
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
disabled. The restore bundle path can reconstruct backed-up localStorage values
into a private manual-confirmed bundle and verify hashes before writing the
bundle. The read-through preview path can query the structured SQLite copy from
the main process without returning values, but it does not change runtime
persistence. The schema downgrade fixture can roll the current v3 structured
copy tables back to the v2 snapshot/ledger layer after a restore bundle and
database backup exist. The future migration must keep source localStorage values
until the SQLite copy is verified, write a private-safe backup before mutation,
record each key in the migration ledger, and provide an in-app restore
application path for every runtime migration.

## Tests And Evidence

Run:

```bash
npm run m4:storage:audit -- --require-inventory-ready --output artifacts/v1/m4-storage-migration.json
npm run m4:sqlite:foundation -- --require-ready --output artifacts/v1/m4-sqlite-foundation.json
npm run m4:storage:snapshot-copy:evidence -- --sample --require-ready --output artifacts/v1/m4-storage-snapshot-copy-evidence.json
npm run m4:storage:restore:evidence -- --sample --require-ready --output artifacts/v1/m4-storage-restore-evidence.json
npm run m4:storage:read-through:evidence -- --sample --require-ready --output artifacts/v1/m4-storage-read-through-evidence.json
npm run m4:storage:downgrade:evidence -- --sample --require-ready --output artifacts/v1/m4-storage-downgrade-evidence.json
npm run m4:storage:audit -- --sqlite-foundation-file artifacts/v1/m4-sqlite-foundation.json --snapshot-copy-evidence-file artifacts/v1/m4-storage-snapshot-copy-evidence.json --restore-evidence-file artifacts/v1/m4-storage-restore-evidence.json --read-through-evidence-file artifacts/v1/m4-storage-read-through-evidence.json --downgrade-evidence-file artifacts/v1/m4-storage-downgrade-evidence.json --require-inventory-ready --output artifacts/v1/m4-storage-migration.json
node --experimental-strip-types --test tests/storage-ipc.test.ts tests/storage-local-snapshot-backup.test.ts tests/storage-read-through-hydration.test.ts tests/m4-sqlite-foundation.test.ts tests/m4-storage-migration-audit.test.ts tests/m4-storage-snapshot-copy-evidence.test.ts tests/m4-storage-restore-evidence.test.ts tests/m4-storage-read-through-evidence.test.ts tests/m4-storage-downgrade-evidence.test.ts tests/v1-milestone-audit.test.ts
node --experimental-strip-types --test tests/storage-ipc.test.ts tests/storage-local-snapshot-backup.test.ts tests/ipc-bridge-contract.test.ts tests/m3-ipc-security-audit.test.ts
npm run v1:milestone:audit -- --m4-storage-file artifacts/v1/m4-storage-migration.json --require-ready
```

The stricter migration gate is expected to fail until real runtime SQLite
read-through migration and automatic restore application code exists:

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
keys, and preserves source localStorage.
`m4:storage:snapshot-copy:evidence` now proves that backup plus structured copy
can run end to end from sample or private renderer-export input while producing
a redacted public report. `m4:storage:restore:evidence` now proves that a
backed-up snapshot can be reconstructed into a private restore bundle with hash
verification while producing a redacted public report.
`storage:read-through-preview` now exposes that redacted preview through the
trusted preload bridge, and `m4:storage:read-through:evidence` proves that the
main process can query the structured SQLite chat/memory copy and emit only
redacted counts, key names, and readiness flags. `storage:set-read-through-mode`
now gates read-through mode behind `userConfirmed: true`, an existing copy run,
source-localStorage preservation, response validation, audit events, and a
disable rollback path. `storage:read-through-data` now returns copied SQLite
chat/memory values only after that mode is enabled, discloses that the response
contains user data, refuses unsafe privacy flags, and hydrates renderer chat and
memory state without writing fallback localStorage. `m4:storage:downgrade:evidence`
now proves that a schema v3 database with copied chat/memory rows can export a
restore bundle, write a private database backup, remove structured copy tables,
and land on schema v2 without exposing user values in the public report.

M4 is not accepted as complete. Strict v1 acceptance should keep blocking on M4
until packaged-runtime SQLite evidence, read-through migration, real renderer
snapshot backup/restore/downgrade evidence, automatic restore application, and
cross-platform evidence exist.

## Known Gaps

- Packaged Electron `node:sqlite` behavior still needs smoke evidence.
- Relationship state is backed up but not structured-copied until a dedicated
  table or view exists.
- Renderer startup chat/memory read-through hydration is implemented behind the
  confirmed mode switch, but runtime writes still fall back to localStorage and
  the final main-process write store is not implemented.
- Restore bundle export and schema downgrade evidence exist, but automatic
  restore application and in-app downgrade UX are not implemented.
- Snapshot backup and structured copy evidence can be generated from sample or
  private renderer-export input, but a real renderer profile still needs to be
  exported and run through that gate before M4 migration acceptance.
- Read-through preview evidence, renderer preview IPC, the user-confirmed mode
  switch, and renderer startup hydration exist, but real renderer-profile
  hydration evidence still needs to be captured.
- Existing localStorage data remains the runtime source of truth.

## Next Stage Tasks

- Run `m4:storage:snapshot-copy:evidence` against a real renderer export.
- Run `m4:storage:restore:evidence` against a real renderer export.
- Run `m4:storage:read-through:evidence` against a real renderer export.
- Run `m4:storage:downgrade:evidence` against a real renderer export.
- Capture renderer read-through hydration evidence with the confirmed
  read-through mode enabled and fallback localStorage left intact.
- Add fixture-based runtime migration, corruption, and automatic restore tests.
