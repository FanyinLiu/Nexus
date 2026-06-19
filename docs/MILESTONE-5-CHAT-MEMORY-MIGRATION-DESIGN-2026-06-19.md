# Milestone 5 - Chat and Memory Migration

Goal: move heavy, long-lived user data out of renderer `localStorage` domain by
domain while preserving existing user data, rollback options, and privacy
boundaries.

M5 starts with chat sessions because M4 already created a SQLite `chat-sessions`
domain, an explicit migration write path, rollback, and metadata-only status
summary. Memory migration remains out of scope until the chat storage authority
switch is proven.

Current authority:

- Renderer `localStorage` remains the default read/write source for live chat.
- Main-process SQLite can store migrated chat-session records, but those records
  are not yet used by the live chat runtime.
- No production renderer IPC returns SQLite chat records yet.

## Implementation Slice 1 - Service-only Chat Session Readback

Status: completed and validated in this branch.

Problem:

- M4 proved that a confirmed migration package can write chat sessions into
  SQLite, but the main process did not yet have a reusable content-bearing read
  path for the chat domain.
- The next M5 steps need a tested repository boundary before any renderer-facing
  history read, import, or runtime authority switch can be considered.
- Returning migrated chat content to the renderer is a larger privacy and UX
  decision, so the first readback must stay service-only.

Design:

- Add `readChatLocalDataSessions()` to the main-process local-data service.
- Initialize the local-data foundation, read the `chat-sessions` domain, parse
  and normalize each stored session with the existing chat migration schema, and
  sort valid sessions by `lastActiveAt` descending.
- Return a content-bearing service result with:
  - `recordPayloadsIncluded: true`
  - `recordCount`
  - `validSessionCount`
  - `messageCount`
  - `malformedRecordCount`
  - `sessions`
- Do not add preload, renderer IPC, UI, or default runtime reads in this slice.
- Keep existing metadata-only status behavior unchanged: the hidden Settings
  status summary still reports counts and audit metadata only.

Impact scope:

- Main-process local-data service.
- Local-data service tests.
- Roadmap, architecture, and changelog documentation.

No new dependency:

- The slice reuses the existing `node:sqlite` foundation and local-data schema.

Migration:

- No automatic migration is performed.
- No schema migration is required; the function reads existing schema version `3`
  `local_data_records`.
- Existing renderer `localStorage` chat history remains authoritative.

Rollback:

- Remove `readChatLocalDataSessions()` and its test assertions.
- Existing localStorage and SQLite data remain untouched.
- Hidden apply/rollback/status paths continue to work independently.

Known risks:

- This is a content-bearing main-process service function. It is intentionally
  not exposed to renderer IPC in this slice.
- Malformed SQLite chat records are counted and skipped without leaking parse
  details to renderer-facing surfaces.
- This does not yet reduce renderer `localStorage` usage; it only proves the
  main-process repository can read migrated content for future slices.

Validation results:

- Focused check passed:
  - `node --experimental-strip-types --test tests/local-data-store.test.ts`
  - 9 tests passed.
- Full gates passed:
  - `node --experimental-strip-types --test tests/local-data-store.test.ts tests/ipc-contract-audit.test.ts`
  - 21 focused tests passed.
  - `npm run i18n:audit` - 2157 keys, 0 missing/extra/duplicate across all locales.
  - `npm run ipc:audit` - 176 preload invoke channels, 176 main handler channels, 0 warnings, 0 errors.
  - `npm run build`
  - `npm run lint`
  - `npm test` - 1935 tests passed.
  - `npm run package:dir:smoke`
  - `git diff --check`
- Known environment notes:
  - Node still emits `ExperimentalWarning` for `node:sqlite`.
  - Packaged smoke still reports optional missing KWS/SenseVoice models,
    disabled torch-backed Python sidecars, ad-hoc macOS signing in smoke mode,
    and Electron builder/Node deprecation warnings in this environment.

Acceptance results:

- Main process can read back a migrated SQLite chat session with message content.
- Tests prove the service result omits the userData path.
- Tests prove the hidden metadata-only status result still excludes private chat
  content, titles, and source session IDs.
- Tests prove rollback removes SQLite chat-session records and service readback
  returns an empty session list after rollback.

## Implementation Slice 2 - Hidden Runtime Chat SQLite Mirror

Status: completed and validated in this branch.

Problem:

- Slice 1 proved service-only SQLite readback, but live chat still had no
  low-risk rehearsal for ongoing writes.
- Switching chat authority directly from renderer `localStorage` to SQLite
  would combine write-risk, read-risk, and UX-risk in one change.
- The next safe step is a hidden mirror that can observe the current live chat
  session write path without making SQLite authoritative or returning chat
  content to the renderer.

Design:

- Add `mirrorChatLocalDataSession()` to the main-process local-data service.
- Require explicit `confirmed: true` on every mirror request.
- Reuse the existing chat migration session schema so the IPC boundary rejects
  unknown fields and bounds message content before any SQLite write.
- Gate the IPC handler behind the existing main-process flag
  `NEXUS_ENABLE_LOCAL_DATA_CHAT_MIGRATION=1`.
- Gate the renderer mirror behind both
  `VITE_NEXUS_ENABLE_LOCAL_DATA_CHAT_RUNTIME_MIRROR=1` and a hidden Settings
  history checkbox that stores explicit local consent.
- Keep renderer `localStorage` authoritative. The live chat save effect still
  writes localStorage first, then debounces a best-effort SQLite mirror.
- Write or delete only the current session record in the SQLite `chat-sessions`
  domain. Empty-message snapshots delete that mirrored record.
- Write content-free local-data audit records for mirror and delete outcomes.
  Audit payloads include counts and result metadata, not session IDs, titles,
  message text, or userData paths.
- Do not add renderer SQLite readback, history restore, memory migration, or
  default production enablement in this slice.

Impact scope:

- Main-process local-data service and IPC bridge.
- Preload/type declarations.
- Chat persistence hook.
- Hidden Settings history panel.
- IPC contract audit and focused storage/schema tests.
- Roadmap, architecture, changelog, and this milestone document.

No new dependency:

- The slice reuses existing SQLite, IPC schema, audit, chat normalization, and
  Settings confirmation infrastructure.

Migration:

- No automatic migration is performed.
- No schema migration is required; the mirror uses the existing schema version
  `3` `local_data_records` table and `chat-sessions` domain.
- Existing renderer `localStorage` remains the source of truth and is not
  deleted or rewritten.

Rollback:

- Disable `VITE_NEXUS_ENABLE_LOCAL_DATA_CHAT_RUNTIME_MIRROR` or remove the
  hidden Settings consent to stop renderer mirror attempts.
- Disable `NEXUS_ENABLE_LOCAL_DATA_CHAT_MIGRATION` to make the main-process
  mirror IPC return a disabled metadata result.
- Use the existing hidden chat migration rollback path to delete migrated or
  mirrored SQLite `chat-sessions` records without touching localStorage.
- Code rollback is additive: remove the mirror service, IPC handler, preload
  method, runtime helper, hook call, and tests.

Known risks:

- This is a content-bearing IPC write path when both flags and hidden consent
  are enabled. It remains disabled by default and does not expose SQLite records
  back to the renderer.
- The mirror is best-effort and debounced; localStorage remains authoritative if
  a mirror request fails.
- Existing SQLite `node:sqlite` experimental warnings remain unchanged.
- This slice still does not reduce renderer `localStorage` storage size.

Validation results:

- Focused checks passed:
  - `node --experimental-strip-types --test tests/local-data-store.test.ts tests/ipc-payload-schema.test.ts tests/ipc-contract-audit.test.ts tests/chat-storage.test.ts`
  - 45 focused tests passed.
  - `npm run i18n:audit` - 2165 keys, 0 missing/extra/duplicate across all locales.
  - `npm run ipc:audit` - 177 preload invoke channels, 177 main handler channels, 0 warnings, 0 errors.
  - `npm run build`
  - `npm run lint`
- Full gates passed:
  - `npm test` - 1937 tests passed.
  - `npm run package:dir:smoke`
  - `git diff --check`
- Known environment notes:
  - Node still emits `ExperimentalWarning` for `node:sqlite`.
  - Packaged smoke still reports optional missing KWS/SenseVoice models,
    disabled torch-backed Python sidecars, ad-hoc macOS signing in smoke mode,
    and Electron builder/Node deprecation warnings in this environment.

Acceptance results:

- Runtime mirror requires explicit service confirmation; unconfirmed calls do
  not create a SQLite database.
- The hidden renderer control requires a build flag plus local user consent.
- The IPC contract is high-risk classified, schema-validated, trusted-sender
  checked, permission-hinted, and audit-covered.
- Mirrored service responses and audit records return only counts/status
  metadata, not private chat content or session identifiers.
- Empty current-session snapshots delete only the mirrored session record.

## Implementation Slice 3 - Hidden Chat Memory SQLite Comparison

Status: completed and focused-validation passed in this branch.

Product boundary:

- This slice supports Nexus as a companion with local, transparent chat memory.
- It does not add Planner/Executor behavior, autonomous task execution, or a
  Codex-style work agent surface.
- The goal is safer future memory migration: users and developers need a way to
  tell whether localStorage and SQLite are aligned before any restore or storage
  authority switch is considered.

Problem:

- Slice 2 can mirror live chat sessions into SQLite, but there was no safe way
  to compare renderer localStorage metadata with SQLite metadata.
- Reading full SQLite chat content back into the renderer is still too broad for
  this stage.
- A future authority switch needs evidence about missing, extra, stale, or
  malformed records without exposing message bodies.

Design:

- Add `compareChatLocalDataSessions()` to the main-process local-data service.
- Add a hidden IPC path, `local-data:chat-comparison-preview`, behind the same
  disabled-by-default main-process gate:
  `NEXUS_ENABLE_LOCAL_DATA_CHAT_MIGRATION=1`.
- Require `confirmed: true` for every comparison request.
- The renderer builds a source summary from normalized local chat sessions and
  sends only:
  - session ID
  - `startedAt`
  - `lastActiveAt`
  - message count
  - normalized payload byte size
- The renderer does not send message text, titles, reasoning content, tool
  payloads, images, or full chat records for comparison.
- The main process reads SQLite `chat-sessions`, compares metadata, and returns
  aggregate counts only:
  - source/SQLite session counts
  - matched/aligned/missing/extra/mismatched record counts
  - malformed SQLite record count
  - source/SQLite message counts and delta
  - source/SQLite aggregate byte sizes
  - issue codes
- The result always sets `recordPayloadsIncluded: false` and never returns
  SQLite chat records, titles, message text, userData paths, or session IDs.
- The service writes a content-free `local-data-audit` record for each confirmed
  comparison.
- The hidden Settings history panel shows only the aggregate comparison result.

Impact scope:

- Main-process local-data service and IPC bridge.
- Preload/type declarations.
- Hidden Settings history panel.
- Chat migration preview metadata helper.
- IPC contract audit, payload schema tests, local-data tests, and preview tests.
- Roadmap, architecture, changelog, and this milestone document.

No new dependency:

- The slice reuses existing SQLite, IPC schema, audit, chat normalization, and
  hidden Settings confirmation infrastructure.

Migration:

- No automatic migration is performed.
- No schema migration is required; comparison reads existing schema version `3`
  `chat-sessions` records and writes only a metadata audit event.
- Existing renderer `localStorage` remains authoritative.

Rollback:

- Disable `NEXUS_ENABLE_LOCAL_DATA_CHAT_MIGRATION` to disable the comparison
  IPC path.
- Remove the comparison service, IPC handler, preload method, hidden UI section,
  metadata helper, and tests.
- Existing localStorage and SQLite chat-session records remain untouched.

Known risks:

- The comparison request sends local session IDs and metadata to the main
  process. It does not send message text or titles, and the response does not
  return session IDs.
- Byte-size comparison can detect many metadata/content-shape differences, but
  it is not a cryptographic content equality proof.
- This slice still does not reduce renderer `localStorage` storage size and
  does not switch live chat authority.

Validation results:

- Focused checks passed:
  - `node --experimental-strip-types --test tests/local-data-store.test.ts tests/ipc-payload-schema.test.ts tests/ipc-contract-audit.test.ts tests/chat-migration-dry-run.test.ts tests/chat-storage.test.ts`
  - 54 focused tests passed.
  - `npm run i18n:audit` - 2185 keys, 0 missing/extra/duplicate across all locales.
  - `npm run ipc:audit` - 178 preload invoke channels, 178 main handler channels, 0 warnings, 0 errors.
  - `npm run build`
  - `npm run lint`
- Final 0.3.5 gates passed after documentation/version synchronization:
  - `npm run verify:release` - typecheck, lint, 1939 tests passed, build,
    SQLite smoke, and distribution audit all passed.
  - `npm run package:dir:smoke` - production build, unsigned macOS directory
    package, and packaged renderer launch smoke all passed.
  - `npm run i18n:audit` - 2185 keys, 0 missing/extra/duplicate across all
    locales.
  - `npm run ipc:audit` - 178 preload invoke channels, 178 main handler
    channels, 41 high-risk channels, 0 warnings, 0 errors.
  - `git diff --check` - passed.

Acceptance results:

- Unconfirmed comparison calls do not create a SQLite database.
- The comparison IPC is high-risk classified, schema-validated, trusted-sender
  checked, permission-hinted, and audit-covered.
- Tests prove comparison responses and audit records exclude private message
  content and source session IDs.
- Tests prove the renderer comparison source strips chat text and titles before
  IPC.
- The hidden Settings panel can show aggregate alignment/difference counts
  without reading SQLite chat records back into the renderer.

Suggested next M5 slice:

- Do not move into an agent/task system. Continue companion-memory work by
  adding a user-readable memory/chathistory review concept: what Nexus may
  remember, how the user can pause it, and how migrated chat memory will remain
  visible and editable before any authority switch.
