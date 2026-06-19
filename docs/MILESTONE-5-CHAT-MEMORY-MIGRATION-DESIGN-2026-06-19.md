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

## Implementation Slice 4 - Memory Transparency and Pause

Status: implemented in this branch; full validation passed.

Product boundary:

- This slice keeps Nexus companion-first. It does not add planner/executor
  behavior, autonomous task execution, or a work-agent surface.
- The goal is user trust: before memory migration becomes authoritative, users
  must be able to see whether Nexus is actively using memory and pause that
  behavior without deleting existing memories.

Problem:

- The Memory settings page already let users view, edit, delete, import, and
  export memory content, and the storage layer already supported disabled
  individual memories.
- The UI did not expose a clear global memory pause state, and single-memory
  pause/resume was not reachable from the settings panel.
- Users also could not see a concise summary of what memory reads/writes were
  currently active or which storage authority still owned memory data.

Design:

- Add `memoryPaused` to `AppSettings`, defaulting to `false` and normalized on
  settings load.
- Add a pure `resolveMemoryTransparencySummary()` helper that reports:
  - active and disabled long-term memory counts
  - recent daily-entry count
  - whether recall, automatic diary capture, semantic recall, and desktop
    context reads are active
  - that memory and diary storage authority is still renderer `localStorage`
    and SQLite is not authoritative for memory yet
- Add a Memory settings transparency panel with status, counts, context-read
  status, storage-authority note, and a global "pause memory recall and
  learning" toggle.
- Wire the existing per-memory `enabled` field into the Memory panel as
  pause/resume controls.
- Make the chat reply runtime honor `memoryPaused` by sending an empty memory
  recall context, skipping pending memory callbacks, skipping recall feedback,
  and skipping new daily-memory capture.
- Make memory dream consolidation return early while memory is paused.

Impact scope:

- App settings type/default/load normalization.
- Memory settings UI and Memory panel controls.
- Chat reply memory recall/writeback behavior.
- Memory dream scheduling guard.
- i18n keys/locales and focused tests.

No new dependency:

- The slice reuses existing settings, memory, recall, and settings UI
  primitives.

Migration:

- Settings migration is additive. Existing users get `memoryPaused: false`.
- No memory records are moved, rewritten, deleted, or sent to the main process.
- Existing disabled memory records remain disabled.

Rollback:

- Remove the `memoryPaused` field, UI panel, runtime guards, and tests.
- Existing memory and daily-memory localStorage data remains untouched.
- Per-memory `enabled` data is already supported by the storage normalizer and
  can remain harmless if the UI is removed.

Known risks:

- Memory data still lives in renderer `localStorage`; this slice improves
  transparency and pause behavior but does not reduce localStorage size.
- The pause switch intentionally does not delete or redact existing memory
  exports. Users must still use clear/delete/export controls for data changes.
- Desktop context controls remain separate; the transparency panel reports
  whether they are active but does not override them.

Validation results:

- `node --experimental-strip-types --test tests/assistant-reply-failure.test.ts tests/memory-settings-view.test.ts tests/storage-settings.test.ts tests/memory-storage.test.ts tests/chat-storage.test.ts`
  - 33 focused memory/chat/settings tests passed.
- `npm test`
  - 1943 tests passed.
- `npm run lint`
  - passed.
- `npm run i18n:audit`
  - 2201 keys, 0 missing/extra/duplicate across all locales.
- `npm run ipc:audit`
  - passed with 0 errors and 0 warnings.
- `npm run build`
  - `tsc -b` and Vite production build passed.
- `npm run package:dir:smoke`
  - directory packaging and packaged-app smoke test passed on macOS arm64.
- `git diff --check`
  - passed.

Acceptance results:

- Users can globally pause memory recall and learning without deleting memory.
- Users can pause or resume individual long-term memory entries from the Memory
  panel.
- Tests prove paused chat turns receive an empty memory recall context, skip
  pending memory callbacks, and do not append daily-memory entries.
- The Memory settings page reports that renderer `localStorage` remains the
  current memory storage authority and SQLite is not memory-authoritative yet.

## Implementation Slice 5 - Memory Source Trace

Status: implemented in this branch; full validation passed.

Product boundary:

- This slice keeps Nexus companion-first. It does not add planner/executor
  behavior, autonomous task execution, or a work-agent surface.
- The goal is explainable companionship: after Nexus answers, the user should
  be able to tell whether memory shaped the reply without exposing private
  memory text in a new channel.

Problem:

- Slice 4 made memory usage visible at the settings level, but individual
  assistant replies still did not carry a durable memory-source trace.
- The runtime knew which long-term memories and daily entries were recalled,
  but that information disappeared after the request.
- Without a content-minimized trace, later white-box memory UI would have to
  infer provenance from chat text or re-run recall, both of which are weaker
  and less auditable.

Design:

- Add `ChatMemoryTrace` metadata to assistant `ChatMessage` records.
- Store only:
  - memory status (`active` or `paused`)
  - recall search mode
  - vector availability
  - recalled long-term memory IDs
  - recalled daily-entry IDs
  - semantic match IDs
- Add a pure `buildChatMemoryTrace()` helper that builds the metadata from the
  already constructed `MemoryRecallContext`.
- Attach the trace to assistant messages after the model reply is accepted as
  the latest turn.
- Preserve and sanitize traces in chat localStorage normalization; imported or
  malformed traces are clipped to bounded ID arrays and cannot carry memory
  body text.
- Show a subtle message-bubble hint with counts, for example "memory touched
  this reply", "memory was on; nothing was recalled", or "memory was paused".

Impact scope:

- Chat message type and storage normalization.
- Assistant reply message construction.
- Message bubble UI and i18n copy.
- Focused tests for trace generation, storage sanitization, and paused turns.

No new dependency:

- The slice reuses existing memory recall, chat message, and i18n primitives.

Migration:

- Existing chat messages remain valid because `memoryTrace` is optional.
- New assistant messages can include bounded trace metadata in the existing
  renderer localStorage chat/session stores.
- No memory records are moved, rewritten, deleted, or sent to the main process.

Rollback:

- Remove the optional `memoryTrace` field, trace helper, message-bubble hint,
  runtime attachment, and tests.
- Existing chat messages containing `memoryTrace` remain harmless if older code
  ignores unknown fields, or they are stripped by the normalizer after rollback.
- Memory and daily-memory stores remain untouched.

Known risks:

- Trace metadata still lives with renderer chat history until chat authority
  moves to SQLite.
- IDs are useful for future white-box detail views, but the current UI only
  shows counts; resolving IDs back to editable memory entries is a later slice.
- Semantic IDs can overlap with long-term IDs; the UI intentionally reports
  semantic hits separately to avoid pretending they are distinct memories.

Validation results:

- `node --experimental-strip-types --test tests/memory-recall-trace.test.ts tests/chat-storage.test.ts tests/assistant-reply-failure.test.ts`
  - 11 focused memory-trace/chat-storage/assistant-runtime tests passed.
- `npx tsc -b --pretty false`
  - passed.
- `npm run i18n:audit`
  - 2204 keys, 0 missing/extra/duplicate across all locales.
- `npm run lint`
  - passed.
- `npm test`
  - 1945 tests passed.
- `npm run ipc:audit`
  - passed with 0 errors and 0 warnings.
- `npm run build`
  - `tsc -b` and Vite production build passed.
- `npm run package:dir:smoke`
  - directory packaging and packaged-app smoke test passed on macOS arm64.
- `git diff --check`
  - passed.

Acceptance results:

- Assistant messages can carry a bounded `memoryTrace` without duplicating
  private memory or daily-entry body text.
- Paused memory turns explicitly record `status: paused` with empty source ID
  arrays.
- Chat storage normalization preserves valid trace metadata, removes unexpected
  fields, deduplicates trace IDs, and clips arrays.
- The chat bubble shows only a count/status summary, not memory content.
- The slice does not add planner/executor behavior, new permissions, new IPC,
  or new dependencies.

## Implementation Slice 6 - Memory Source Detail View

Status: implemented in this branch; full validation passed.

Product boundary:

- This slice keeps Nexus companion-first. It does not add planner/executor
  behavior, autonomous task execution, or a work-agent surface.
- The goal is white-box memory: a user can expand a reply and see which current
  memory records or daily entries correspond to the stored source trace.

Problem:

- Slice 5 stored content-minimized source trace IDs and showed count summaries,
  but counts alone do not let a user verify which memory influenced a reply.
- Memory records can be edited, paused, or deleted after a reply is generated,
  so the UI must handle missing source IDs explicitly instead of pretending the
  source is still present.
- Opening the Memory settings page from a trace should not require a new IPC
  channel or copying memory text into chat-message metadata.

Design:

- Add a pure `resolveChatMemoryTraceDetails()` helper that resolves a
  `ChatMemoryTrace` against current renderer memory state.
- Resolve:
  - long-term memory IDs to category, enabled/paused status, source, and a
    runtime-only short preview
  - daily-memory IDs to day, role/source, and a runtime-only short preview
  - semantic IDs against both long-term and daily indexes
  - missing IDs as explicit `missing` entries
- Keep the persisted assistant message unchanged: `memoryTrace` still stores
  only status, recall mode, vector availability, and bounded ID arrays.
- Add an expandable message-bubble detail block under the source summary.
- Add a "Manage memories" action that opens Settings directly to the Memory
  section using existing renderer state; no new dependency or IPC is added.

Impact scope:

- Memory trace detail resolver.
- Panel message rendering data flow.
- Message bubble UI and i18n copy.
- Settings drawer section targeting.
- Focused tests for trace detail resolution.

No new dependency:

- The slice reuses existing React state, settings drawer navigation, and memory
  storage primitives.

Migration:

- No stored data is migrated.
- Existing `memoryTrace` metadata remains valid.
- Runtime-only previews are derived from current memory state and are not
  written into chat history, audit logs, or SQLite.

Rollback:

- Remove the detail resolver, message-bubble expandable detail UI, direct
  Memory-section targeting, and focused tests.
- Stored chat messages with `memoryTrace` remain valid because Slice 5 metadata
  is unchanged.
- Memory and daily-memory stores remain untouched.

Known risks:

- Details are based on current renderer-localStorage memory state; they may
  show `missing` after a user deletes or imports memory archives.
- Daily-memory details require the current runtime daily store. If future
  storage authority moves to SQLite, this resolver needs to read through the
  same white-box memory service instead of direct renderer state.
- The detail view is intentionally not an inline editor; edits still happen in
  the Memory settings panel to keep one owner for mutation and confirmation UI.

Validation results:

- `node --experimental-strip-types --test tests/memory-trace-details.test.ts tests/memory-recall-trace.test.ts tests/chat-storage.test.ts tests/assistant-reply-failure.test.ts`
  - 14 focused memory-detail/memory-trace/chat-storage/assistant-runtime tests
    passed.
- `npx tsc -b --pretty false`
  - passed.
- `npm run lint`
  - passed.
- `npm run i18n:audit`
  - 2213 keys, 0 missing/extra/duplicate across all locales.
- `npm test`
  - 1948 tests passed.
- `npm run ipc:audit`
  - passed with 0 errors and 0 warnings.
- `npm run build`
  - `tsc -b` and Vite production build passed.
- `npm run package:dir:smoke`
  - directory packaging and packaged-app smoke test passed on macOS arm64.
- `git diff --check`
  - passed.

Acceptance results:

- Reply memory hints can expand into a detail view grouped by long-term,
  daily, and semantic sources.
- Current long-term memories and daily entries resolve to runtime-only short
  previews; missing IDs are marked explicitly.
- Paused/disabled long-term memories are marked in the detail view.
- The persisted assistant message remains content-minimized; memory previews
  are not written into chat metadata, audit logs, or SQLite.
- The "Manage memories" action opens Settings directly to the Memory section
  without adding new IPC, dependencies, or mutation surfaces.

## Implementation Slice 7 - Memory Source Focus in Settings

Status: implemented in this branch; full validation passed.

Product boundary:

- This slice keeps Nexus companion-first. It does not add autonomous task
  execution, planner/executor behavior, tool calls, or a Codex-style work-agent
  surface.
- The goal is source legibility: when a reply says memory shaped the answer,
  the user can jump to the Memory page and see which remembered preferences or
  diary fragments were involved.

Problem:

- Slice 6 could open Settings directly to Memory, but users still had to scan
  the whole Memory page to find the referenced records.
- The daily preview intentionally shows only recent diary entries; a reply may
  reference an older diary entry that is still present in the store but outside
  that preview.
- Adding inline editing inside chat would duplicate mutation UI and increase
  accidental-delete risk.

Design:

- Add `buildChatMemoryTraceFocus()` to convert a content-minimized
  `ChatMemoryTrace` into deduplicated long-term, daily, and semantic source ID
  lists.
- Carry that focus target through the existing Settings-section navigation path
  when the user opens Memory from a reply source detail.
- Add `mergeFocusedDailyEntries()` so focused diary entries outside the recent
  preview are temporarily included in the Memory panel view.
- Highlight matching long-term memories and diary entries in the Memory panel
  with a small "from this reply" source badge and scroll the first highlighted
  entry into view.
- Keep all previews runtime-only. Persisted assistant messages still store only
  bounded source IDs, not memory text.

Impact scope:

- Memory trace helpers.
- Panel message action wiring.
- App settings-overlay controller data flow.
- Settings drawer and Memory section props.
- Memory panel UI, styling, and locale copy.
- Focused memory trace tests and milestone docs.

No new dependency:

- The slice reuses existing React state, Settings navigation, and Memory panel
  controls.

Migration:

- No stored data is migrated.
- No SQLite schema, localStorage key, IPC contract, or audit-log schema changes.
- Focus targets are runtime-only and disappear when Settings is opened normally.

Rollback:

- Remove the focus helper, focused diary merge helper, Settings focus prop
  plumbing, Memory panel highlight styles, locale key, and focused tests.
- Existing `memoryTrace` metadata and Slice 6 source detail UI remain valid.
- Memory and daily-memory stores remain untouched.

Known risks:

- Highlights reflect current renderer-localStorage memory state. If a referenced
  memory was deleted or archive-imported away, there is nothing to highlight.
- Semantic IDs can refer to long-term or diary entries. The UI highlights a
  matching visible record by ID and leaves unmatched semantic IDs invisible.
- The first highlighted entry scrolls into view after render; if a future
  virtualized Memory list is introduced, this behavior should move to the list
  owner.

Validation results:

- `node --experimental-strip-types --test tests/memory-trace-details.test.ts tests/memory-recall-trace.test.ts tests/chat-storage.test.ts tests/assistant-reply-failure.test.ts`
  - 16 focused memory-detail/focus/memory-trace/chat-storage/assistant-runtime
    tests passed.
- `npx tsc -b --pretty false`
  - passed.
- `npm run lint`
  - passed.
- `npm run i18n:audit`
  - 2214 keys, 0 missing/extra/duplicate across all locales.
- `npm test`
  - 1950 tests passed.
- `npm run ipc:audit`
  - passed with 0 errors and 0 warnings.
- `npm run build`
  - `tsc -b` and Vite production build passed.
- `git diff --check`
  - passed.
- `npm run package:dir:smoke`
  - directory packaging and packaged-app smoke test passed on macOS arm64.
  - Existing unsigned macOS, duplicate dependency, and optional Python module
    smoke warnings remain unchanged residual packaging/setup risks.

Acceptance results:

- Opening Memory from a reply source detail carries only source IDs, not memory
  text or diary content.
- Referenced long-term memories and diary entries are highlighted in the Memory
  panel with localized source badges.
- Referenced older diary entries outside the recent preview can appear
  temporarily for management without changing stored memory data.
- The mutation owner remains the Memory settings panel; chat still only shows
  details and a navigation action.
- The slice adds no new IPC, dependencies, migration, permissions, or
  automation surfaces.

## Implementation Slice 8 - Memory LocalStorage Migration Dry-Run

Status: implemented in this branch; full validation passed.

Product boundary:

- This slice keeps Nexus companion-first and memory-safe. It does not add
  autonomous task execution, tool calls, planner/executor behavior, or a
  Codex-style work-agent surface.
- The goal is to prepare the long-term memory migration with a content-free
  local audit before any SQLite memory write path, renderer readback path, or
  storage-authority change exists.

Problem:

- Long-term memory and daily memory still live in renderer `localStorage`.
- The app needs to understand current data shape, legacy key presence,
  normalization losses, and date/count coverage before a safe migration can be
  designed.
- A migration report must not expose memory text, diary text, source refs,
  memory IDs, related IDs, or user-private details.

Design:

- Add `memoryMigrationDryRun.ts` as a pure renderer-side report builder.
- Inspect three known memory keys:
  - `nexus:memory:long-term`
  - legacy `nexus:memory`
  - `nexus:memory:daily`
- Reuse existing memory normalizers to compute normalized long-term memory and
  daily-entry counts without writing the normalized values back.
- Report only:
  - storage key presence, byte sizes, JSON validity, raw/normalized counts
  - long-term enabled/paused counts, category/kind/importance counts
  - daily day/entry counts, role/source counts, date ranges
  - estimated content byte totals and issue codes
- Use stable JSON comparison for normalization warnings so field-order changes
  do not create false review states.
- Export `loadMemoryStorageMigrationDryRun()` through the storage barrel for
  future hidden UI or development diagnostics.

Impact scope:

- New storage dry-run helper.
- Storage barrel export.
- Focused memory migration dry-run tests.
- M5/ROADMAP/ARCHITECTURE/CHANGELOG documentation.

No new dependency:

- The slice reuses existing localStorage constants and memory normalization
  helpers.

Migration:

- No stored data is migrated.
- No SQLite schema, localStorage value, IPC contract, audit-log schema, or UI
  entry point changes.
- Reports are content-free and are not persisted.

Rollback:

- Remove `memoryMigrationDryRun.ts`, its storage barrel export, focused tests,
  and documentation updates.
- Existing memory, daily-memory, trace, and Settings behavior remains valid.

Known risks:

- The report is renderer-side only and reflects the current localStorage state
  visible to that renderer process.
- Estimated content byte totals are aggregate sizes only; they are useful for
  migration sizing, not for exact encrypted/export package sizing.
- The next write-path slice still needs a separate SQLite schema, explicit
  confirmation, backup/rollback design, and no-content audit records.

Validation results:

- `node --experimental-strip-types --test tests/memory-migration-dry-run.test.ts tests/memory-storage.test.ts tests/memory-trace-details.test.ts tests/memory-recall-trace.test.ts tests/chat-storage.test.ts tests/assistant-reply-failure.test.ts`
  - 26 focused memory migration/storage/trace/chat-runtime tests passed.
- `npx tsc -b --pretty false`
  - passed.
- `npm run lint`
  - passed.
- `npm run i18n:audit`
  - 2214 keys, 0 missing/extra/duplicate across all locales.
- `npm test`
  - 1955 tests passed.
- `npm run ipc:audit`
  - passed with 0 errors and 0 warnings.
- `npm run build`
  - `tsc -b` and Vite production build passed.
- `git diff --check`
  - passed.
- `npm run package:dir:smoke`
  - directory packaging and packaged-app smoke test passed on macOS arm64.
  - Existing unsigned macOS, duplicate dependency, and optional local model
    warnings remain unchanged residual packaging/setup risks.

Acceptance results:

- Empty memory storage reports `empty` and performs no localStorage writes.
- Valid long-term and daily memory storage reports counts, date ranges, byte
  estimates, and category/source totals without exposing memory content, diary
  content, memory IDs, source refs, or related IDs.
- Legacy memory is planned only when the current long-term memory key has no
  normalized records; otherwise legacy presence is marked as ignored.
- Malformed JSON blocks the dry-run and points the next step to localStorage
  repair before any migration can be attempted.
- Normalization losses are surfaced as issue codes while the dry-run itself
  remains read-only.
- The slice adds no new IPC, dependencies, migration, permissions, or
  automation surfaces.

Suggested next M5 slice:

- Design the smallest reversible main-process SQLite memory repository schema
  and a service-only migration package builder, still hidden from production UI
  until backup, confirmation, rollback, and content-free audit behavior are
  tested.
