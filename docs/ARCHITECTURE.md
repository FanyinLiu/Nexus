# Nexus Architecture

## Overview

Nexus now follows a layered application structure instead of growing from a
single `App.tsx` hub. The goal of this layout is to keep UI composition,
feature logic, persistence, and provider integrations loosely coupled so we can
continue adding voice, memory, desktop context, and companion-style UI behaviors
without turning the repo into one large dependency knot.

The current high-level shape is:

```text
electron/
  main.js
  preload.js

src/
  app/          App composition, providers, top-level controllers, stores, views
  components/   Shared UI components and settings sections
  features/     Domain modules (models, voice, tools, tasks, memory, pet, ...)
  hooks/        React-facing composition hooks built on top of features
  i18n/         Locale runtime, dictionaries, translation hook, OpenCC adapter
  lib/          Pure utilities, compatibility exports, persistence helpers
  styles/       Global styles and token CSS
  types/        Domain type definitions
```

Product architecture note: Nexus should remain a desktop companion first. The
storage, IPC, audit, and permission work in the v1.0 track exists to make
companionship safer and more transparent, especially around local memory. It is
not a push to turn Nexus into a Codex-style autonomous work agent in the near
term.

## v1.0 Architecture Baseline - 2026-06-18

Nexus is moving from a feature-rich beta into a v1.0 desktop companion. The
architectural priority is stability, local privacy, transparent memory, and
authorized execution. This means the main process must become the authority for
durable state and sensitive capabilities, while the renderer remains a UI and
interaction layer.

Current baseline:

- Electron main owns windows, tray, updater, native permissions, safeStorage
  vault, local service bridges, many IPC handlers, web/search runtimes, model
  manager hooks, notification bridges, MCP/plugin hosts, and audit logging.
- The renderer owns the React app shell, settings UI, onboarding, chat panel,
  companion/pet view, memory UI, voice controls, and most app-facing state
  composition.
- Secrets are normally dehydrated from settings into a safeStorage-backed vault
  and represented in renderer state as vault references.
- IPC already has trusted-sender checks and structured schemas for many
  channels, but the v1.0 contract is not yet complete for every exposed method
  and response shape.
- Heavy user data still relies on renderer `localStorage`, including chat,
  memory-related stores, plans, cost/metering, letters, reminders, and timeline
  state.
- First-run onboarding currently stores only a small local completion/timing
  record (`completedAt`, optional first-conversation timestamp and elapsed ms).
  The downloadable first-run QA report is generated from that metadata and the
  startup-status checks; both deliberately exclude message content, model
  output, API keys, provider secrets, and credentials.
- `npm run doctor -- --json` produces a separate local startup report for repo
  dependency, preview URL, Ollama, and DeepSeek setup checks. It records only
  status, environment shape, and repair hints; API key values and app-local
  encrypted settings are never read or serialized.
- `npm run verify:first-run` is the repeatable M1 gate. It consumes the doctor
  JSON report in skip-network mode, verifies the no-secret/no-content contract,
  then runs focused model/onboarding/startup-status tests and the i18n audit.
- `npm run release:trust:audit` is the M2 release-trust gate. It classifies
  macOS, Windows, and Linux signing/update posture from repository config and
  docs only; it does not read environment variables, certificates, keychain
  state, app-local user data, or signing secret values. `npm run
  distribution:audit` includes this gate.
- `npm run distribution:audit` also guards release-process drift such as the
  Stage B packaged-smoke checklist in `docs/RELEASING.md`; if the actual
  `npm run package:dir:smoke` gate is removed from the release docs, the audit
  fails before release.
- `docs/RELEASE-CANDIDATE-v0.3.5-HANDOFF.md` records the current release
  candidate's memorable theme, merge/tag evidence, already-collected smoke
  results, residual signing/runtime risks, rollback path, and companion-first
  next phase. It is a per-release operator handoff, not a replacement for
  `docs/RELEASING.md`.
- The updater runtime uses full `electron-updater` auto-download/install on
  Windows, Linux, and future signed macOS builds. Current unsigned macOS builds
  resolve to `manual-download`: they check GitHub Releases and open the release
  page instead of attempting to auto-install an unsigned package.
- `npm run release:signing:readiness` is a non-blocking M2 report for future
  signed macOS and Windows release profiles. `npm run release:signing:gate`
  requires all signed profiles, while `release:signing:gate:mac` and
  `release:signing:gate:windows` check one platform at a time. These hard gates
  are expected to fail until Developer ID secrets, hardened runtime,
  notarization, signed updater mode, and Windows signing prerequisites are
  wired.
- `npm run ipc:audit` is the M3 source-only IPC contract inventory. It parses
  preload invokes, preload subscriptions, and main-process handlers without
  reading user data or secrets, then fails on structural drift such as missing
  handlers, duplicate handlers, missing trusted-sender checks, missing event
  sources, payload-validation gaps, or high-risk audit/permission gaps.
- `npm run storage:audit` is the renderer localStorage contract inventory. It
  fails if a storage key is added without classification, authority, and
  migration posture.
- `npm run heavy:audit` guards renderer-side heavy modules such as embeddings,
  OCR, browser VAD, and Live2D so they remain lazy-loaded or vendor-loaded on
  demand.
- `npm run companion-boundary:audit` keeps the repo aligned to companionship
  instead of work-agent expansion by requiring the companion task boundary to be
  documented in code-facing and release-facing docs.
- `npm run verify:pr` is the day-to-day merge gate. `npm run verify:release`
  reuses it and then adds the SQLite smoke check for release confidence.
- The `file:save-text` and `file:open-text` IPC handlers now use explicit
  request schemas, native file dialogs as the user confirmation point, and
  metadata-only audit records that avoid file content and full local paths.
- The `desktop-context:get` IPC handler now records metadata-only audit events
  for requested/allowed/enabled context capabilities and returned data-category
  lengths. It deliberately avoids logging active-window text, clipboard text,
  screenshot data URLs, display names, or process paths.
- External action IPC handlers for Telegram, Discord, Minecraft, Factorio, and
  MCP now write metadata-only request/result audit records. These records keep
  outbound message text, voice payloads, game commands, target IDs, MCP command
  text, tool names, and tool arguments out of the audit log while preserving
  action category, payload shape, lengths, and success/failure state.
- The same external action handlers now pass through a main-process permission
  policy before execution. The policy defaults to `confirm`, persists approved
  modes in Electron `userData`, blocks active actions in `read-only`, prompts
  with a native dialog in `confirm`, and requires native approval before an
  active integration can move to `auto`. Renderer sync sends only mode plus
  active/configured booleans, never tokens, target IDs, MCP commands, args, or
  allowlists.
- Pet-model local artifact IPC now validates gallery/creator-kit/install/open
  payloads before service work, writes metadata-only audit records, and requires
  native confirmation for renderer-supplied direct path, local write, remote
  import, install, and open-path actions. Audit records store only lengths and
  category flags, not local paths, URLs, slugs, model IDs, labels, or error text.
- Plugin lifecycle and plugin bus write IPC now record metadata-only
  request/result audit entries and require native confirmation before
  execution-granting lifecycle actions or bus publish/subscribe/unsubscribe
  operations. Audit records store identifier lengths, payload shape, result
  booleans, and error-message lengths, not plugin IDs, server IDs, topics,
  message payloads, plugin names, commands, or error text.
- External-link IPC keeps the existing URL safety normalization and native
  confirmation in the built-in tool registry, then records metadata-only
  request/result audit entries around the IPC call. Audit records store URL
  shape and length fields, not full URLs, hostnames, paths, query strings,
  fragments, or error text.
- Vault IPC stores secrets in the main process and returns opaque per-sender
  `nexus-vault-ref:` tokens for retrieval paths. The bridge now records
  metadata-only request/result audit entries for availability, store, retrieve,
  delete, list, store-many, and retrieve-many operations. Audit records include
  counts, lengths, booleans, and result kinds, not plaintext secrets, slot
  names, vault ref tokens, or error text.
- Integrations inspection, KWS start/status, VAD start, model download, and TTS
  streaming lifecycle IPC now validate request shape before service work. The
  current `npm run ipc:audit` gate reports no missing handlers, missing trusted
  sender checks, payload-validation warnings, high-risk audit gaps, or
  high-risk permission gaps.
- A main-process local-data foundation now initializes both
  `userData/local-data/manifest.json` and the SQLite database
  `userData/local-data/nexus.sqlite` using Electron/Node's built-in
  `node:sqlite`. `npm run sqlite:smoke` validates the Node driver path, release
  CI runs that smoke check before installer builds, `sqlite:smoke:electron`
  checks the Electron main-process runtime, and packaged smoke verifies the app
  can start with the SQLite foundation initialized. Schema version `3` adds a
  generic domain record table and registers a low-risk onboarding mirror. The
  renderer can query `local-data:status` and can send normalized onboarding
  completion timestamps through `local-data:mirror-onboarding`; both paths omit
  userData paths and never return record payloads. No chat, memory, permission,
  or audit-log domain data has moved out of renderer `localStorage` yet. A
  renderer-side chat migration dry-run audits `nexus:chat:sessions` and legacy
  `nexus:chat` as content-free aggregate metadata only; it does not call
  mutating chat loaders, does not write SQLite records, and does not send raw
  chat content over IPC. A service-only confirmed chat migration path can write
  normalized chat session records and content-free local-data audit records into
  SQLite, but it is not exposed as a default production migration flow and
  never returns chat records to the renderer. A disabled-by-default IPC boundary
  now exists for the hidden migration UI; `local-data:chat-migration-apply` and
  `local-data:chat-migration-rollback` are high-risk, schema-validated,
  confirmation-gated, and require `NEXUS_ENABLE_LOCAL_DATA_CHAT_MIGRATION=1`.
  The Settings history preview panel is separately hidden unless
  `VITE_NEXUS_ENABLE_LOCAL_DATA_CHAT_MIGRATION_UI=1`; it displays only dry-run
  counts/issues, requires a checkbox and confirmation dialog before calling
  apply, and still performs no SQLite chat-record readback. The same hidden
  panel can export a local `nexus-chat-migration-backup` JSON file that is
  explicitly marked as containing full chat message content, and can call the
  existing rollback IPC after a separate checkbox and confirmation dialog.
  Rollback deletes only migrated SQLite `chat-sessions` records and still does
  not read those records back into the renderer. The panel can also call
  `local-data:chat-migration-status`, a disabled-by-default no-payload IPC that
  returns only record/message counts and last migration audit metadata with
  `recordPayloadsIncluded: false`; it does not return chat record payloads,
  session IDs, titles, message text, or userData paths. M5 has started with a
  service-only `readChatLocalDataSessions()` repository readback: the main
  process can normalize and return migrated SQLite chat-session content for
  tests and future storage-authority work, but this content-bearing read path is
  not exposed through preload/renderer IPC and the live chat runtime still uses
  renderer `localStorage`. M5 also has a hidden runtime mirror for the current
  live chat session: it requires the main-process migration flag, the renderer
  runtime-mirror flag, and explicit hidden Settings consent before the renderer
  sends a debounced best-effort SQLite mirror write. The mirror reuses the
  schema-validated high-risk IPC boundary and writes content-free audit records,
  but it does not return SQLite chat records to the renderer and does not make
  SQLite authoritative. A hidden `local-data:chat-comparison-preview` path can
  compare renderer localStorage chat-session metadata with SQLite metadata after
  explicit confirmation. The renderer sends session IDs, timestamps, counts, and
  byte sizes only; the main process returns aggregate alignment/difference
  counts and writes a content-free audit record without returning SQLite chat
  records, titles, message text, userData paths, or session IDs to the renderer.
  Memory itself still remains renderer-localStorage authoritative, but the
  settings model now includes `memoryPaused` and the Memory page exposes a
  transparency summary for recall/capture/context-read state. When paused, chat
  turns use an empty memory recall context, skip pending memory callbacks, skip
  recall feedback, and skip daily-memory capture; memory dream consolidation
  also returns early. Assistant chat messages can carry optional
  `memoryTrace` metadata with only memory status, recall mode, vector
  availability, and bounded recalled memory/daily/semantic IDs; the renderer UI
  displays a count summary and can resolve those IDs against current renderer
  memory state for an expandable, runtime-only detail view. Opening Memory from
  that detail view passes only the referenced source IDs into Settings, where
  the corresponding long-term memories and diary entries are highlighted; older
  referenced diary entries may be temporarily included in the visible panel
  without changing stored data. A content-free memory migration dry-run can
  inspect `nexus:memory:long-term`, legacy `nexus:memory`, and
  `nexus:memory:daily` for storage shape, counts, date ranges, and issue codes
  before any SQLite memory write path exists. It does not write SQLite, mutate
  localStorage, or include memory text, memory IDs, source refs, related IDs, or
  diary content in the report. The short previews shown in chat are not written
  back into chat metadata, audit logs, or SQLite.

Target v1.0 direction:

```text
Renderer UI
  -> typed preload bridge
  -> validated IPC request/response contract
  -> main-process domain services
       -> vault service for secrets
       -> SQLite-backed local data service
       -> audit log service
       -> permission and confirmation service
       -> native capability services
       -> model/tool execution services
```

Required boundaries:

- Renderer must never receive plaintext API keys, tokens, sensitive memory
  exports, or high-risk tool credentials when a main-process handle can be used
  instead.
- Every renderer-visible IPC method must have a named request contract. High-risk
  methods also need response contracts, permission classification, rate limits
  where appropriate, and audit categories.
- Storage migrations must be versioned, idempotent, test-covered, and reversible
  through retained legacy snapshots or explicit export.
- High-risk tools must run through a task state machine: plan, preview,
  confirmation, execution, cancelation, result, and audit record.
- Heavy modules such as ASR, TTS, VAD, OCR, local embeddings, Live2D, and RAG
  must remain lazy or explicitly enabled so idle Nexus stays lightweight.

Near-term architecture sequence:

1. Inventory and tighten IPC contracts before adding new automation features.
2. Add small domain-registration and export/import operations behind the
   SQLite-backed local data adapter.
3. Move chat and memory data only after the adapter and database backend are
   packaged-smoke verified.
4. Bind pet presence to shared runtime states instead of ad hoc UI flags.
5. Add planner/executor separation only after permission and audit services are
   strong enough to explain, stop, and replay task runs.

## Layer Responsibilities

### `electron/`

- Owns desktop runtime capabilities only.
- Handles window lifecycle, tray integration, IPC, local file access, and
  native service bridges.
- Must not own React view logic or browser feature state.

### `src/app/`

- Owns application assembly.
- Wires providers, bootstrapping, runtime stores, and top-level controllers.
- Chooses which view to render (`panel` vs `pet`).
- Should coordinate feature modules, not reimplement their domain logic.

Key subfolders:

```text
src/app/
  bootstrap/   Startup side effects and one-time init
  controllers/ Cross-feature orchestration for the app shell
  providers/   Theme, i18n, analytics, and future global providers
  store/       App-wide snapshot stores for settings/runtime hydration
  views/       Top-level composed views only
```

### `src/components/`

- Shared presentation layer.
- Contains reusable cards, bubbles, icons, drawers, and settings sections.
- Should not own provider-specific business workflows.

### `src/features/`

- Owns domain logic.
- Each feature exposes a stable public surface through `index.ts`.
- Feature internals can evolve without forcing `app/` or `hooks/` to import
  deep file paths.

Current feature modules:

```text
analytics/
agent/
arc/
autonomy/
character/
chat/
context/
failover/
futureCapsule/
hearing/
integrations/
intent/
letter/
memory/
metering/
models/
onboarding/
panelScene/
pet/
plan/
proactive/
releaseNotes/
reminders/
safety/
setup/
skills/
themes/
tools/
updater/
vision/
voice/
yearbook/
```

### `src/hooks/`

- Owns React composition over feature modules.
- Bridges stateful React usage with pure feature logic and persistence helpers.
- Preferred home for reusable interaction workflows such as chat, voice,
  reminder scheduling, and desktop context collection.

### `src/i18n/`

- Owns translation runtime and locale dictionaries.
- `runtime.ts` contains the locale engine.
- `useTranslation.ts` exposes the React hook and context.
- `index.ts` is the stable barrel for app-level usage.

### `src/lib/`

- Pure utility layer.
- No React dependency.
- Safe home for storage helpers, normalization helpers, and generic algorithms.
- May keep compatibility exports while modules migrate into `features/`.
- New domain code should import from the owning feature module, not from a
  legacy `lib` wrapper.

### `src/types/`

- Split by domain instead of collecting everything in one giant file.
- `types/index.ts` remains the compatibility barrel for top-level imports.

## Dependency Direction

Preferred import direction:

```text
app -> hooks -> features -> lib -> types
components -> features/lib/types
hooks -> features/lib/types
features -> lib/types
```

Avoid:

- `lib` importing from `hooks` or `components`
- feature modules importing from `app/controllers`
- app code reaching into deep feature internals when the feature barrel already
  exports the needed API
- reintroducing "god files" under `types/index.ts`

## Public Entry Points

Current aggregate barrels are intentionally limited to the layers that actually
provide one:

```text
src/i18n/index.ts
src/lib/index.ts
src/types/index.ts
```

There is currently no aggregate `src/index.ts`, `src/app/index.ts`,
`src/components/index.ts`, `src/features/index.ts`, or `src/hooks/index.ts`.
Do not document or import those paths until the files exist and the ownership
boundary is deliberate.

Feature-specific public surfaces are the preferred feature entry points, for
example:

```text
src/features/chat/index.ts
src/features/character/index.ts
src/features/memory/index.ts
src/features/models/index.ts
src/features/pet/index.ts
src/features/releaseNotes/index.ts
src/features/themes/index.ts
src/features/tools/index.ts
src/features/voice/index.ts
```

The app shell should prefer these entry points over imports like
`../../features/voice/sessionMachine` unless the symbol is explicitly private.

## Core Runtime Flows

### Companion presence and memory visibility flow

```text
chat / voice / runtime snapshot
  -> features/pet/activityState
  -> app/views/PetView
       -> status dot + accessibility label
       -> data-companion-activity / data-companion-motion
       -> SpritePetCanvas fallback state
       -> Live2D listening/speaking flags
```

The current v0.3.5 desktop presence contract is intentionally presentation
oriented. `features/pet/activityState.ts` resolves one visible phase
(`idle`, `thinking`, `listening`, `speaking`, `waiting`, `error`, or `offline`)
plus a small motion token. It must stay content-minimized: no chat text,
memory text, secrets, model output, tool arguments, local paths, or audit
payloads belong in the resolved companion state.

Settings uses the same resolver through
`components/settingsSections/chat/CompanionStatePreview.tsx`, so the Companion
Profile preview cannot drift away from the pet window. Stage directions stay in
`features/pet/performance.ts`: recognized companion asides can drive avatar
cues, while ordinary notes and Markdown remain content.

Memory visibility is a separate white-box provenance surface, not part of the
presence state machine:

```text
features/memory recall context
  -> content-minimized assistant-message memoryTrace IDs
  -> runtime-only trace detail resolution
  -> Settings Memory focus/edit/delete/pause surface
```

`features/releaseNotes/` is also intentionally narrow. The v0.3.5 spotlight is
localized release copy plus local Settings navigation actions only; it must not
own updater logic, migrations, IPC, background checks, chat generation, voice
capture, tools, or task execution.

### Voice and chat flow

```text
User speech
  -> hooks/useVoice
  -> features/voice (VAD, wake word, transcript decisions, TTS helpers)
  -> hooks/useChat
  -> features/tools (intent + tool routing, when needed)
  -> features/memory (recall + write-back)
  -> features/chat (LLM runtime)
  -> hooks/useVoice speech output
  -> features/pet performance cues
  -> rendered panel/pet UI
```

### Model center flow

```text
settings ModelSection / onboarding
  -> features/models provider catalog + preflight/repair/discovery helpers
  -> Electron chat:list-models / chat:test-connection
  -> discovered model + provider health metadata
  -> persisted text provider profile
  -> features/chat runtime
```

The model center owns provider grouping, provider/model capability metadata,
preset model discovery, provider credential status, local setup preflight, and
safe non-secret repair patches for Base URL/model fields. Runtime connection
tests remain authoritative for service reachability, model availability, quota,
and invalid credentials; Ollama transport failures are classified there so the
renderer receives the same "start Ollama / check 11434 / pull a model" guidance
from onboarding, settings, and model-list refresh flows.
`src/lib/apiProviders.ts` remains a compatibility export only; new code should
import from `src/features/models`.

### Desktop context flow

```text
hooks/useDesktopContext
  -> features/context desktop request builder
  -> Electron bridge
  -> optional OCR pipeline
  -> chat runtime prompt enrichment
```

### Reminder flow

```text
hooks/useReminderScheduler
  -> features/reminders schedule logic
  -> app controller trigger handling
  -> features/tools or chat notice execution
  -> persisted task state update
```

## Feature Notes

### Voice

- `features/voice/` owns session state machines, text cleanup, VAD helpers,
  wake word runtime, streaming TTS helpers, local STT adapters, speech provider
  settings views, and speech service connection request builders.
- `hooks/useVoice.ts` is the React orchestration seam for the voice runtime.

### Tools

- `features/tools/` owns tool intent planning, permission policy, tool routing,
  result formatting, and search/weather/open-external capabilities.
- App-level code should talk to the tool module through its public exports.

### Plans and agent traces

- `features/plan/` owns the visible plan store used by current assistant and
  companion flows.
- `features/agent/` owns existing errand state, trace state, and older
  execution-loop utilities. Treat these as legacy/optional authorized-aid
  surfaces, not the primary Nexus companion experience.
- Any future v1.0 assisted action should introduce a main-process
  permission/audit service before expanding tools, so new audit surfaces do not
  depend directly on renderer-side stores.

### Companion task boundary

Nexus can keep lightweight reminders, follow-ups, and trace state, but those
surfaces are not autonomous work-agent execution. The companion task layer must
stay permission-gated, default-off when behavior is active, and explainable in
plain UI terms before it expands beyond local reminders or user-confirmed
follow-ups. The existing `features/agent/` name is retained for import and data
compatibility only; user-facing copy should describe companion tasks rather
than presenting Nexus as a Codex-style work agent.

### Memory

- `features/memory/` owns long-term memory, daily memory, archive import/export,
  recall support, and vector warmup helpers.
- `hooks/useMemory.ts` owns persistence and React state synchronization.
- `features/memory/memorySettingsView.ts` owns the user-facing memory
  transparency summary used by Settings, including the current storage-authority
  statement that memory is not SQLite-authoritative yet.
- `features/memory/recallTrace.ts` owns the content-minimized assistant-message
  memory provenance metadata derived from `MemoryRecallContext`.
- `features/memory/traceDetails.ts` owns runtime-only resolution of memory
  trace IDs to current long-term/daily memory previews, missing-source states,
  and reply-source focus targets for the Memory settings panel.

### Pet and character

- `features/pet/` owns Live2D model metadata, performance cues, presence lines,
  companion activity state/motion normalization and preview helpers,
  stage-direction-to-avatar cue bridging, and the `Live2DCanvas` component.
- `features/character/` owns UI/voice/presence preset data that themes the app
  toward the companion-style presentation layer.
- `features/releaseNotes/` owns small release-communication contracts used by the
  app shell, such as the current About/Help release spotlight. It must stay
  content-only: no updater logic, IPC, migrations, or background checks.
- `tests/release-spotlight.test.ts` guards the current release spotlight, the
  human-facing v0.3.5 README/release-note theme, the v0.3.5 changelog boundary,
  and the release-candidate handoff so visible memory, readable companion
  presence, merge/tag evidence, and the companion-not-agent boundary do not
  drift apart before release.
- `scripts/pet-presence-visual-smoke.cjs` is the Electron QA gate for the built
  pet view: it uses a temporary completed-onboarding profile, checks
  idle/breathe presence state, rejects onboarding overlays, and writes ignored
  screenshot/report artifacts under `output/presence-smoke/`.

### Themes and i18n

- Themes are runtime-configurable through `features/themes/`.
- Locale state is managed through `app/providers/I18nProvider.tsx` and the
  `src/i18n/` runtime.

## Extension Rules

When adding a new feature:

1. Create `src/features/<feature>/`
2. Keep domain logic local to that feature
3. Add `src/features/<feature>/index.ts`
4. Export it from `src/features/index.ts` if it is part of the public app API
5. Add or update domain types in `src/types/`

When adding new app-wide wiring:

1. Start from `features/` or `hooks/`
2. Only move into `app/controllers/` when cross-feature orchestration is needed
3. Keep `App.tsx`, `main.tsx`, and providers thin

When adding storage or provider support:

1. Prefer `src/lib/` for renderer-only compatibility helpers and lightweight
   state normalization.
2. Use `electron/services/localDataStore.js` for main-process schema,
   migration, export/import, and rollback scaffolding before moving durable
   user data.
3. Keep provider-specific decision logic close to the owning feature.
4. Avoid creating feature logic inside `storage.ts`.

## Current Cleanup Status

Architecture consolidation completed in this phase:

- `app`, `hooks`, `features`, `i18n`, `lib`, `styles`, and `types` are all
  present as first-class layers
- top-level app composition now prefers stable barrels instead of deep imports
- `i18n` has a dedicated runtime entry and a stable barrel surface
- the old `lib/chat.ts` feature leak has been removed
- shared exports now cover top-level app and component usage more consistently

Follow-up work can now focus on capability depth instead of structural cleanup:

- richer local TTS/STT provider integration
- more complete desktop context and OCR flows
- deeper memory retrieval/ranking
- Live2D and onboarding refinement
- chunk splitting and bundle-size optimization
