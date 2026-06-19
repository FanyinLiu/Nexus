# Nexus Roadmap — companion-first phases

> Last updated 2026-06-19. Stewardship follows Klein's product direction.
> For the short-term MVP and Chinese execution plan, see
> [Nexus 升级整合计划](NEXUS_UPGRADE_INTEGRATION_PLAN.md). When planning
> near-term work, Phase 1 in that document is the active scope.

For the execution order and concrete acceptance metrics, use
[EXECUTABLE_OPTIMIZATION_TASKS](EXECUTABLE_OPTIMIZATION_TASKS.md).

## v1.0 Stabilization Milestones

The v1.0 track keeps Nexus focused on a local-first AI desktop companion:
visible on the desktop, privacy-preserving, memory-transparent, and able to act
only with user authorization. Each milestone must finish with a working build,
tests or smoke validation, migration/rollback notes, user/developer docs, and a
short list of known risks.

Near-term releases should not turn Nexus into a Codex-style work agent. The
current priority is companion presence, local privacy, transparent memory, and
safe user-controlled data movement; task automation stays later and gated.

### M0 - Baseline audit and hygiene - completed 2026-06-18

Goal: establish a trustworthy baseline before deeper changes.

- Audited repository structure, dependencies, scripts, tests, build, packaging,
  IPC posture, storage posture, and release docs.
- Cleared current npm audit findings and lint warnings.
- Verified `npm test`, `npm run build`, `npm run distribution:audit`, and
  `npm run package:dir:smoke`.
- Recorded the baseline in
  [Milestone 0 Baseline Audit](MILESTONE-0-BASELINE-AUDIT-2026-06-18.md).

### M1 - First-run and model repair loop

Goal: a new user can install, configure a text model, and complete the first
conversation within 5 minutes.

- Harden setup state for Ollama, DeepSeek, OpenAI-compatible, and custom
  provider paths.
- Surface actionable repair messages for missing Ollama service, missing local
  model, invalid API key, bad base URL, provider timeout, and unsupported model.
- Keep connection-test repairs limited to non-secret fields: built-in provider
  Base URL/model defaults and installed Ollama model selection. API keys and
  custom endpoints remain explicit user input.
- Surface the 5-minute first-conversation target in onboarding readiness so the
  user can see whether setup is ready, degraded-but-startable, or still blocked;
  text-model readiness requires a successful connection test for the current
  onboarding draft.
- Record local first-conversation timing after onboarding completion when the
  first direct text/voice assistant reply succeeds, without storing message
  content or credentials.
- Surface that timing result in the Settings startup status panel for manual
  release QA and user-visible first-run diagnostics.
- Let users download a local first-run QA report from the startup status panel
  with launch checks and timing evidence, excluding chat content, model output,
  API keys, and provider secrets.
- Support `npm run doctor -- --json` for structured local startup evidence in
  release QA and support reports, with the same no-secrets/no-content boundary.
- Add `npm run verify:first-run` as a repeatable M1 gate for doctor JSON
  privacy checks, model preflight, onboarding repair, first-conversation
  timing, startup reports, and locale coverage.
- Keep voice, OCR, RAG, plugins, and advanced automation out of the default
  first-run path.
- Add tests for model setup state, connection preflight, and humanized repair
  copy.
- Rollback: keep existing settings shape and only add optional setup metadata.

### M2 - Release trust and update hardening

Goal: installers and updates are predictable across macOS, Windows, and Linux.

- Add `npm run release:trust:audit` as the M2 release-trust gate and integrate
  it into `npm run distribution:audit`.
- Verify unsigned local build behavior separately from signed release behavior.
- Document that unsigned macOS artifacts are manual update downloads until
  Developer ID signing is enabled.
- Run unsigned macOS builds in check-only update mode so they open GitHub
  Releases instead of attempting an untrusted auto-install flow.
- Add a non-blocking signed readiness report plus future hard gates for macOS
  Developer ID secrets, hardened runtime, notarization, signed updater mode, and
  Windows signing provider prerequisites.
- Prepare macOS hardened runtime/notarization and Windows signing paths without
  blocking local developer smoke builds.
- Keep GitHub Releases + `electron-updater` as the update channel.
- Add release documentation for installer trust, signing prerequisites,
  rollback, and failed-update recovery.
- Rollback: signing config changes must be isolated in packaging config and
  release docs.

### M3 - IPC contract, permission, and audit baseline

Goal: renderer-visible IPC becomes explicit, validated, permission-aware, and
auditable.

- Add `npm run ipc:audit` as the source-only M3 IPC inventory gate and
  integrate it into `npm run distribution:audit`.
- Track current IPC coverage: preload invokes, subscriptions, main handlers,
  trusted sender checks, payload validation posture, risk class, audit hints,
  and permission/confirmation hints.
- Tighten high-risk IPC clusters in small slices; `file:save-text` and
  `file:open-text` now have request schemas, native-dialog confirmation, and
  metadata-only audit records.
- `desktop-context:get` now has metadata-only audit records for active-window,
  clipboard, and screenshot capability access without logging captured content.
- Telegram/Discord send, Minecraft/Factorio execute, and MCP call/sync channels
  now have metadata-only request/result audit records without logging outbound
  text, audio, commands, target IDs, or MCP argument contents.
- Those external action channels now also use a main-process permission policy
  for read-only, confirm, and auto modes. Active auto-mode escalation requires
  native confirmation and the renderer sync path carries only mode plus
  active/configured booleans.
- Pet-model import/create/assemble/install/open IPC now validates payloads,
  writes metadata-only audit records, and uses native confirmation for direct
  renderer-triggered local artifact operations while keeping paths, URLs, slugs,
  and model names out of audit records.
- Plugin lifecycle and plugin bus write IPC now use metadata-only request/result
  audit records and native confirmation for execution-granting lifecycle
  actions and bus publish/subscribe/unsubscribe, without logging plugin IDs,
  server IDs, topics, message payloads, commands, or error text.
- `tool:open-external` now writes metadata-only request/result audit records
  around the existing main-process URL safety check and native confirmation,
  without logging full URLs, hostnames, paths, query strings, fragments, or
  error text.
- Vault IPC now has metadata-only request/result audit records and an explicit
  secret-safe permission contract: trusted renderer sender, strict slot/entry
  validation, opaque per-sender vault refs instead of plaintext retrieval
  returns, rate limits for enumeration-prone reads, and no slot names, secret
  values, ref tokens, or error text in audit records.
- The remaining renderer-payload IPC backlog is now schema-bound:
  integrations inspection, KWS start/status, VAD start, model download, and TTS
  streaming lifecycle requests all validate request shape before service work.
- Create an inventory of every preload-exposed method and matching
  `ipcMain.handle`.
- Require trusted sender checks, request validation, response shape decisions,
  and risk classification for every channel.
- Move high-risk operations toward unknown-field rejection instead of silent
  compatibility stripping.
- Record high-risk operations in the audit log with stable categories.
- Rollback: schema tightening lands channel by channel with compatibility tests.

### M4 - Main-process storage adapter and SQLite foundation

Goal: introduce durable local storage without a large data migration.

- Add a main-process storage service with schema versioning, migrations,
  rollback hooks, and export/import scaffolding.
- Initial slice landed a dependency-free `json-ledger` storage foundation in
  the main process: `userData/local-data/manifest.json`, schema version `1`,
  migration `0001-create-local-data-manifest`, metadata-only export/import
  planning, and rollback-by-rename.
- SQLite foundation landed behind the same adapter with Electron/Node's built-in
  `node:sqlite`, `userData/local-data/nexus.sqlite`, schema version `2`,
  migration `0002-create-sqlite-local-data-foundation`, Node smoke coverage,
  release CI smoke coverage, an Electron smoke script, and packaged smoke
  validation.
- Domain registry and the first low-risk record mirror landed in schema version
  `3`: migration `0003-create-domain-records-and-onboarding-mirror` creates the
  generic record table and mirrors normalized onboarding completion timing from
  renderer `localStorage` without making it authoritative.
- `local-data:status` is available as a read-only renderer IPC status surface,
  and `local-data:mirror-onboarding` is available as a narrow schema-validated
  write surface; neither returns userData paths or record payloads.
- A renderer-side chat migration dry-run now audits `nexus:chat:sessions` and
  legacy `nexus:chat` without writing storage or exposing message content. It
  reports counts, byte estimates, role distribution, time range, and issue codes
  for the later chat SQLite migration design.
- A service-only confirmed chat migration path can now validate a content-bearing
  package, require explicit confirmation, write `chat-sessions` records to
  SQLite, write a content-free `local-data-audit` record, and roll back only the
  chat-session domain. It is not exposed through production IPC/UI yet.
- A disabled-by-default chat migration IPC boundary is now inventoried:
  `local-data:chat-migration-apply` and `local-data:chat-migration-rollback`
  require schema validation, trusted sender checks, explicit confirmation, and
  `NEXUS_ENABLE_LOCAL_DATA_CHAT_MIGRATION=1` before the service path can run.
- A disabled-by-default Settings history preview panel can now be exposed with
  `VITE_NEXUS_ENABLE_LOCAL_DATA_CHAT_MIGRATION_UI=1`. It reads only the
  content-free dry-run summary, requires a checkbox plus confirmation dialog,
  then calls the feature-flagged apply IPC path. It still does not read SQLite
  chat records back into the renderer, and it is not a default production
  migration flow.
- The hidden preview panel also has a content-explicit backup export and a
  separate rollback review. Backup JSON is clearly marked as containing full
  chat message content, while rollback requires its own checkbox, confirmation
  dialog, and the existing main-process migration gate before deleting migrated
  SQLite chat-session records.
- The hidden panel can also refresh a post-apply/rollback local-data status
  summary through a disabled-by-default no-payload IPC. The summary reports only
  record count, message count, last migration audit id/action/time, and
  `recordPayloadsIncluded: false`; it does not return SQLite chat records,
  session IDs, titles, message text, or userData paths.
- Keep the SQLite dependency gate in release CI so Windows, macOS, and Linux
  runners validate the native package before installer builds.
- Keep localStorage as the read/write source until the adapter has tests and
  packaged smoke coverage.
- Rollback: adapter can be disabled and existing renderer storage remains
  authoritative.

### M5 - Chat and memory migration

Goal: move heavy, long-lived data out of renderer localStorage.

- Migrate chat sessions, long-term memory, memory archive, relationship state,
  and audit-relevant logs domain by domain.
- Preserve existing user data with idempotent migration and export.
- Provide a user-visible way to view, edit, delete, export, and pause memory.
- Show which memories or files influenced a response when relevant.
- Slice 1 has started on chat-session storage authority: the main-process
  local-data service can now read back migrated SQLite `chat-sessions` records as
  content-bearing service data for tests and future repository work. This is not
  exposed through production renderer IPC/UI yet, and live chat still reads and
  writes renderer `localStorage`.
- Slice 2 adds a hidden, disabled-by-default runtime mirror for the current live
  chat session. It requires `NEXUS_ENABLE_LOCAL_DATA_CHAT_MIGRATION=1`,
  `VITE_NEXUS_ENABLE_LOCAL_DATA_CHAT_RUNTIME_MIRROR=1`, and explicit hidden
  Settings consent before the renderer sends a debounced mirror write to SQLite.
  LocalStorage remains authoritative, SQLite records are not read back into the
  renderer, and audit records remain content-free.
- Slice 3 adds a hidden, confirmed comparison preview for chat memory storage.
  The renderer sends only local session metadata, the main process compares it
  with SQLite metadata, writes a content-free audit record, and returns aggregate
  difference counts. It does not return SQLite chat records, titles, message
  text, userData paths, or session IDs to the renderer, and it does not switch
  chat authority.
- Slice 4 adds user-visible memory transparency and pause controls. The Memory
  settings page now shows active memory/diary counts, context-read status, and
  the current storage-authority boundary; users can globally pause memory recall
  and learning or pause individual long-term memories without deleting them.
  Paused chat turns receive an empty memory recall context and skip daily-memory
  capture.
- Slice 5 adds content-minimized memory source traces to assistant messages.
  Each reply can now record whether memory was active or paused, which recall
  mode ran, vector availability, and bounded recalled memory/daily/semantic IDs;
  the chat bubble shows a subtle count summary without duplicating memory text.
- Slice 6 adds an expandable memory-source detail view on assistant replies.
  The renderer resolves stored trace IDs against current memory state at render
  time, shows short previews for still-present memories/daily entries, marks
  missing or paused sources explicitly, and can open Settings directly to the
  Memory page for editing.
- Rollback: keep legacy localStorage snapshots until migration is verified.

### M6 - Desktop presence state machine

Goal: the companion's visible state reflects what Nexus is actually doing.

- Define a shared state contract for idle, thinking, listening, speaking,
  waiting for confirmation, error, and offline states.
- Bind chat, voice, setup, tool, and error flows to that contract.
- Keep Live2D/sprite-heavy rendering lazy and budgeted.
- Rollback: state mapping is additive and can fall back to current pet behavior.

### M7 - Voice basics with resource budgets

Goal: voice is usable without making idle Nexus heavy.

- Stabilize microphone permission, VAD, STT, TTS, interruption, and lip-sync
  paths behind explicit user settings.
- Add diagnostics for mic level, VAD activity, first-audio latency, provider
  failures, and local sidecar prerequisites.
- Lazy-load heavyweight ASR/TTS/OCR/local model code.
- Rollback: text chat remains the primary path and voice can be fully disabled.

### M8 - Local files, lightweight RAG, and citations

Goal: Nexus can use personal knowledge with visible provenance.

- Add opt-in file indexing with clear folder authorization and size limits.
- Keep retrieval lightweight before broad connector work.
- Return source references for file-backed answers.
- Keep private files local unless the user explicitly routes a request to a
  remote model.
- Rollback: file index can be paused, deleted, or rebuilt without affecting chat.

### M9 - Authorized task assistant

Goal: Nexus can help with tasks without becoming an uncontrolled automation
agent.

- Separate planner and executor state.
- Preview plans before execution.
- Require confirmation for high-risk tools and file/system changes.
- Support pause, cancel, and execution reports.
- Persist audit logs for tool calls and decisions.
- Rollback: disable executor while leaving read-only planning available.

### M10 - MCP, plugins, and advanced automation

Goal: open extension surfaces only after core trust boundaries are stable.

- Keep MCP/plugin support opt-in, scoped, and logged.
- Require per-tool approvals and visible risk labels.
- Avoid arbitrary marketplace behavior until signing, storage, IPC, and audit
  foundations are stable.
- Rollback: plugin and MCP surfaces remain behind advanced gates.

## Posture

**AI desktop companion first.**

Nexus is not trying to become a generic local AI workbench. The product
center is a local-first AI desktop companion: visible, lightweight, respectful
of attention, and able to grow toward voice, memory, and autonomy after the
minimum desktop companion loop is stable. Productivity features, tools, game
bridges, and knowledge work are valuable only when they strengthen that
companion experience.

For the active Phase 1 path, prioritize:

1. Presence: a small always-on desktop window and a minimal anime-style avatar.
2. Text conversation: a stable Ollama / DeepSeek path with clear errors.
3. First-run clarity: onboarding and settings should expose only the Phase 1
   route by default.
4. Maintenance discipline: advanced voice, memory, tools, integrations, and
   autonomy stay gated until the minimum loop is solid.
5. Verification: every new surface must be checkable, gated, and
   shippable across supported platforms.

## Companion roadmap

### Phase 1 — Minimal desktop companion

Make the smallest usable Nexus experience work end to end.

- Launch a small always-on desktop companion window.
- Use the default `nexus-mini` static avatar; keep full Live2D optional.
- Support Ollama (`http://127.0.0.1:11434/v1`, `qwen3:8b`) and DeepSeek
  (`deepseek-v4-flash`) for simple text chat.
- Keep onboarding focused on text model, identity, and window basics.
- Provide a startup self-check panel and `npm run doctor` so startup, preview,
  model, and API mistakes are visible without digging through logs.
- Hide dormant or high-complexity feature lines behind explicit advanced gates.

### Phase 2 — First-run companion setup

The first launch should help the user make Nexus feel alive without reading
developer docs.

- Detect microphone, screen recording, notification, and local model readiness.
- Offer three simple modes: light companion, standard companion, high-quality
  voice.
- Test chat, TTS, ASR/VAD, Live2D, and permissions from one guided screen.
- Provide direct repair actions or plain-language fix steps when a capability
  fails.
- Keep advanced provider and model settings available, but not required for
  the happy path.

### Phase 3 — Pet presence and interaction

Make the visible companion feel intentional instead of decorative.

- Mood-driven Live2D expression and motion mapping.
- Click, drag, idle, edge, and focus reactions.
- Quiet state display: listening, thinking, resting, focused, speaking.
- Proactive pings that respect focus, quiet hours, and relationship context.
- Performance-budget checks so animation never makes the app feel heavy.

### Phase 4 — Memory and relationship legibility

Make memory powerful, user-owned, and emotionally coherent.

- Memory browser for facts, preferences, relationship milestones, events, and
  reflections.
- Edit, forget, pin, and source-trace important memories.
- Short-term "recent thoughts" lane for inner monologue and proactive context.
- Relationship and emotion state injected into the main chat prompt when
  appropriate, not only displayed through UI effects.
- Guardrails for sensitive memory, crisis handling, and AI disclosure.

### Phase 5 — Voice naturalness

Voice is the main sensory continuity channel for the companion.

- Reduce first-audio latency and keep local low-latency TTS on the roadmap.
- Support interruption without the companion hearing its own playback.
- Add a voice diagnostics panel for mic level, VAD, ASR, TTS, and timing.
- Move high-frequency audio paths toward typed chunks or stream-oriented IPC.
- Bind voice presets to companion personas.

### Phase 6 — Persona and character system

Let users shape a companion without editing source files.

- Character card import/export.
- Persona versioning: tone, boundaries, relationship mode, and prompt rules.
- Live2D expression mapping editor.
- Voice and appearance presets per companion.
- Multiple companion profiles only after the single-companion flow is clean.

### Phase 7 — Tools as companion abilities

Tools are not the product center; they are companion abilities.

- Permission tiers for read-only, network, file write, app control, and command
  execution.
- Per-tool risk labels, approvals, and logs.
- MCP and plugin surfaces remain opt-in and scoped.
- Game/chat bridges stay experimental until they serve the main companion loop.

## Tier 1 — Compliance & distribution (must-do)

These two items keep Nexus shippable through the end of 2026.

### 1.1 Crisis-response + AI-disclosure layer

California **SB 243** (effective 2026-01-01) and New York's companion
safeguards law require: (a) self-harm / suicidal-ideation detection +
crisis-resource referral; (b) periodic "you are talking to AI" reminders;
(c) minor-safety posture. EU AI Act serious-incident reporting takes
effect August 2026 — even an unsigned binary used by EU/CA residents
counts as "deployed."

**Scope:**
- Detection: pattern + LLM-tagged classification of crisis utterances.
- Response path: **hybrid** — companion stays in character with a
  reframed empathic message, and a separate non-persona hotline panel
  slides in over the conversation. Legally the panel is "non-AI
  resource clearly displayed"; emotionally the relationship continuity
  is preserved (decided 2026-04-28; Klein chose the hybrid over either
  full break-character or full in-character).
- Hotline catalogue keyed by `i18n.locale` (verified 2026-04-28; see
  `src/features/safety/hotlines.ts` for sourceUrls):
  988 (en-US, 24/7 call+text), 12356 / 800-810-1117 (zh-CN, the
  former is the new national unified line opened 2025-01),
  1925 (zh-TW 24/7 安心專線), 0120-279-338 よりそいホットライン
  (ja, 24/7 free), 109 (ko, unified 2024-01 from 1393 / 1577-0199),
  116 123 Samaritans (en-EU fallback).
- Disclosure: periodic in-conversation reminder + onboarding consent.
- Documentation in README so a regulator can locate the path.

Estimate: 2-3 weeks. **Highest priority** — has a hard August deadline.

### 1.2 Code signing + notarisation — **deferred**

**Decision 2026-04-28:** Not signing. Klein declined the ~$220/year
recurring cost (Apple Developer ~$99 + Azure Trusted Signing ~$120).
"No commercialisation" extends to "no recurring infra spend right now."

This is reversible — if a future month brings a strong reason (mass
adoption, EU enforcement actually citing unsigned distribution), revisit.
Until then:

**What we do instead — improve the unsigned-install path:**
- README per locale: clear "first-launch warning is expected, here's
  why and how to bypass" section (xattr -dr on macOS, SmartScreen
  "More info → Run anyway" on Windows). Currently buried.
- Linux: add detached GPG signature + SHA-256 alongside AppImage / deb.
  This is free and orthogonal to platform code-signing.
- Release notes: keep the install workaround visible at the top.

Estimate: ~1 day for docs + GPG, no recurring cost.

## Tier 2 — Quality polish (worth doing while around)

### 2.1 Self-tuning thresholds for M1.4-1.7

The silent guidance telemetry + weekly analyzer (`guidanceAnalysis.ts`)
already records every fire and computes per-kind valence-delta over a
24h pre/post window. The next step is to *consume* the report and
auto-tune the M1.4-1.7 threshold constants toward whatever combination
correlates with post-fire valence lift on Klein's actual use data.

**Scope:**
- `src/features/autonomy/affectTuning.ts` — read latest analysis report,
  produce a candidate threshold tweak with confidence bound.
- Apply only when `pairedFires ≥ 30` and confidence ≥ 0.7.
- Persist to localStorage; classifier reads at injection time.
- Stays silent: no UI, no notification.

**Escape hatch (decided 2026-04-28):** No "reset emotional tuning"
button (would violate the silent-emotion principle — user is recipient,
not debugger). Instead:
- **14-day decay**: every two weeks the persisted tuned threshold is
  re-blended toward the factory default by 5% weight. A wrongly-tuned
  state self-corrects to mid-zone within ~6 months without any user
  action.
- **Hidden hard reset**: piggyback on the existing onboarding-redo flow
  — when the user re-runs onboarding, clear the guidance telemetry +
  tuned thresholds. Not surfaced in settings, not in user docs.

Estimate: 3-4 days for the tuner + decay; another 0.5 day to wire the
onboarding-redo telemetry clear.

### 2.2 TTS engine upgrade — local low-latency

Q1-Q2 2026 reset the local-TTS bar:
- **Voxtral** (Mistral, March 2026, 4B open-weight, 70ms first-frame
  latency, RTF 9.7×, multilingual)
- **Kyutai Pocket TTS** (January 2026, 100M params, CPU real-time)

Either replaces the current Sherpa pipeline with a 5-10× lower-latency
local option.

**Scope:**
- Probe both for license / size / latency on the project's reference
  hardware.
- Wire as new `tts.providerId = 'voxtral-local' | 'kyutai-local'`;
  keep Sherpa as fallback.
- Update model-download script + asar-unpack patterns.

**Rollout cadence (decided 2026-04-28):**
- **v0.3.2** — new engine ships, settings toggle present, default OFF.
  Existing users keep Sherpa.
- **v0.3.3** — release notes announce "next patch will flip the default"
  and link the toggle. Two-week soak window.
- **v0.3.4** — flip default to the new engine. Toggle stays so anyone
  unhappy with the change can revert.

Voice is core sensory continuity for the companion — no overnight
default change.

Estimate: 1-2 weeks for the engine; rollout spans three patch versions.

### 2.3 Minimal MCP client — gated companion ability

Open-LLM-VTuber and SillyTavern both speak MCP now; it's becoming the
standard way to give a chat companion access to tools. Nexus has an MCP
host stub and approval gate but doesn't actually consume MCP servers
beyond the bare host.

**Scope:**
- Renderer-side MCP client that connects to a stdio or HTTP server given
  a config file path.
- Surface available tools alongside built-in tools in the prompt.
- Keep the per-tool approval gate from the v0.3.0 audit (M2).
- Keep it behind an explicit setting and present it as "abilities" rather
  than a generic workbench/plugin marketplace.

Estimate: 1 week.

## Experimental surfaces

These features can stay in the codebase, but should not dominate onboarding
or the main settings flow until they are reliable and clearly companion-led.

- Realtime OpenAI voice.
- Minecraft / Factorio gateways.
- Telegram / Discord bridges.
- Broad MCP/plugin execution.
- Long-running autonomous tasks.

Every experimental surface needs: an explicit enable switch, a visible risk or
capability description, tests for lifecycle cleanup, and a clean failure mode.

## Tier 3 — Structural debt (opportunistic)

### 3.1 readJson<T> migration

`readJsonValidated` helper landed in v0.3.1; ~30 storage consumers still
cast through `readJson<T>`. Migrate when touching a store for other
reasons.

### 3.2 Voice-runtime test coverage

`src/features/voice/runtimeSupport.ts` covers at 21.72%. Largest
untested surface in the project. A focused property-based test pass on
the state machine + lifecycle calls would catch the kind of bug beta.3
shipped (TTS state wedge).

### 3.3 Bundle dieting

`app-runtime` is 1.45 MB (gzip 444 KB). `transformers-vendor` is 868 KB
unconditionally bundled even for users on remote LLM only. Lazy-loading
local-model paths gates ~250 KB gzip off first paint.

## Explicitly NOT planning

Listed so future contributors don't pile feature work onto a polish
phase.

- Generic "AI workbench" parity with Jan, AnythingLLM, Msty, or Open WebUI.
- Group / multi-character rooms.
- VRM / 3D pipeline before the Live2D companion loop is polished.
- NSFW / dating-sim mechanics.
- Subscription / paid tier.
- Cloud sync / account system.
- Tool marketplaces or arbitrary automation that bypasses companion safety
  and permission gates.

## Decisions log

New decision 2026-04-30:

0. **Product center** — AI desktop companion first. Productivity, knowledge,
   tools, and game bridges are supporting abilities, not the core identity.

All four open questions resolved 2026-04-28:

1. **Code signing** — deferred indefinitely. No $220/year right now.
   Improve the unsigned-install README + add Linux GPG signatures
   instead. Reversible if reasons change. (See 1.2.)
2. **Crisis-response tone** — hybrid. Persona stays in character with an
   empathic reframing; a separate hotline panel slides over the
   conversation. (See 1.1.)
3. **TTS default flip** — three-version rollout. v0.3.2 opt-in →
   v0.3.3 announce → v0.3.4 flip default. Toggle stays for opt-out.
   (See 2.2.)
4. **Self-tune escape hatch** — no settings button. 14-day decay toward
   factory defaults at 5%/cycle for slow self-correction; piggyback
   onboarding-redo for hard reset. (See 2.1.)
