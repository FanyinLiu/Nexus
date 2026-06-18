# Nexus v1.0 M3 IPC Security Inventory

This note is the implementation contract for the first M3 step. It turns the
Electron IPC surface into a private-safe audit inventory before the project
starts changing handler contracts one by one.

## Objective

Make IPC validation, trusted sender checks, vault refs, permission posture, and
audit inventory visible enough that future M3 hardening can be incremental and
release-gated.

## Problem Analysis

Nexus already has many IPC hardening pieces: preload exposes a narrow API,
`requireTrustedSender(event)` is common, `payloadSchemas.js` validates many
request payloads, vault reads return opaque refs, and audit logs exist for some
high-risk actions. The risk is that these protections are spread across files.
Without a single inventory, new handlers can quietly skip validation or audit
records.

## Technical Design

`scripts/m3-ipc-security-audit.mjs` statically reads `electron/preload.js`,
`electron/ipcRegistry.js`, `electron/ipc/auditedIpc.js`,
`electron/ipc/*.js`, `electron/services/auditLog.js`, and vault ref helpers.
It produces `artifacts/v1/m3-ipc-security.json` with:

- every `ipcMain.handle` channel, file, line, payload count, trusted sender
  status, request validation status, high-risk category, audit usage, and vault
  ref resolution usage;
- preload invoke and subscription coverage;
- trusted sender coverage;
- request validation coverage, including known unvalidated payload channels;
- high-risk audit coverage;
- global high-risk IPC wrapper evidence proving redacted invocation audit is
  installed before eager and deferred handler registration;
- secret-boundary checks proving vault retrieval returns vault refs instead of
  renderer-visible plaintext;
- append-only audit log baseline checks.

The default `--require-ready` mode is intentionally an inventory gate. It
blocks missing handler coverage, missing event sources, missing trusted sender
checks, broken vault refs, and broken audit log baseline. The current strict
M3 gate also passes full request validation and high-risk audit coverage:

```bash
npm run m3:ipc:audit -- --require-full-validation
npm run m3:ipc:audit -- --require-high-risk-audit
```

## Impact Scope

Electron IPC files, preload contract, IPC registry, global IPC audit wrapper,
vault reference helpers, audit log service, `package.json` scripts/build
metadata, v1 milestone governance, and developer docs.

## Risks

Static parsing can miss dynamic IPC patterns, but Nexus currently uses literal
channel names for `ipcMain.handle` and `ipcRenderer.invoke`. The audit is not a
substitute for runtime permission tests; it is a regression net and work queue.

## Rollback Plan

Remove `electron/ipc/auditedIpc.js`, the `installHighRiskIpcAudit(...)` call
from `electron/ipcRegistry.js`, `scripts/m3-ipc-security-audit.mjs`, the
`m3:ipc:audit` package script, the M3 evidence gate entry in
`scripts/v1-milestone-audit.mjs`, and this document. No persisted data is
changed.

## Data Migration And Rollback

No data migration. The report copies only channel names, file paths, line
numbers, booleans, counts, and known gap ids. It does not copy payload values,
API keys, vault plaintext, chat text, memory bodies, local file contents,
plugin messages, or audit log entries.

## Tests And Evidence

Run:

```bash
npm run m3:ipc:audit -- --require-ready --output artifacts/v1/m3-ipc-security.json
npm run m3:ipc:audit -- --require-full-validation --require-high-risk-audit --output artifacts/v1/m3-ipc-security.json
node --experimental-strip-types --test tests/m3-ipc-security-audit.test.ts tests/v1-milestone-audit.test.ts
npm run v1:milestone:audit -- --require-ready --output artifacts/v1/milestone-audit.json
npm run v1:milestone:audit -- --m3-ipc-security-file artifacts/v1/m3-ipc-security.json --require-acceptance-evidence
```

Release-candidate M3 hardening can keep `--require-full-validation` and
`--require-high-risk-audit` in the gate. The top-level v1 audit now consumes
the M3 JSON summary and blocks strict acceptance when trusted sender coverage,
request validation, high-risk audit coverage, the vault-ref secret boundary,
global redacted audit, or append-only audit-log readiness are not green.
Response validation and a central IPC contract registry are the remaining M3
hardening slices.

## User Documentation

This is developer-facing security infrastructure. User-facing permission text
will be added as the next M3 slices move high-risk actions behind visible
confirmations and audit explanations.

## Acceptance Results

Inventory, full request validation, and high-risk audit coverage are
implemented. Current evidence shows 169 IPC
handlers, 169 preload invoke channels, 16 preload subscriptions, zero missing
invoke handlers, zero handlers hidden from preload, zero missing subscription
sources, and zero missing trusted sender checks. Vault retrieve and retrieve
many return vault refs, while 12 outbound channels resolve refs inside the main
process before provider/network work. All 101 payload-taking handlers now have
schema, manual, or bounded-special-case request validation. All 124 high-risk
handlers are audited either directly or by the global redacted IPC wrapper,
which records channel, category, sender kind, duration, and outcome without
copying payload values, return values, file contents, message text, or secrets.

The current strict M3 audit baseline is `ready` for request validation,
trusted-sender coverage, vault-ref boundaries, and high-risk audit coverage.
`v1:milestone:audit -- --require-acceptance-evidence` now includes this M3
report as release-candidate acceptance evidence rather than only checking that
the script and document exist.

## Known Gaps

- Response shape validation is not implemented.
- Permission policy is still distributed across settings/features instead of a
  central IPC contract registry.
- User-visible high-risk confirmation copy is still distributed across feature
  surfaces and should be consolidated as the permission registry lands.

## Next Stage Tasks

- Introduce response validation for high-risk IPC contracts.
- Promote the static inventory into a central IPC contract registry once the
  existing handlers are classified and covered.
- Consolidate user-visible confirmation and audit explanations on top of that
  registry.
