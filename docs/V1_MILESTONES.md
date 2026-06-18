# Nexus v1.0 Milestone Governance

This document turns the long-term v1.0 direction into independently auditable
milestones. It is intentionally narrower than the product roadmap: every entry
must describe how a stage can be designed, implemented, tested, documented,
rolled back, and measured without a broad rewrite.

Related maintained documents: `docs/ROADMAP.md`, `docs/ARCHITECTURE.md`,
`docs/V1_M1_FIRST_RUN_SETUP.md`, `docs/V1_M2_DISTRIBUTION_TRUST.md`,
`docs/V1_M3_IPC_SECURITY.md`, `docs/V1_M4_STORAGE_MIGRATION.md`, and
`CHANGELOG.md`.

## Governance Contract

Every v1.0 milestone must keep the current Electron + React + TypeScript stack
compatible, preserve user data, and leave the app installable, buildable, and
runnable at the end of the stage.

Required delivery fields for each milestone:

- Objective
- Problem Analysis
- Technical Design
- Impact Scope
- Risks
- Rollback Plan
- Data Migration And Rollback
- Tests And Evidence
- User Documentation
- Acceptance Results
- Known Gaps
- Next Stage Tasks

Decision principles:

- Stability, safety, maintainability, and the core companion experience outrank
  feature count.
- New capabilities must reinforce desktop presence, local privacy, white-box
  memory, or permissioned execution.
- API keys, private memories, and sensitive context must not be exposed to the
  renderer in plaintext.
- High-risk actions require user confirmation and audit records.
- Schema changes need migration and rollback paths.
- Cross-platform behavior must be explicit for macOS, Windows, and Linux.
- New dependencies require a necessity note and should avoid duplicate or
  weakly maintained capabilities.
- Nexus should not chase generic workbench parity with Cherry Studio, Open
  WebUI, AnythingLLM, or AIRI.

## Priority Coverage Map

| Priority | Covered By | Acceptance Direction |
|---|---|---|
| First-run, model setup, Ollama/API detection, and repair flow | M1 | New users complete install, model setup, and first chat in 5 minutes |
| macOS, Windows, Linux install, signing, auto-update, and release flow | M2 | Release packages have trusted install/update evidence or documented unsigned fallback |
| Unified Electron IPC, validation, permissions, secrets, and audit logs | M3 | IPC requests and responses are validated; renderer cannot read plaintext secrets |
| Move chat, memory, permissions, and logs from localStorage to main-process SQLite | M4 | Data migrates safely with rollback and no user-data deletion |
| White-box long-term memory view, edit, delete, export, and recall pause | M5 | Users own and can source-trace important memories |
| Desktop avatar state machine for idle, thinking, listening, speaking, error, and confirmation | M6 | Presence state matches runtime state and stays low CPU |
| Voice input, TTS, VAD, interruption, and lip sync with lazy loading | M7 | Voice baseline is reliable without loading heavy modules unnecessarily |
| Local file index, light RAG, citations, and personal knowledge base | M8 | Answers can cite memory or file sources when used |
| Tool Registry plus Planner/Executor separation and authorized task lifecycle | M9 | Tasks can preview, confirm, pause, cancel, and report execution |
| Later MCP, plugins, more roles, and advanced automation | M10 | Advanced surfaces remain opt-in, scoped, and audit-ready |

## M0 - Baseline Audit And Milestone Governance

### Objective

Create a durable governance layer for the v1.0 path before larger structural
work begins.

### Problem Analysis

The repository already has ROADMAP, ARCHITECTURE, CHANGELOG, release notes, and
v0.4 evidence gates, but the long-term plan needs a repeatable way to prove
that each stage has design, risk, rollback, migration, test, documentation, and
acceptance evidence.

### Technical Design

Add this milestone contract plus a `v1:milestone:audit` script that checks
required docs, priority coverage, and per-milestone delivery sections.

### Impact Scope

Docs, package scripts, and tests only. No runtime behavior, persistence schema,
IPC surface, or UI behavior changes.

### Risks

The audit can become stale if new milestones are added without updating the
contract. The script intentionally checks structure and coverage, not the truth
of implementation evidence.

### Rollback Plan

Revert this document, the audit script, its package script entry, and focused
tests. Runtime builds remain unaffected.

### Data Migration And Rollback

No user data migration. No storage writes. No rollback data transform required.

### Tests And Evidence

Run `npm run v1:milestone:audit -- --require-ready`, focused milestone tests,
lint, stabilization evidence, and release verification. Release-candidate
checks can additionally run
`npm run v1:milestone:audit -- --require-acceptance-evidence` so milestone
governance fails when required runtime/platform evidence, starting with M1
first-run status plus M2/M3 release-candidate evidence, is missing or
incomplete.

### User Documentation

ROADMAP links this file as the v1.0 execution contract. ARCHITECTURE describes
how milestone boundaries map to code ownership layers.

### Acceptance Results

In progress. Acceptance requires the audit to pass and generated evidence to be
written under `artifacts/v1/milestone-audit.json`. The audit now reports M1
acceptance evidence from `artifacts/v1/m1-first-run-status.json`; that evidence
is informational by default and blocking when `--require-acceptance-evidence`
is used.

### Known Gaps

The full v1.0 objective remains incomplete. The current v0.4 completion audit
still requires real external message-awareness evidence.

### Next Stage Tasks

Start M1 with a concrete technical design for first-run setup, model provider
health checks, Ollama/API repair actions, and five-minute first-chat evidence.

## M1 - First-Run Setup And Model Repair

### Objective

Make first launch, model configuration, Ollama/API connection checks, and first
conversation succeed quickly for a new user.

### Problem Analysis

New users need actionable setup and repair guidance before deeper companion
features matter.

### Technical Design

Extend companion readiness into a guided first-run flow with model discovery,
provider health, fix suggestions, first conversation confirmation, and
first-chat evidence. The first private-safe audit scaffold is maintained in
`docs/V1_M1_FIRST_RUN_SETUP.md`, `scripts/m1-first-run-audit.mjs`, and
`src/features/onboarding/firstRunAuditInput.ts`.

### Impact Scope

Onboarding, model provider catalog, Electron model IPC, settings health panels,
local evidence scripts, and user docs.

### Risks

Provider-specific repairs can become inaccurate. Avoid hiding advanced
configuration from experienced users.

### Rollback Plan

Feature-flag the guided flow and retain existing provider settings.

### Data Migration And Rollback

No schema migration expected. Any new readiness state must tolerate missing
fields and be safe to clear.

### Tests And Evidence

Unit tests for provider health classification, smoke tests for first-chat
setup, and a readiness report proving the five-minute path. The evidence gates
are `npm run m1:first-run:audit`, `npm run m1:first-run:record`, and
`npm run m1:first-run:status`. The scaffold audit still runs as
`npm run m1:first-run:audit -- --sample --output artifacts/v1/m1-first-run-audit.json --require-ready`,
while `m1:first-run:status --require-ready` remains the stricter acceptance
gate once runtime and platform evidence exist. The v1 milestone audit reads the
generated `artifacts/v1/m1-first-run-status.json` summary and can make it
blocking with `--require-acceptance-evidence` for release-candidate checks.

### User Documentation

Update README setup docs and localized quick-start notes.

### Acceptance Results

Audit scaffold, runtime evidence-input adapter, Console copyable safe report,
onboarding text-connection evidence handoff, final-step M1 evidence preview,
Panel first-reply guidance, private-safe operator record command, and M1 status
rollup implemented. Runtime first-run acceptance remains pending until first
conversation evidence is captured on real macOS, Windows, and Linux machines.

### Known Gaps

Requires real machine checks for Ollama/API failure cases, captured runtime
first conversation evidence beyond the private-safe sample, and
`m1:first-run:status --require-ready` passing with all platform operator records.

### Next Stage Tasks

Move to M2 once the first-run path has measurable evidence.

## M2 - Distribution And Update Trust

### Objective

Make macOS, Windows, and Linux installation, signing or unsigned fallback,
auto-update, and release evidence predictable.

### Problem Analysis

Users cannot trust a desktop companion if installation, update, or platform
warnings are unclear.

### Technical Design

Tighten release gates around package smoke tests, update metadata, signing
status, unsigned fallback docs, and platform-specific installer evidence.
The first private-safe audit scaffold is maintained in
`docs/V1_M2_DISTRIBUTION_TRUST.md` and
`scripts/m2-distribution-trust-audit.mjs`.

### Impact Scope

Electron builder config, release workflow, prerelease checks, docs, and package
smoke tests.

### Risks

Signing can add cost and process friction. Linux verification must not imply
platform signing guarantees that do not exist.

### Rollback Plan

Keep unsigned distribution path documented and keep beta tags before stable
promotion.

### Data Migration And Rollback

No app data migration.

### Tests And Evidence

Package smoke tests, distribution audit, updater metadata checks, and release
notes verification. The configuration evidence gate is
`npm run m2:distribution:trust -- --output artifacts/v1/m2-distribution-trust.json --require-ready`.
After package builds are available, run `npm run m2:package-smoke:current` on
each platform and make the same audit strict with `--require-package-smoke`.
The v1 release-candidate gate also consumes
`artifacts/v1/m2-distribution-trust.json` through
`npm run v1:milestone:audit -- --m2-trust-file artifacts/v1/m2-distribution-trust.json --require-acceptance-evidence`,
where M2 remains blocked until Windows, macOS, and Linux package-smoke records
are attached.

### User Documentation

Update RELEASING, README install sections, and platform caveats.

### Acceptance Results

Audit scaffold implemented. It verifies platform installer targets,
electron-updater metadata, release workflow safety, Linux checksum/GPG posture,
and documented unsigned fallback for macOS/Windows. Package-smoke evidence can
now be recorded per platform and consumed by the M2 audit, but real
Windows/macOS/Linux records are not captured yet. Strict v1 milestone
acceptance now consumes the M2 audit output and treats missing package-smoke
platforms as release-candidate blockers.

### Known Gaps

Current mac signing and Windows signing remain deferred unless the project
chooses recurring developer-account/certificate cost. Real package-smoke
evidence from completed release workflow runs is not attached yet, so strict
v1 acceptance is expected to block on M2 until those records exist.

### Next Stage Tasks

Proceed to M3 IPC and secret governance.

## M3 - IPC Validation, Permissions, Secrets, And Audit Logs

### Objective

Unify Electron IPC with request/response validation, permission checks, secret
protection, and high-risk operation audit records.

### Problem Analysis

Renderer access to native capabilities must be narrow, typed, permissioned, and
auditable before task execution grows.

### Technical Design

Introduce a central IPC contract registry, validation helpers, permission
policy, secret vault boundaries, and append-only audit log records for
high-risk operations. The first private-safe audit inventory is maintained in
`docs/V1_M3_IPC_SECURITY.md` and `scripts/m3-ipc-security-audit.mjs`; runtime
high-risk invocation audit is installed through `electron/ipc/auditedIpc.js`
before eager and deferred handlers register.

### Impact Scope

Electron main/preload IPC, renderer bridge types, settings permissions, vault
storage, tests, and developer docs.

### Risks

Breaking existing renderer calls is the largest risk. Migration must be
incremental and compatibility-preserving.

### Rollback Plan

Keep old handlers behind compatibility wrappers until each contract is proven.

### Data Migration And Rollback

No bulk data migration at first; secret metadata may need versioned envelopes
with rollback to existing vault reads.

### Tests And Evidence

Contract tests for request and response schemas, permission denial tests, and
audit-log redaction tests. The current M3 strict inventory gate is
`npm run m3:ipc:audit -- --require-full-validation --require-high-risk-audit --output artifacts/v1/m3-ipc-security.json`.
It verifies preload/handler alignment, event sources, trusted sender coverage,
vault refs, full request validation, redacted high-risk invocation audit, and
the append-only audit inventory baseline. The v1 milestone audit consumes the
generated `artifacts/v1/m3-ipc-security.json` summary and can make it blocking
with `--require-acceptance-evidence` for release-candidate checks.

### User Documentation

Document permission categories and high-risk confirmation behavior.

### Acceptance Results

Initial audit inventory, full request validation, and high-risk invocation
audit are implemented. Current evidence reports 169 IPC handlers, 169 preload
invoke channels, 16 preload subscriptions, no missing handler coverage, no
missing trusted sender checks, and a ready vault refs boundary. All 101
payload-taking handlers have schema, manual, or bounded-special-case request
validation. All 124 high-risk handlers are covered by direct audit calls or the
global redacted IPC audit wrapper. The strict M3 audit baseline is now `ready`.
Strict v1 milestone acceptance now consumes the M3 audit output and treats
missing trusted sender coverage, request validation, secret-boundary readiness,
global high-risk audit coverage, or append-only audit-log readiness as
release-candidate blockers.

### Known Gaps

Response validation and the central permission policy are not implemented yet.
User-visible confirmation copy is still distributed across feature surfaces
instead of generated from a central IPC contract registry.

### Next Stage Tasks

Introduce response validation for high-risk IPC contracts, then promote the
static inventory into a central IPC contract registry with user-visible
confirmation and audit explanations. Proceed to M4 only once IPC boundaries are
enforceable enough for storage migration work.

## M4 - Main-Process SQLite Storage Migration

### Objective

Move chat, memory, permission, and audit-log persistence away from heavy
localStorage use into main-process SQLite.

### Problem Analysis

Long-lived companion data needs reliable migration, rollback, export, and
cross-window consistency.

### Technical Design

Add a versioned SQLite store in the main process, read-through migration from
existing storage, integrity checks, backups, and rollback tooling. The first
private-safe inventory scaffold is maintained in
`docs/V1_M4_STORAGE_MIGRATION.md` and
`scripts/m4-storage-migration-audit.mjs`; it classifies localStorage keys and
direct storage access before any runtime migration is enabled. The first
main-process SQLite foundation uses built-in `node:sqlite` through
`electron/services/sqliteStorage.js` and is audited with
`npm run m4:sqlite:foundation`; it creates schema, backup, rollback, local
storage migration ledger, migration event, localStorage snapshot backup, and
structured chat/memory copy tables. The renderer-facing `storage:status` IPC is
read-only, trusted-sender checked, high-risk-audited, and response-validated; it
returns schema/table readiness and redacted status only, never absolute database
paths or localStorage values. `storage:backup-local-snapshot` provides the first bounded,
non-destructive chat/memory/relationship snapshot backup path: values are
written only to a local private backup file and SQLite ledger, while the
renderer response exposes only counts, keys, file name, and hash.
`storage:copy-local-snapshot` then copies an existing backup into schema v3 chat
and memory tables, records copied/skipped copy items, keeps relationship state
backed up but skipped, preserves source localStorage, and keeps read-through
migration disabled. `m4:storage:snapshot-copy:evidence` runs those backup and
copy paths from sample or private renderer-export input and emits a redacted
evidence report for M4 inventory consumption. `m4:storage:restore:evidence`
then reconstructs an existing backup into a private manual-confirmed restore
bundle, verifies hashes, records a migration event, and emits a redacted
restore evidence report without mutating source localStorage.
`storage:read-through-preview` exposes the copied-row preview through the
trusted preload bridge, and `m4:storage:read-through:evidence` proves the main
process can query the structured chat/memory SQLite copy and return only
redacted counts, source key names, safe aggregates, and readiness flags while
leaving runtime read-through disabled. `m4:storage:downgrade:evidence` proves
the offline rollback side of this slice by exporting a restore bundle, writing a
private database backup, and downgrading schema v3 structured copy tables back
to the v2 snapshot/ledger layer without exposing user values in the public
report.

### Impact Scope

Electron services, storage helpers, memory/chat hooks, import/export flows,
tests, and migration docs.

### Risks

Data loss and partial migration are the critical risks.

### Rollback Plan

Keep source localStorage data until migration is verified and provide a restore
command from backup.

### Data Migration And Rollback

Version every table, write backups before mutation, and provide downgrade or
restore instructions for each schema version.

### Tests And Evidence

Migration fixtures, rollback tests, corruption handling tests, and packaged
smoke verification. The initial inventory gate is
`npm run m4:storage:audit -- --require-inventory-ready --output artifacts/v1/m4-storage-migration.json`.
The current SQLite foundation gate is
`npm run m4:sqlite:foundation -- --require-ready --output artifacts/v1/m4-sqlite-foundation.json`;
then rerun the inventory gate with
`--sqlite-foundation-file artifacts/v1/m4-sqlite-foundation.json` so the M4
report records the built-in SQLite selection. Focused IPC coverage is included
in `tests/storage-ipc.test.ts`, `tests/storage-local-snapshot-backup.test.ts`,
`tests/m4-storage-snapshot-copy-evidence.test.ts`,
`tests/m4-storage-restore-evidence.test.ts`,
`tests/m4-storage-read-through-evidence.test.ts`, and
`tests/ipc-bridge-contract.test.ts`.
The stricter migration gate is intentionally not ready yet:
`npm run m4:storage:audit -- --require-migration-ready`. The v1 milestone
audit consumes `artifacts/v1/m4-storage-migration.json` and treats M4 as
incomplete under `--require-acceptance-evidence` until `migrationReady` is
true.

### User Documentation

Document local data location, export, backup, and recovery.

### Acceptance Results

Inventory scaffold implemented. It captures private-safe storage key names,
source files, domain coverage, direct localStorage/sessionStorage access
counts, SQLite dependency status, and migration guardrails without reading
stored values. SQLite foundation scaffolding is implemented with built-in
`node:sqlite`, schema version 3, private-safe backup/rollback/migration ledger
tables, localStorage snapshot backup run/item tables, structured copy run/item
tables, and chat/memory/source-reference tables. `storage:status` is
wired through preload and main-process IPC with response validation and path
redaction. `storage:backup-local-snapshot` is wired for bounded
chat/memory/relationship backups, request/response validation, source
localStorage preservation, and path/value redaction. `storage:copy-local-snapshot`
is wired for bounded structured copies from an existing backup id into chat and
memory tables, with private-safe counts/keys only and runtime migration still
disabled. `storage:read-through-preview` is wired for renderer-visible,
trusted-sender preview summaries over copied chat/memory rows.
`m4:storage:snapshot-copy:evidence` is wired for sample or private
renderer-export backup+copy evidence, and M4 inventory can consume that report.
`m4:storage:restore:evidence` is wired for sample or private renderer-export
backup+restore evidence, and M4 inventory can consume that report.
`m4:storage:read-through:evidence` is wired for sample or private
renderer-export backup+copy+preview-query evidence, and M4 inventory can
consume that report. `m4:storage:downgrade:evidence` is wired for sample or
private renderer-export backup+copy+restore+downgrade evidence, and M4
inventory can consume that report.
Runtime read-through migration is not enabled, source localStorage remains the
fallback source of truth, and strict v1 acceptance remains blocked on M4.

### Known Gaps

Electron packaged-runtime `node:sqlite` behavior still needs package smoke
evidence. Runtime read-through fallback, automatic restore application,
in-app downgrade UX, and cross-platform migration evidence are not implemented
yet; snapshot backup, structured copy, restore bundle export, read-through
preview IPC, schema downgrade evidence, and their evidence gates exist but are
not yet a full migration or relationship-state migration.

### Next Stage Tasks

Run snapshot backup plus structured copy evidence against a real renderer
export, run restore, read-through, and downgrade evidence against a real
renderer export, wire runtime read-through behind a user-confirmed feature
flag, add automatic restore and corruption fixtures, capture packaged SQLite
smoke evidence, then proceed to M5 white-box memory after persistence is stable.

## M5 - White-Box Long-Term Memory

### Objective

Make long-term memory viewable, editable, deletable, exportable, recall-pausable,
and source-traceable.

### Problem Analysis

Companion memory must be user-owned and explainable before it becomes more
autonomous.

### Technical Design

Build on Memory Map and source refs, add export/import governance, recall pause
semantics, citation metadata, and storage-backed edit history.

### Impact Scope

Memory feature modules, settings memory UI, storage, recall ranking, docs, and
evidence scripts.

### Risks

Edits can desynchronize vector recall, summaries, or source refs.

### Rollback Plan

Keep edit history and support restore from previous memory snapshots.

### Data Migration And Rollback

Memory schema changes require versioned migration and reversible snapshot
exports.

### Tests And Evidence

Memory edit/delete/export tests, source jump tests, recall pause tests, and
private-safe memory-map evidence.

### User Documentation

Explain what Nexus remembers, how to edit it, and how to pause recall.

### Acceptance Results

Not started.

### Known Gaps

Current v0.4 memory-map evidence is partial proof, not the final storage-backed
v1.0 memory system.

### Next Stage Tasks

Proceed to M6 presence state once memory ownership is stable.

## M6 - Desktop Presence State Machine

### Objective

Make the desktop companion accurately show idle, thinking, listening, speaking,
error, waiting-confirmation, and away states.

### Problem Analysis

Desktop presence is core to Nexus; mismatched state erodes trust.

### Technical Design

Centralize presence state transitions, wire Live2D actions, quiet reasons,
voice states, task states, and error states into one observable model.

### Impact Scope

Pet feature, voice hooks, chat runtime, task runtime, settings diagnostics, and
Live2D action maps.

### Risks

State loops can cause high CPU or visual churn.

### Rollback Plan

Keep old visual cues as fallback and make the new presence model feature-gated
until measured.

### Data Migration And Rollback

No user data migration expected.

### Tests And Evidence

State transition tests, Live2D action-map evidence, CPU idle checks, and long
session smoke tests.

### User Documentation

Document visible states and quiet reasons.

### Acceptance Results

Not started.

### Known Gaps

Requires real runtime soak evidence beyond unit tests.

### Next Stage Tasks

Proceed to M7 voice reliability.

## M7 - Voice Reliability And Lazy Loading

### Objective

Make voice input, TTS, VAD, interruption, and lip sync reliable while loading
heavy modules only when needed.

### Problem Analysis

Voice is sensory continuity, but it must not make the idle app heavy or fragile.

### Technical Design

Keep push-to-talk as baseline, add diagnostics, interruption handling, lazy
module loading, provider policy, and measured latency budgets.

### Impact Scope

Voice features, provider catalog, pet lip sync, build chunks, settings
diagnostics, and evidence scripts.

### Risks

Audio-device differences can make local results inconsistent.

### Rollback Plan

Retain text chat and push-to-talk fallback; keep local adapter choices advanced
or beta until measured.

### Data Migration And Rollback

Voice settings changes must tolerate missing provider fields and allow reverting
to previous provider settings.

### Tests And Evidence

Voice diagnostics, first-audio smoke tests, interruption tests, and bundle
analysis.

### User Documentation

Document first setup, troubleshooting, and fallback behavior.

### Acceptance Results

Not started.

### Known Gaps

Local TTS adapter smoke is currently optional for v0.4.

### Next Stage Tasks

Proceed to M8 local knowledge and citations.

## M8 - Local Files, Light RAG, And Citations

### Objective

Add local file indexing, light RAG, citations, and personal knowledge-base
retrieval without cloud sync.

### Problem Analysis

The companion should help with personal context only under clear local and
permissioned boundaries.

### Technical Design

Add scoped file indexing, chunk metadata, retrieval citations, permissioned
folder selection, and per-source disable/export controls.

### Impact Scope

Desktop permissions, storage, retrieval, chat prompt enrichment, settings, and
docs.

### Risks

Indexing too broadly can violate privacy or consume too many resources.

### Rollback Plan

Require explicit folder grants and provide index deletion controls.

### Data Migration And Rollback

Index schema must be versioned and disposable; source files remain untouched.

### Tests And Evidence

Indexer tests, citation tests, permission denial tests, and resource budget
checks.

### User Documentation

Explain what is indexed, where it is stored, and how to delete it.

### Acceptance Results

Not started.

### Known Gaps

No v1.0 file-index schema has been accepted yet.

### Next Stage Tasks

Proceed to M9 authorized task execution.

## M9 - Tool Registry And Authorized Task Execution

### Objective

Introduce Tool Registry, Planner/Executor separation, and a task lifecycle with
preview, confirmation, pause, cancel, and execution reports.

### Problem Analysis

Task assistance must be permissioned and auditable before Nexus can safely act
on behalf of the user.

### Technical Design

Separate planning from execution, classify tool risk, require confirmations for
high-risk actions, and persist task/audit records.

### Impact Scope

Tools, tasks, IPC permissions, audit logs, UI confirmations, docs, and tests.

### Risks

Over-automation can conflict with the companion positioning and create safety
risks.

### Rollback Plan

Keep executor disabled by default and allow tasks to remain preview-only.

### Data Migration And Rollback

Task and audit schemas must be versioned, exportable, and restorable.

### Tests And Evidence

Tool policy tests, planner/executor tests, audit-log tests, and user
confirmation flow tests.

### User Documentation

Document permission tiers, confirmations, and task reports.

### Acceptance Results

Not started.

### Known Gaps

Requires M3 IPC and permission work first.

### Next Stage Tasks

Proceed to M10 advanced opt-in surfaces.

## M10 - MCP, Plugins, Roles, And Advanced Automation

### Objective

Open MCP, plugins, more role models, and advanced automation only after core
privacy, memory, presence, voice, and task execution are stable.

### Problem Analysis

Advanced surfaces can dilute the product if they arrive before the companion
core is trustworthy.

### Technical Design

Gate advanced integrations behind explicit opt-in settings, scoped permissions,
capability descriptions, lifecycle cleanup, and audit evidence.

### Impact Scope

MCP client, plugin loading, role/profile model, settings, permission policy,
docs, and release gates.

### Risks

Plugins and arbitrary automation create supply-chain, privacy, and maintenance
risks.

### Rollback Plan

Keep all advanced surfaces disabled by default and removable without data loss.

### Data Migration And Rollback

Plugin and role schemas need versioning; disabling a plugin must preserve user
data and remove runtime access.

### Tests And Evidence

Lifecycle tests, permission tests, plugin disable tests, and release audit
coverage.

### User Documentation

Document opt-in scope, permissions, and removal.

### Acceptance Results

Not started.

### Known Gaps

This milestone is intentionally last and should not start until M1-M9 evidence
is credible.

### Next Stage Tasks

Prepare the v1.0 release candidate audit.
