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

## v1.0 Milestone Boundary

Long-running architecture work follows the auditable milestone contract in
[`docs/V1_MILESTONES.md`](V1_MILESTONES.md). Each stage must name the problem,
technical design, impact scope, risks, rollback plan, data migration behavior,
tests/evidence, docs, acceptance results, known gaps, and next-stage tasks
before it graduates.

Use that contract when changing structural areas such as Electron IPC, secret
boundaries, SQLite persistence, memory ownership, presence state, voice lazy
loading, file indexing, Tool Registry, or MCP/plugin surfaces. The point is to
keep the runtime layers below stable while the product moves toward v1.0.

For IPC work,
`npm run m3:ipc:audit -- --require-full-validation --require-high-risk-audit`
is the current strict inventory gate. It tracks preload/handler coverage, event
sources, trusted sender checks, vault refs, full request validation, and
redacted high-risk invocation audit without copying payload values or user
data.

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
character/
chat/
context/
failover/
integrations/
intent/
memory/
models/
onboarding/
pet/
reminders/
tasks/
themes/
tools/
voice/
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
- M4 SQLite migration work must keep renderer localStorage as the source
  fallback until a main-process store, backup, rollback, and cross-platform
  migration evidence are in place. Use `npm run m4:sqlite:foundation` to
  initialize and audit the built-in `node:sqlite` main-process schema plus the
  read-only `storage:status` IPC and bounded
  `storage:backup-local-snapshot` / `storage:copy-local-snapshot` IPC.
  `storage:status` is diagnostic-only: trusted sender checked,
  response-validated, high-risk-audited, and path-redacted. The snapshot backup
  IPC can copy allowlisted chat/memory values into a local private backup file
  and SQLite ledger; the structured copy IPC can copy already-backed-up
  chat/memory rows into schema v3 tables. Both paths preserve source
  localStorage and are not read-through migration. Then use
  `npm run m4:storage:audit` to refresh the private-safe storage inventory
  before changing read/write persistence contracts.

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

The repo now has stable barrels for the layers we expect other modules to touch:

```text
src/index.ts
src/app/index.ts
src/components/index.ts
src/features/index.ts
src/hooks/index.ts
src/i18n/index.ts
src/lib/index.ts
src/types/index.ts
```

Feature-specific public surfaces also exist, for example:

```text
src/features/voice/index.ts
src/features/models/index.ts
src/features/tasks/index.ts
src/features/tools/index.ts
src/features/memory/index.ts
src/features/pet/index.ts
src/features/onboarding/index.ts
src/features/themes/index.ts
```

The app shell should prefer these entry points over imports like
`../../features/voice/sessionMachine` unless the symbol is explicitly private.

## Core Runtime Flows

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
  -> features/models provider catalog + discovery helpers
  -> Electron chat:list-models / chat:test-connection
  -> discovered model + provider health metadata
  -> persisted text provider profile
  -> features/chat runtime
```

The model center owns provider grouping, provider/model capability metadata,
preset model discovery, provider credential status, and UI-independent model
catalog state resolution. `src/lib/apiProviders.ts` remains a compatibility
export only; new code should import from `src/features/models`.

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

### Tasks

- `features/tasks/` owns the common task-log shape used by tools, agent traces,
  background jobs, MCP actions, and future safety confirmations.
- Agent-specific traces may adapt into `TaskRunLog`, but new audit surfaces
  should avoid depending on `features/agent/` directly.

### Memory

- `features/memory/` owns long-term memory, daily memory, archive import/export,
  recall support, and vector warmup helpers.
- `hooks/useMemory.ts` owns persistence and React state synchronization.

### Pet and character

- `features/pet/` owns Live2D model metadata, performance cues, presence lines,
  and the `Live2DCanvas` component.
- `features/character/` owns UI/voice/presence preset data that themes the app
  toward the companion-style presentation layer.

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

1. Prefer `src/lib/` for generic registries and persistence helpers
2. Keep provider-specific decision logic close to the owning feature
3. Avoid creating feature logic inside `storage.ts`

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
