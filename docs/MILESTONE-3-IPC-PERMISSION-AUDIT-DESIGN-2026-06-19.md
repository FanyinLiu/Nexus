# Milestone 3 Design - IPC Contract, Permission, and Audit Baseline

## Problem Analysis

M0 established the repo baseline, M1 made first-run/model setup measurable, and
M2 made release trust posture explicit. The next v1.0 blocker is the renderer to
main-process boundary.

Current state:

- The renderer reaches native capabilities through `window.desktopPet`, which
  maps to `ipcRenderer.invoke` and `ipcRenderer.on` calls in `electron/preload.js`.
- Main-process handlers are split across `electron/ipc/*.js`.
- Many channels already use `requireTrustedSender(event)` and some have schema
  validators in `electron/ipc/payloadSchemas.js`.
- High-risk surfaces already exist: vault, desktop context, files, plugins,
  MCP, external links, integrations, local model/runtime control, and memory
  vector operations.
- There was no single source of truth that listed every renderer-callable IPC
  channel, its handler file, sender trust coverage, payload validation posture,
  risk class, audit hint, and permission hint.

The immediate risk is not one isolated missing handler. It is drift: future
changes could add renderer-visible channels without review, or high-risk
channels could remain hard to prioritize because the gaps are not visible in a
repeatable report.

## Technical Design

M3 should tighten the IPC boundary in small slices:

1. Add a source-only IPC contract audit that parses `electron/preload.js` and
   `electron/ipc/*.js` with the TypeScript parser.
2. Fail only on structural errors first: missing handlers, duplicate handlers,
   missing trusted-sender checks, or subscription channels without a main-process
   event source.
3. Report, but do not yet fail, the existing hardening gaps: renderer payloads
   without centralized schema/manual validation, high-risk handlers without an
   explicit audit call, and high-risk handlers without a visible permission or
   confirmation hint.
4. Integrate the audit into `npm run distribution:audit` so release verification
   cannot ignore IPC surface drift.
5. Later slices can turn specific warning classes into hard errors channel by
   channel after compatibility tests exist.

The audit is intentionally static. It does not import Electron, start the app,
read local app data, inspect keychain/safeStorage, read environment variables,
or inspect secret values.

## Impact Scope

- `scripts/ipc-contract-audit.mjs`
- `scripts/distribution-audit.mjs`
- `package.json` scripts
- focused tests under `tests/`
- architecture, roadmap, changelog, and this milestone record

This slice does not change IPC runtime behavior, preload API names, renderer
types, user data, settings, secrets, storage, plugins, MCP behavior, or release
workflow.

## Risks

- Static analysis can miss dynamic behavior. The first slice treats this as a
  guardrail and prioritization report, not a proof that every channel is fully
  safe.
- The risk classifier is conservative and may label some channels as high risk
  even when the downstream service has additional protection.
- Warning counts will change as IPC channels evolve. That is expected; future
  changes should update the report expectations and then tighten the relevant
  class deliberately.

## Rollback Plan

- Revert `scripts/ipc-contract-audit.mjs`, the `ipc:audit` npm script,
  `distribution:audit` integration, focused tests, and docs.
- No user data or migration rollback is required.
- Runtime IPC behavior remains unchanged if the audit is removed.

## Acceptance Criteria

- `npm run ipc:audit` inventories every preload invoke channel and every
  main-process `ipcMain.handle` channel.
- The audit exits non-zero if a preload invoke lacks a handler, a handler is
  duplicated, a handler lacks `requireTrustedSender(event)`, or a subscription
  channel has no main-process event source.
- The audit reports risk classes and current warning gaps without reading user
  data, keychain state, environment variables, or secret values.
- `npm run distribution:audit` includes the IPC contract audit.
- Focused tests cover the current inventory counts, risk classification, and
  privacy boundary.

## Implementation Slice 1 - IPC Inventory Audit Gate

Status: implemented in this branch; full M3 remains open.

Completed:

- Added `npm run ipc:audit`.
- Added a TypeScript-AST based source audit for:
  - preload invoke channels,
  - preload subscription channels,
  - main-process handler channels,
  - missing/duplicate handlers,
  - trusted sender coverage,
  - payload validation posture,
  - high-risk channel classification,
  - audit and permission/confirmation hints.
- Integrated the audit into `npm run distribution:audit`.
- Added focused tests for inventory counts, high-risk channel classification,
  schema/manual/no-payload detection, and static-source privacy boundaries.

Current measured baseline:

- 169 preload invoke channels.
- 16 preload subscription channels.
- 169 main-process handler channels.
- 36 high-risk handler channels.
- Risk coverage: 88 low, 45 medium, 36 high.
- Payload validation coverage: 52 schema, 31 manual, 86 none.
- Structural errors: 0 missing handlers, 0 duplicate handlers, 0 missing
  trusted-sender checks, 0 missing subscription sources.
- Warnings: 18 payload-bearing channels without visible validation, 23
  high-risk channels without visible audit calls, and 33 high-risk channels
  without visible permission/confirmation hints.

Not completed yet:

- The warning classes are not yet hard failures.
- Response schemas are not yet required for every channel.
- High-risk permissions and audit records are not yet unified under one
  main-process policy service.
- Renderer-facing vault retrieval still needs later M3/M4/M5 review as part of
  the broader secret and storage migration work.

Known risks:

- Existing warnings identify real hardening work and must not be treated as
  completed security controls.
- Some warnings may already be mitigated inside downstream services; those
  mitigations still need to be recorded explicitly before the warning can be
  retired.

Validation results:

- `npm run ipc:audit` passed with 169 preload invoke channels, 16 preload
  subscription channels, 169 main handler channels, 36 high-risk handler
  channels, 74 warnings, and 0 structural errors.
- `node --experimental-strip-types --test tests/ipc-contract-audit.test.ts
  tests/ipc-bridge-contract.test.ts tests/ipc-payload-schema.test.ts` passed
  21 focused IPC tests.
- `npm run distribution:audit` passed with the IPC contract audit included.
- `npm run lint` passed.
- `npm test` passed 1881 tests across 68 suites.
- `npm run build` passed.
- `npm run release:trust:audit` passed with 7 OK, 2 documented warnings, and 0
  errors.
- `npm run i18n:audit` passed across all five locales with 2089 keys each.
- `npm run package:dir:smoke` passed; the packaged macOS app loaded the
  renderer and remained on unsigned check-only update mode.
- `git diff --check` passed.

Packaged-smoke notes:

- The local smoke build still uses ad-hoc macOS signing and skips notarization.
- KWS/SenseVoice models were not installed in this environment.
- Python sidecars skipped OmniVoice and GLM-ASR because `torch` is not
  installed.

Suggested next M3 slice:

- Pick one high-risk warning cluster, preferably `file:*`,
  `desktop-context:get`, or external integration send/execute channels, and add
  explicit request schema, permission/confirmation behavior, audit record, and
  compatibility tests before turning that cluster's warning into a hard gate.

## Implementation Slice 2 - File Dialog IPC Schema and Audit

Status: implemented in this branch; full M3 remains open.

Problem:

- `file:save-text` and `file:open-text` are high-risk because they cross the
  renderer/main boundary into local file read/write flows.
- They already used native save/open dialogs, which are a clear user
  confirmation point, but the handler payloads were not covered by the shared
  IPC schema layer and the file operations were not recorded in the audit log.
- The M3 Slice 1 audit therefore reported both channels in the payload,
  high-risk audit, and permission/confirmation warning buckets.

Design:

- Add explicit text-file request schemas for:
  - save title,
  - default file name,
  - content,
  - open title,
  - dialog filters and extensions.
- Keep compatibility with existing chat, memory, yearbook, and letter
  import/export flows by allowing up to 10 MB of text content per file payload.
- Treat the native save/open dialog as the required user confirmation point.
- Add audit entries around dialog open/result events using metadata only:
  action, title, default file name for saves, content length, filter count,
  canceled status, and file extension. Do not log file content or full file
  paths.
- Teach `ipc:audit` to recognize the file dialog helper functions as a
  permission/confirmation hint.

Rollback:

- Revert the file schemas, `windowIpc` validation/audit additions, audit-script
  permission-hint update, tests, and docs.
- The previous native dialog behavior returns unchanged. No user data or
  migration rollback is required.

Known risks:

- Audit records intentionally avoid full paths to reduce privacy exposure, so
  they prove that a file operation was requested/completed without identifying
  the exact local file location.
- Larger legacy archives over 10 MB now fail validation before opening a native
  save/write path. This is a deliberate guardrail; future storage migration
  work should move large chat/memory export flows to streamed main-process
  export rather than unbounded renderer payloads.

Validation results:

- `node --experimental-strip-types --test tests/ipc-contract-audit.test.ts
  tests/ipc-bridge-contract.test.ts tests/ipc-payload-schema.test.ts` passed
  23 focused IPC tests.
- `npm run ipc:audit` passed with 169 preload invoke channels, 16 preload
  subscription channels, 169 main handler channels, 36 high-risk handler
  channels, 68 warnings, and 0 structural errors. The `file:*` channels are no
  longer present in the payload-validation, high-risk audit, or
  permission/confirmation warning buckets.
- `npm run distribution:audit` passed with the IPC contract audit included.
- `npm run lint` passed.
- `npm test` passed 1883 tests across 68 suites.
- `npm run build` passed.
- `npm run i18n:audit` passed across all five locales with 2089 keys each.
- `npm run release:trust:audit` passed with 7 OK, 2 documented warnings, and 0
  errors.
- `npm run package:dir:smoke` passed; the packaged macOS app loaded the
  renderer and remained on unsigned check-only update mode.
- `git diff --check` passed.

Packaged-smoke notes:

- The local smoke build still uses ad-hoc macOS signing and skips notarization.
- KWS/SenseVoice models were not installed in this environment.
- Python sidecars skipped OmniVoice and GLM-ASR because `torch` is not
  installed.

Suggested next M3 slice:

- Tighten `desktop-context:get` next: make active-window, clipboard, and
  screenshot access go through explicit permission labels, audit metadata, and
  response shape tests without logging captured content.

## Implementation Slice 3 - Desktop Context Metadata Audit

Status: implemented in this branch; full M3 remains open.

Problem:

- `desktop-context:get` can return active-window title/app/process path,
  clipboard text, and screenshot data URL. These are intentionally powerful
  local-first context features, but the high-risk IPC audit previously had no
  explicit audit record for when the channel was requested or what broad data
  categories were returned.
- Logging raw desktop context would violate the privacy boundary, because window
  titles, clipboard contents, file paths, and screenshot data can contain user
  secrets.

Design:

- Keep the existing request schema and policy gate.
- Add a pure audit-summary helper that records only metadata:
  - requested capabilities,
  - policy-allowed capabilities,
  - enabled capabilities,
  - whether each result category is present,
  - string lengths for active-window, clipboard, display name, and screenshot
    data URL fields.
- Add handler audit entries for request/result events.
- Add tests proving the audit summaries exclude the actual window title,
  clipboard text, screenshot data URL, and process path.
- Make `DesktopContextRequest.policy` explicit in shared renderer types, because
  the renderer already sends that policy object.

Rollback:

- Revert `electron/ipc/desktopContextAudit.js`, the `windowIpc` audit calls, the
  type addition, tests, and docs.
- Runtime desktop context capture still works as before. No data migration or
  user-data rollback is required.

Known risks:

- Metadata-only audit records prove capability access without preserving enough
  detail to reconstruct what the user was doing. That is intentional for
  privacy, but deeper incident review may require reproducing settings and
  runtime state rather than reading audit contents.
- Screenshot data URL length is recorded as metadata. It does not expose image
  content, but still indicates that a screenshot was captured.

Validation results:

- Focused IPC/desktop-context tests passed:
  `node --experimental-strip-types --test tests/desktop-context.test.ts tests/ipc-contract-audit.test.ts tests/ipc-bridge-contract.test.ts tests/ipc-payload-schema.test.ts`
  - 29 tests passed.
- Full test suite passed:
  - `npm test`
  - 1885 tests passed, 0 failed.
- Build and static checks passed:
  - `npm run lint`
  - `npm run build`
  - `git diff --check`
- Audit gates passed:
  - `npm run ipc:audit`
  - `npm run distribution:audit`
  - `npm run i18n:audit`
  - `npm run release:trust:audit`
- IPC audit baseline after this slice:
  - 169 preload invoke channels.
  - 16 preload subscription channels.
  - 169 main handler channels.
  - 36 high-risk handler channels.
  - 67 warnings, 0 errors.
  - `desktop-context:get` is no longer in the high-risk-without-audit warning
    bucket.
- Packaged smoke passed:
  - `npm run package:dir:smoke`
  - macOS arm64 directory package launched and loaded the renderer.
- Known environment notes:
  - Release trust audit still reports the expected unsigned macOS and Windows
    warnings for the current local/CI posture.
  - Packaged smoke still reports missing KWS/SenseVoice models and disabled
    torch-backed Python sidecars in this environment.

Suggested next M3 slice:

- Tighten external action channels next, such as Discord/Telegram send,
  Minecraft command, and Factorio execute, by adding explicit confirmation
  state and audit records before execution.

## Implementation Slice 4 - External Action Metadata Audit

Status: implemented and validated in this branch; full M3 remains open.

Problem:

- External action IPC channels can send messages, upload voice payloads, execute
  game commands, call MCP tools, or reconcile MCP server processes:
  - `telegram:send-message`
  - `telegram:send-voice`
  - `discord:send-message`
  - `discord:send-voice`
  - `minecraft:send-command`
  - `factorio:execute`
  - `mcp:call-tool`
  - `mcp:sync-servers`
- These channels already require trusted senders, and MCP process/tool approval
  exists deeper in `mcpHost`, but the IPC layer did not record a stable audit
  entry for the request/result boundary.
- Raw audit logging would be unsafe because outbound text, audio payloads,
  game commands, channel/chat IDs, MCP commands, tool names, and tool arguments
  can contain private data.

Design:

- Add a pure `externalActionAudit` summarizer that records only metadata:
  - channel, integration, and action kind,
  - target ID presence and length,
  - outbound text/audio/command lengths,
  - MCP server/tool/argument shape counts,
  - result kind, key count, response length, and error name/message length.
- Wire request/result audit entries around the external action handlers after
  payload validation and before execution.
- Record failed execution attempts with metadata-only error summaries, then
  rethrow the original error so callers keep existing behavior.
- Promote Telegram and Discord send payload validation to shared IPC schemas.
- Teach the IPC contract audit to recognize the shared
  `runAuditedExternalAction(...)` wrapper as an audit record.
- Leave the remaining permission warning in place. This slice does not pretend
  renderer-side settings are a trusted main-process confirmation boundary.

Rollback:

- Revert `electron/ipc/externalActionAudit.js`, the audit wrapper calls in
  Telegram/Discord/game/MCP IPC handlers, the Telegram/Discord payload schemas,
  and the related tests/docs.
- Runtime behavior falls back to the previous direct execution path. No data
  migration or user-data rollback is required.

Known risks:

- This slice creates an auditable execution record but does not yet enforce a
  main-process permission policy for external actions. The IPC audit therefore
  still reports these channels in `highRiskWithoutPermissionHint`.
- Length-only records are intentionally privacy-preserving; they prove that an
  action happened but cannot reconstruct the exact message, command, target, or
  MCP payload.
- MCP server/tool approvals remain in `mcpHost`; this slice only adds the IPC
  request/result audit boundary above that service.

Validation results:

- Focused tests passed:
  `node --experimental-strip-types --test tests/external-action-audit.test.ts tests/ipc-payload-schema.test.ts tests/ipc-contract-audit.test.ts`
  - 21 tests passed.
- Full test suite passed:
  - `npm test`
  - 1890 tests passed, 0 failed.
- Build and static checks passed:
  - `npm run lint`
  - `npm run build`
  - `git diff --check`
- IPC audit passed:
  - `npm run ipc:audit`
  - 59 warnings, 0 errors.
  - `highRiskWithoutAudit` dropped from 20 to 12.
  - External action channels are no longer in the high-risk-without-audit
    warning bucket.
- Audit gates passed:
  - `npm run distribution:audit`
  - `npm run i18n:audit`
  - `npm run release:trust:audit`
- Packaged smoke passed:
  - `npm run package:dir:smoke`
  - macOS arm64 directory package launched and loaded the renderer.
- Known environment notes:
  - Release trust audit still reports the expected unsigned macOS and Windows
    warnings for the current local/CI posture.
  - Packaged smoke still reports missing KWS/SenseVoice models and disabled
    torch-backed Python sidecars in this environment.

Suggested next M3 slice:

- Move external action permission policy into the main process so send/execute
  channels can distinguish read-only, confirm, and auto modes without trusting
  renderer-supplied settings.

## Implementation Slice 5 - Main-Process External Action Policy

Status: implemented and validated in this branch; full M3 remains open.

Problem:

- Slice 4 made external actions auditable, but the permission decision still
  lived primarily in renderer settings and helper checks.
- Renderer settings are useful UI state, but they are not a trusted execution
  boundary for high-risk actions such as sending messages, executing game
  commands, calling MCP tools, or syncing MCP server processes.
- The existing default MCP setting is `auto`, but prompting for auto mode when
  no MCP server is configured would create noisy first-run behavior.

Design:

- Add a main-process external action policy service:
  - default every integration to `confirm`,
  - persist accepted modes in `external-action-policy.json` under Electron
    `userData` with `0600` permissions,
  - block send/execute/configure actions in `read-only`,
  - show a native per-action confirmation dialog in `confirm`,
  - allow execution without per-action prompts in `auto`.
- Add `external-action-policy:get` and `external-action-policy:sync` IPC:
  - renderer sends only mode plus active/configured booleans,
  - no API keys, tokens, target IDs, server commands, args, or allowlists cross
    this IPC boundary,
  - moving an active integration to `auto` requires native main-process
    confirmation before the policy is persisted.
- Treat inactive `auto` requests as `confirm` until the integration is actually
  configured. This avoids a startup prompt for the default empty MCP server
  list while still requiring approval when an enabled server appears.
- Gate Telegram, Discord, Minecraft, Factorio, and MCP external action handlers
  through the main-process policy before executing their existing actions.
- Keep metadata-only request/result audit from Slice 4 and add policy decision
  audit events for allow/deny/confirmation/escalation outcomes.
- Skip the initial empty MCP sync in the renderer hook. Removing the last MCP
  server after a non-empty configuration still sends an empty sync and goes
  through the main-process policy.

Rollback:

- Revert `externalActionPolicy*.js`, `externalActionPolicyIpc.js`, the preload
  and type additions, the settings-store sync hook, the MCP empty-sync guard,
  and related tests/docs.
- Delete `external-action-policy.json` from Electron `userData` if a local test
  run created it. No existing chat, memory, key, or integration configuration
  migration is required.

Known risks:

- A rejected `auto` escalation remains rejected only in the main-process policy;
  if renderer settings still say `auto`, a later settings sync can ask again.
  This is conservative but may be noisy until settings UI reflects the
  main-process policy status.
- Native confirmation dialogs show action category and channel, but they do not
  yet render a rich preview of the exact outgoing message/command/tool payload.
  That keeps this slice small and avoids adding another renderer trust surface.
- This is still a JSON policy file, not the final SQLite-backed permission
  store planned for later milestones.

Validation results:

- Focused tests passed:
  `node --experimental-strip-types --test tests/external-action-policy.test.ts tests/ipc-payload-schema.test.ts tests/ipc-contract-audit.test.ts`
  - 25 tests passed.
- Settings sync tests passed:
  `node --experimental-strip-types --test tests/settings-store.test.ts tests/settings-store-broadcast.test.ts tests/external-action-policy.test.ts`
  - 9 tests passed.
- Full test suite passed:
  - `npm test`
  - 1897 tests passed, 0 failed.
- Build and static checks passed:
  - `npm run lint`
  - `npm run build`
  - `git diff --check`
- IPC audit passed:
  - `npm run ipc:audit`
  - 51 warnings, 0 errors.
  - External action channels are no longer in the high-risk-without-permission
    warning bucket.
- Audit gates passed:
  - `npm run distribution:audit`
  - `npm run i18n:audit`
  - `npm run release:trust:audit`
- Packaged smoke passed:
  - `npm run package:dir:smoke`
  - macOS arm64 directory package launched and loaded the renderer without a
    startup confirmation dialog.
- Known environment notes:
  - Release trust audit still reports the expected unsigned macOS and Windows
    warnings for the current local/CI posture.
  - Packaged smoke still reports missing KWS/SenseVoice models and disabled
    torch-backed Python sidecars in this environment.

Suggested next M3 slice:

- Continue reducing the remaining 51 IPC warnings by addressing local artifact
  and plugin bus high-risk channels, especially pet-model import/create/install
  and plugin-bus publish/subscribe paths.

## Implementation Slice 6 - Pet Model Local Artifact IPC Hardening

Status: completed and validated in this branch.

Problem:

- Pet-model IPC channels can import Live2D/Sprite packages, download community
  Codex pets, create creator kits in Documents, assemble packages, install
  packages into the local Codex pets directory, and open local paths.
- Several service functions already enforce important safety rules, such as
  ZIP path checks, private Codex path rejection, manifest validation, and
  "target path must stay inside kit directory" checks.
- The IPC layer still lacked consistent request schemas, metadata-only audit,
  and main-process confirmation for renderer-supplied path or remote-import
  actions.

Design:

- Add pet-model payload schemas for:
  - Codex gallery import input,
  - gallery catalog query,
  - creator-kit create payloads,
  - optional/direct kit directory payloads,
  - install-to-Codex payloads,
  - open/reveal path payloads.
- Add a pure pet-model audit summarizer that records only metadata:
  - action/channel,
  - input/path lengths and presence,
  - whether a flow is backed by a native file/directory dialog,
  - result category, cancellation, model presence, warning counts, message
    length, and output path lengths.
- Keep paths, URLs, slugs, model IDs, labels, command contents, and error text
  out of audit records.
- Wrap high-risk pet-model handlers in a shared `runAuditedPetModelAction`.
- Treat native file/directory pickers as the confirmation point for
  dialog-backed flows:
  - `pet-model:import`,
  - `pet-model:create-from-image`,
  - `pet-model:inspect-creator-kit` without a direct path,
  - `pet-model:assemble-creator-kit` without a direct path.
- Add a native main-process confirmation dialog for direct renderer-triggered
  local artifact operations:
  - `pet-model:import-codex-gallery`,
  - `pet-model:create-creator-kit`,
  - `pet-model:inspect-creator-kit` with `kitDirectory`,
  - `pet-model:assemble-creator-kit` with `kitDirectory`,
  - `pet-model:install-creator-kit-codex`,
  - `pet-model:open-creator-kit-path`.

Rollback:

- Revert `electron/ipc/petModelAudit.js`, the pet-model payload schemas, the
  pet-model wrapper calls in `windowIpc`, the IPC audit recognition update, and
  related tests/docs.
- Runtime falls back to the previous pet-model service paths. No user-data
  migration is required; already imported/generated pet packages remain on
  disk.

Known risks:

- Direct inspect/assemble calls now prompt even when the renderer is passing a
  path returned by an earlier trusted operation. This is intentionally
  conservative until M3 has a richer main-process artifact capability ledger.
- Audit records are length-only for local paths and remote inputs, so they prove
  a pet-model operation happened but cannot reconstruct exact filenames or
  URLs.
- The underlying service can still return user-facing messages with paths to
  the renderer. That is existing UI behavior and separate from audit-log
  privacy.

Validation results:

- Focused tests passed:
  `node --experimental-strip-types --test tests/pet-model-audit.test.ts tests/ipc-payload-schema.test.ts tests/ipc-contract-audit.test.ts`
  - 25 tests passed.
- IPC audit passed:
  - `npm run ipc:audit`
  - 30 warnings, 0 errors.
  - `payloadWithoutValidation` dropped from 16 to 9.
  - `highRiskWithoutAudit` dropped from 12 to 5.
  - `highRiskWithoutPermissionHint` dropped from 23 to 16.
  - Pet-model local artifact channels are no longer in the high-risk warning
    buckets.
- Lint passed:
  - `npm run lint`
- Full regression suite passed:
  - `npm test`
  - 1902 tests passed.
- Production build passed:
  - `npm run build`
- Release and localization gates passed:
  - `npm run distribution:audit`
  - `npm run i18n:audit`
  - `npm run release:trust:audit`
  - Release trust remains at the documented interim posture: 7 OK, 2
    warnings for unsigned macOS and Windows artifacts.
- Packaged app smoke passed:
  - `npm run package:dir:smoke`
  - Expected local optional-model warnings remain: KWS/SenseVoice sidecars are
    not installed, and Python torch-backed speech sidecars are disabled.
- Whitespace check passed:
  - `git diff --check`

Suggested next M3 slice:

- Address the remaining plugin bus and plugin lifecycle high-risk warnings by
  adding main-process ownership checks, metadata-only audit, and explicit
  permission boundaries for publish/subscribe/lifecycle actions.

## Implementation Slice 7 - Plugin IPC Permission and Audit Boundary

Status: completed and validated in this branch.

Problem:

- Plugin lifecycle IPC can start, stop, restart, enable, disable, approve, and
  revoke local plugin execution state from the renderer.
- The plugin host already performs command-trust checks and prompts when a new
  or changed plugin command needs approval, but the IPC layer does not provide a
  consistent metadata-only request/result audit trail or a visible permission
  boundary for every state-changing lifecycle action.
- Plugin bus publish/subscribe/unsubscribe IPC is high risk because it changes
  extension communication state and can carry arbitrary plugin message payloads.
  Current handlers validate topic shape and running server identity, but they do
  not write audit records and do not expose a clear permission boundary in the
  IPC contract audit.

Design:

- Add a pure plugin IPC audit summarizer that records only metadata:
  - channel,
  - plugin/server/topic identifier presence and lengths,
  - plugin bus payload kind, key count, array length, and serialized length,
  - result object key count and common boolean/status fields,
  - error name and error message length.
- Keep plugin IDs, server IDs, topics, payload contents, plugin names,
  descriptions, command text, result text, and error text out of audit records.
- Wrap state-changing plugin lifecycle handlers in a shared
  `runAuditedPluginAction` helper:
  - `plugin:start`,
  - `plugin:stop`,
  - `plugin:restart`,
  - `plugin:enable`,
  - `plugin:disable`,
  - `plugin:approve`,
  - `plugin:revoke`.
- Add a native main-process confirmation dialog for lifecycle actions that can
  start or permit local plugin execution:
  - `plugin:start`,
  - `plugin:restart`,
  - `plugin:enable`,
  - `plugin:approve`,
  - `plugin:revoke`.
- Keep `plugin:stop` and `plugin:disable` audited but non-prompting because
  they reduce execution capability rather than grant or run it.
- Wrap plugin bus publish/subscribe/unsubscribe in metadata-only audit and a
  native main-process confirmation dialog. The first implementation still keeps
  trusted sender plus running-server validation as the execution gate, records
  accept/deny metadata, and does not expose message payload content in logs.
- Leave read-only plugin queries (`scan`, `list`, `status`, `dir`,
  `subscriptions`, `recent`, `stats`) unchanged except for existing validation.

Impact scope:

- Electron main-process plugin IPC only.
- No renderer API rename.
- No plugin storage migration.
- No plugin manifest format change.

Rollback:

- Revert the plugin audit helper, plugin IPC wrapper changes, IPC audit script
  recognition update, and related tests/docs.
- Existing plugin host command approval behavior remains the fallback. No user
  data migration or rollback is required.

Known risks:

- Starting, restarting, enabling, approving, or revoking plugins from UI now
  shows an additional IPC-level confirmation before plugin-host command
  approval may run. This is intentionally conservative until Nexus has a full
  white-box permission manager for extensions.
- Plugin bus audit records are metadata-only, so they prove that messaging
  activity occurred but cannot reconstruct exact topics or payloads.
- Plugin bus publish/subscribe/unsubscribe now prompt from the renderer bridge.
  This is conservative and acceptable while the bus has no renderer callers; a
  later M3/MCP phase should move plugin bus publication behind plugin-owned
  main-process capabilities rather than general renderer invocations.

Validation results:

- Focused tests passed:
  `node --experimental-strip-types --test tests/plugin-audit.test.ts tests/ipc-contract-audit.test.ts tests/ipc-payload-schema.test.ts`
  - 26 tests passed.
- IPC audit passed:
  - `npm run ipc:audit`
  - 18 warnings, 0 errors.
  - `highRiskWithoutAudit` dropped from 5 to 2.
  - `highRiskWithoutPermissionHint` dropped from 16 to 7.
  - Plugin lifecycle and plugin bus write channels are no longer in the
    high-risk audit or permission warning buckets.
- Lint passed:
  - `npm run lint`
- Full regression suite passed:
  - `npm test`
  - 1906 tests passed.
- Production build passed:
  - `npm run build`
- Release and localization gates passed:
  - `npm run distribution:audit`
  - `npm run i18n:audit`
  - `npm run release:trust:audit`
  - Release trust remains at the documented interim posture: 7 OK, 2
    warnings for unsigned macOS and Windows artifacts.
- Packaged app smoke passed:
  - `npm run package:dir:smoke`
  - Expected local optional-model warnings remain: KWS/SenseVoice sidecars are
    not installed, and Python torch-backed speech sidecars are disabled.
- Whitespace check passed:
  - `git diff --check`

Suggested next M3 slice:

- Address the remaining high-risk warning buckets:
  - `tool:open-external` needs metadata-only audit plus an explicit
    confirmation/permission boundary for renderer-triggered external
    navigation.
  - Vault channels need a clearer permission/audit contract in the IPC audit,
    especially `vault:is-available`, retrieval, storage, deletion, and
    listing. Existing vault audit records must remain secret-safe and renderer
    access to plaintext secrets must stay blocked.

## Implementation Slice 8 - External Link IPC Audit Boundary

Status: completed and validated in this branch.

Problem:

- `tool:open-external` is high risk because it asks the OS to open a URL
  outside Nexus.
- The existing built-in tool implementation already validates URL safety and
  shows a native confirmation dialog immediately before `shell.openExternal`.
- The IPC handler lacks a metadata-only request/result audit trail, so the IPC
  contract audit still reports the channel in `highRiskWithoutAudit`.

Design:

- Keep the existing main-process confirmation and URL safety guard in
  `open_external_link`; do not add a second confirmation dialog.
- Add a pure external-link audit summarizer that records only metadata:
  - input URL length,
  - parsed protocol when safely available,
  - hostname/path/search/hash presence and lengths,
  - renderer tool policy booleans,
  - result success, normalized URL length, message length, and error metadata.
- Keep full URLs, hostnames, paths, query strings, fragments, and error text out
  of audit records.
- Wrap `tool:open-external` in a request/result audit boundary before and after
  `invokeRegisteredTool`.

Impact scope:

- Electron main-process external-link IPC only.
- No renderer API rename.
- No URL normalization or allow/deny policy change.
- No user-data migration.

Rollback:

- Revert the external-link audit helper, the `tool:open-external` wrapper in
  `windowIpc`, the IPC contract test expectation, and related docs.
- External link behavior falls back to the existing validation and confirmation
  path.

Known risks:

- Audit records only prove that an external-link operation occurred; they cannot
  reconstruct the destination.
- The confirmation dialog still displays the full normalized URL to the user so
  they can make an informed decision. That user-facing display is intentionally
  separate from audit-log privacy.

Validation results:

- Focused tests passed:
  `node --experimental-strip-types --test tests/external-link-audit.test.ts tests/ipc-contract-audit.test.ts tests/ipc-payload-schema.test.ts`
  - 27 tests passed.
- IPC audit passed:
  - `npm run ipc:audit`
  - 17 warnings, 0 errors.
  - `highRiskWithoutAudit` dropped from 2 to 1.
  - `tool:open-external` is no longer in the high-risk audit warning bucket.
- Lint passed:
  - `npm run lint`
- Full regression suite passed:
  - `npm test`
  - 1910 tests passed.
- Production build passed:
  - `npm run build`
- Release and localization gates passed:
  - `npm run distribution:audit`
  - `npm run i18n:audit`
  - `npm run release:trust:audit`
  - Release trust remains at the documented interim posture: 7 OK, 2
    warnings for unsigned macOS and Windows artifacts.
- Packaged app smoke passed:
  - `npm run package:dir:smoke`
  - Expected local optional-model warnings remain: KWS/SenseVoice sidecars are
    not installed, and Python torch-backed speech sidecars are disabled.
- Whitespace check passed:
  - `git diff --check`

Suggested next M3 slice:

- Address the remaining vault IPC warnings. `vault:is-available` needs
  metadata-only audit, and vault read/write/list/delete handlers need an
  explicit permission contract in the IPC audit while preserving the invariant
  that renderer cannot receive plaintext secrets directly.

## Implementation Slice 9 - Vault IPC Secret-Safe Audit and Permission Contract

Status: completed and validated in this branch.

Problem:

- Vault IPC is high risk because it stores, deletes, lists, and issues access
  references for API keys and other secrets.
- The renderer-facing vault retrieval channels already issue opaque
  `nexus-vault-ref:` tokens instead of returning plaintext secret values, and
  bulk/single retrieval paths already have rate limits.
- The audit log currently records exact slot names for several vault actions.
  Slot names are less sensitive than plaintext values, but they can still reveal
  which providers, profiles, or integrations a user configured.
- `vault:is-available` does not write an audit record, and the IPC contract
  audit cannot currently identify the vault permission boundary for the
  read/write/list/delete channels.

Design:

- Add a pure vault audit summarizer that records only metadata:
  - action/channel,
  - slot presence and slot-name length,
  - plaintext length or entry value length,
  - slot count and aggregate slot-name length for batch operations,
  - result kind, boolean availability, ref token counts, returned slot counts,
    and error metadata.
- Keep plaintext secret values, slot names, vault ref tokens, and error text out
  of audit records.
- Wrap vault handlers in a shared `runAuditedVaultAction` helper so every
  vault IPC action has request/result audit coverage, including
  `vault:is-available`.
- Treat the vault permission contract as:
  - trusted sender gate,
  - strict slot/entry validation,
  - opaque per-sender refs instead of plaintext return values,
  - rate limiting for enumeration-prone list and retrieve paths,
  - metadata-only audit records.
- Do not add native confirmation prompts to startup/settings hydration paths.
  Those calls are part of normal first-run and settings save/load behavior; the
  safer boundary is to keep plaintext in main-process services and issue
  revocable refs to the renderer.
- Update the IPC contract audit to recognize `runAuditedVaultAction` as both
  audit and permission coverage.

Impact scope:

- Electron main-process vault IPC only.
- No renderer API rename.
- No vault file format change.
- No migration or rollback data operation.

Rollback:

- Revert the vault audit helper, vault IPC wrapper changes, IPC audit script
  recognition update, and related tests/docs.
- Existing vault storage, opaque ref issuance, and rate limits remain the
  fallback behavior.

Known risks:

- Existing renderer settings hydration still receives opaque refs and stores
  them in memory so later main-process IPC can resolve them. This preserves the
  current compatibility model but still means a compromised renderer could try
  to use refs until process-local refs expire or the app restarts.
- Metadata-only audit cannot reconstruct exact slots after an incident. This is
  intentional to avoid turning the audit log into a map of configured secrets.
- `vault:list-slots` still returns slot names to the renderer for compatibility.
  A later storage migration should reduce or replace this surface once settings
  metadata is moved into main-process SQLite.

Validation results:

- Focused tests passed:
  `node --experimental-strip-types --test tests/vault-audit.test.ts tests/ipc-contract-audit.test.ts`
  - 14 tests passed.
- IPC audit passed:
  - `npm run ipc:audit`
  - 9 warnings, 0 errors.
  - `highRiskWithoutAudit` dropped from 1 to 0.
  - `highRiskWithoutPermissionHint` dropped from 7 to 0.
  - Remaining warnings are payload-validation backlog outside the high-risk
    audit/permission buckets.
- Lint passed:
  - `npm run lint`
- Full regression suite passed:
  - `npm test`
  - 1914 tests passed.
- Production build passed:
  - `npm run build`
- Release and localization gates passed:
  - `npm run distribution:audit`
  - `npm run i18n:audit`
  - `npm run release:trust:audit`
  - Release trust remains at the documented interim posture: 7 OK, 2
    warnings for unsigned macOS and Windows artifacts.
- Packaged app smoke passed:
  - `npm run package:dir:smoke`
  - Expected local optional-model warnings remain: KWS/SenseVoice sidecars are
    not installed, and Python torch-backed speech sidecars are disabled.
- Whitespace check passed:
  - `git diff --check`

Suggested next M3 slice:

- Address the remaining 9 non-high-risk payload-validation warnings:
  `integrations:inspect`, `kws:start`, `kws:status`, `models:download`, and
  the TTS streaming lifecycle channels. These are lower risk than the cleared
  secret, filesystem, external-action, plugin, pet-model, desktop-context, and
  external-link buckets, but they should still receive explicit request shape
  bounds before M3 closes.

## Implementation Slice 10 - Remaining IPC Payload Shape Boundaries

Status: completed and validated in this branch.

Problem:

- M3 high-risk audit and permission warnings are cleared, but
  `npm run ipc:audit` still reports 9 payload-validation warnings.
- These channels are not in the high-risk audit/permission buckets, but they
  still accept renderer payloads and should have explicit request boundaries
  before M3 closes:
  - `integrations:inspect`,
  - `kws:status`,
  - `kws:start`,
  - `vad:start`,
  - `models:download`,
  - `tts:stream-start`,
  - `tts:stream-push-text`,
  - `tts:stream-finish`,
  - `tts:stream-abort`.

Design:

- Add schema validators matching the existing renderer-facing TypeScript
  request shapes and current call sites.
- Keep compatibility-oriented defaults for optional startup payloads:
  - KWS payload defaults to `{}`,
  - VAD payload defaults to `{}`,
  - TTS lifecycle payloads keep current required fields.
- Clamp long text/config strings where existing behavior can safely accept a
  bounded value; reject missing required fields such as `modelId`, `requestId`,
  and pushed TTS text.
- Do not change service behavior, return values, model download policy, or
  voice runtime state machines.

Impact scope:

- Electron IPC payload schema definitions and four handler modules:
  - `windowIpc`,
  - `sherpaIpc`,
  - `ttsStreamIpc`,
  - shared `payloadSchemas`.
- No renderer API rename.
- No data migration or rollback operation.

Rollback:

- Revert the added schemas, handler validation calls, IPC contract tests, and
  docs. Runtime falls back to the previous permissive handler behavior.

Known risks:

- Malformed renderer payloads that previously flowed through to service-level
  best-effort handling may now fail at the IPC boundary with a clear validation
  error.
- TTS pushed text is capped to the same broad body-text budget used elsewhere
  in IPC. Very large single segments should already be chunked before reaching
  this path.

Validation results:

- Focused tests passed:
  `node --experimental-strip-types --test tests/ipc-payload-schema.test.ts tests/ipc-contract-audit.test.ts`
  - 27 tests passed.
- IPC audit passed:
  - `npm run ipc:audit`
  - 0 warnings, 0 errors.
  - Payload validation coverage is now 75 schema, 27 manual, 69 none.
  - `payloadWithoutValidation`, `highRiskWithoutAudit`, and
    `highRiskWithoutPermissionHint` are all empty.
- Full regression suite passed:
  - `npm test`
  - 1916 tests passed, 0 failed.
- Build and static checks passed:
  - `npm run build`
  - `npm run lint`
  - `git diff --check`
- Release, packaging, and documentation audit gates passed:
  - `npm run distribution:audit`
  - `npm run i18n:audit`
  - `npm run release:trust:audit`
  - `npm run package:dir:smoke`
- Known environment notes:
  - Release trust audit still reports the expected unsigned macOS and Windows
    warnings for the current local/CI posture.
  - Packaged smoke still reports missing optional KWS/SenseVoice models and
    disabled torch-backed Python sidecars in this environment.

Suggested next milestone:

- Start M4 with the main-process SQLite storage foundation: define the storage
  adapter, migration ledger, rollback strategy, and first small migration away
  from renderer `localStorage` while keeping existing user data intact.
