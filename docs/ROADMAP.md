# Nexus Roadmap — companion-first phases

> Last updated 2026-06-16. Stewardship follows Klein's product direction.
> For the v0.3.4 stabilization gate, see
> [V0.3.4_STABILIZATION](V0.3.4_STABILIZATION.md). For the older execution
> task table, see [EXECUTABLE_OPTIMIZATION_TASKS](EXECUTABLE_OPTIMIZATION_TASKS.md).
> For the v1.0 milestone contract, see
> [V1_MILESTONES](V1_MILESTONES.md).

The old Phase 1 text remains useful as historical context, but it is no longer
the active scope. Current code already includes Live2D, voice, memory,
relationship/emotion state, desktop message awareness, and Telegram/Discord
bridges. The active work is stabilization and verification, then controlled
depth.

## Posture

**AI desktop companion first.**

Nexus is not trying to become a generic local AI workbench or a character
marketplace. The product center is a local-first AI desktop companion: visible,
lightweight, respectful of attention, aware of the user's computer context, and
able to act only inside clear permission boundaries.

For the active v0.3.4+ path, prioritize:

1. **Stabilize what already shipped.** README, ROADMAP, release notes, settings
   copy, and validation evidence must agree with the current app.
2. **Verify real message awareness.** Protocol/unit tests are not enough for
   the macOS Full Disk Access grant, Notification Center watcher, Telegram, and
   Discord. Real-machine evidence is part of the release gate.
3. **Improve proactive care quality.** Event-driven, rate-limited, explainable
   care beats more reminders. Every proactive action needs a skip reason or log.
4. **Make memory legible.** Users need to see, edit, pin, forget, and source
   important memories before Nexus gets more autonomous.
5. **Deepen the companion surface.** Live2D action mapping, role/card import,
   voice diagnostics, and lower-latency local TTS are depth work, not new
   product directions.

## Active Priority Stack

| Priority | Scope | Done means |
|---|---|---|
| P0 | v0.3.4 stabilization, README/ROADMAP alignment, real message-awareness validation | Docs match shipped behavior; local webhook, macOS awareness, Telegram, and Discord have repeatable validation evidence |
| P1 | Proactive-care quality, memory browse/edit, desktop-context diagnostics | Care is event-driven and bounded; important memories are user-owned; context capability failures are visible |
| P2 | Live2D action editor, role/card import, voice diagnostics, low-latency TTS | Companion depth improves without adding noisy surfaces |
| P3 | Email/more IM adapters, mobile, character community, group chat | Only after P0-P2 are reliable and permissioned |

P1 progress: the first desktop-context diagnostics card is now in Settings ->
Console -> Advanced diagnostics. It reports foreground window, clipboard,
screen/OCR, Notification Center, local webhook, Telegram, and Discord readiness.
It also exposes copyable local-ingress, live-evidence, live gate, private-safe
release status, release evidence merge, and release gate commands for the
v0.3.4 message-awareness matrix. The private-safe release status now includes
per-scenario preflight steps and diagnostics trace expectations for each live
check; live evidence should be recorded with the
scenario wrapper
(`npm run message:live:record -- macos`, `telegram`, or `discord`) so proof
fields stay aligned with the strict gate. Passing live records now require an
observation timestamp, operator, and concrete note in addition to the proof
booleans, so the gate cannot be satisfied by bare checkboxes. Discord reconnect
attempts also surface as a diagnostics trace with reason and attempt count for
the live reconnect-status check; Telegram and Discord outbound replies now
surface a "last outbound" diagnostics trace with target, kind, timestamp, and
send error when one occurs. Telegram exposes the Bot API update offset as the
no-replay checkpoint for reconnect validation, and persists that offset per bot
token so app restart does not fall back to offset `0`. Telegram/Discord
messages that also appear through the macOS Notification Center watcher now share a
cross-pipeline announcement key, and local native-bridge echoes are suppressed
when the matching native bridge is enabled.
The first proactive-care event log is also in the same diagnostics area and
captures fired/skipped/error outcomes for away pings, daily brackets, open arcs,
and future capsules. It now copies a bounded public evidence report that
summarizes fired/skipped/error counts, quiet-hours skips, rate-limit skips,
source-link coverage, openable source-route coverage, per-source observation
quality, total time-window coverage, key decision-window coverage for due-item,
quiet-hours, and rate-limit behavior, per-source openable source-route
coverage, and the latest event categories. The public report omits event ids,
details, source-ref ids, source-ref labels, and non-code reason strings, while
keeping bounded next actions for failed evidence checks. The same report can be
regenerated directly from the local Electron storage with
`npm run proactive:care:evidence -- --local-storage-leveldb "$HOME/Library/Application Support/nexus/Local Storage/leveldb" --output artifacts/v0.3.4/proactive-care-evidence.json --require-ready`.
It also flags unobserved proactive sources, weak source-reference coverage,
missing decision-window evidence, and refs that do not route to History or
Autonomy so longer live runs can show which care path still needs real evidence.
Settings -> Console -> Proactive care can now copy the local event-row export
for fallback use as `artifacts/proactive-care-events.json`; that export is
intentionally local/private, while the generated evidence report stays redacted.
`npm run proactive:care:evidence -- --sample` is available for private-safe
report QA and is marked `sample-qa`; v0.3.4 release evidence must use exported
runtime events, and the stabilization status gate rejects sample QA artifacts.
Source refs are now actionable: message refs jump to the retained message in Settings ->
History; scheduler and bracket refs route to Settings -> Autonomy; errand, arc,
and capsule refs route to the Autonomy care queues and highlight the matching
object when that object still exists. Scheduler-only refs now also show a
concrete source detail card for the relevant Autonomy controls or queue. The
remaining P1 work is live-event evidence over longer runs and measured behavior
across real quiet-hours, cooldown, and due-item windows.
Memory ownership UI now has a first pass in Settings -> Memory:
long-term and daily entries can be browsed, edited, forgotten, pinned, paused
from recall, and source-traced. Chat-derived long-term memories and chat/voice
diary source refs now jump to the matching saved message in Settings -> History
when the message is still retained; scheduler, bracket, errand, arc, and capsule
memory refs can now route to Settings -> Autonomy using the same source-target
detail path as proactive-care diagnostics. Relationship-shaped memories and
generated reflections are now split into their own Settings -> Memory lane with
the same edit, forget, pin, recall pause, and source-trace controls.
Reflection edit recall now has a private-safe local evidence helper and focused
test: it compares before/after ranking deltas and metadata preservation without
copying memory text, memory ids, source refs, topics, or queries.
The same diagnostics area now includes a private-safe stabilization evidence
package for P1/P2. It aggregates context diagnostic coverage, memory ownership
counts, memory source-reference coverage, proactive-care observability checks,
companion-surface readiness, voice latency status, and local TTS engine upgrade
readiness without copying memory text, memory source ids, webhook tokens,
outbound targets, profile prompts, voice preset ids, provider error text, voice
transcripts, or trace details. `npm run stabilization:evidence:status` indexes
the file-backed P1/P2 artifacts in `artifacts/v0.3.4` and reports exactly which
proactive-care, Live2D action-map, Character Card import, voice diagnostics, or
local TTS adapter smoke evidence is still missing without copying artifact
contents.

P2 progress: the first Live2D action map editor is now in Settings -> Chat. It
reports expression, gesture, lifecycle-motion, and idle-fidget coverage, exports
a reviewable JSON map, and can save per-model action overrides into the
settings draft. The same coverage can now be regenerated as private-safe
evidence with
`npm run live2d:action-map:report -- --model mao --output artifacts/v0.3.4/live2d-action-map.json`,
including optional override patches without copying exact expression names,
motion group names, or fidget stage directions. The private-safe stabilization
evidence package now checks the active model/action-map coverage, saved
action-map override presence, character-profile preset coverage, active profile
selection, and local/keyless voice readiness without copying role text or voice
identifiers. It also reports whether the active TTS path is local,
delta-streaming, measured against the
first-audio budget, and whether the target local engine providers are selected.
`voxtral-local` and `kyutai-local` are now registered as keyless local
OpenAI-compatible TTS adapters in the provider catalog, but they still need a
running local service plus measured first-audio samples before they count as
release-ready engines.
`npm run tts:adapter:smoke -- --provider voxtral-local --output artifacts/v0.3.4/tts-adapter-smoke.json --require-ready`
or the same command with `--provider kyutai-local` records a private-safe
localhost `/audio/speech` first-byte smoke report for that evidence path once a
local adapter service is running.
The first voice diagnostics panel is in Settings -> Console and copies a
private-safe timing report for mic acquisition, STT finalization, first-audio
latency, first-audio budget status and recommendation, and the active TTS
provider's low-latency request policy. The same evidence can be generated with
`npm run voice:diagnostics:report -- --input artifacts/voice-diagnostics-input.json --output artifacts/v0.3.4/voice-diagnostics.json --require-ready`;
the public report omits transcript preview, pipeline detail, trace text/ids,
transition session/provider/reason/meta fields, and TTS model/voice ids.
Settings -> Console -> Voice diagnostics can now copy the local input export
used as `artifacts/voice-diagnostics-input.json`; keep that input local and
share only the generated public report.
Playback now uses the same provider policy for first-audio watchdog timeouts,
so delta-stream providers can fail fast while round-buffer providers keep a
more tolerant startup window. Character Card imports now expose a safe copyable
and CLI-persistable import report that
proves profile/persona/greeting/lorebook coverage without copying the full card
contents. `npm run character:card:report -- --card-file ./card.json --output artifacts/v0.3.4/character-card-import.json`
can generate the same private-safe evidence without writing the imported
profile, while `npm run character:card:report -- --sample --output artifacts/v0.3.4/character-card-import.json`
keeps release evidence repeatable when no real card should be used. Cards can
also carry a safe Nexus role package preset extension for style, local/keyless
voice, tools, and pet model overrides; unsafe network credentials are ignored
and reported only as booleans. Active character
profiles now expose an editable preset panel for avatar and keyless/local voice
defaults, syncing edits back to the current settings draft. Remaining P2 work
is running the local TTS adapters for real samples, model packaging, and deeper
card/package workflows.

v1 M4 storage work now has a schema v3 foundation for non-destructive
localStorage snapshot backup, structured chat/memory copy into main-process
SQLite, restore-bundle evidence, and a redacted main-process read-through
preview query. The guarded read-through data IPC and renderer hydration evidence
prove confirmed startup chat/memory reads can hydrate without fallback
localStorage writeback, but runtime writes still use the existing renderer
storage path until main-process write persistence, restore/rollback,
packaged-runtime SQLite smoke, and cross-platform evidence are in place.

P3 groundwork: new email and additional-IM adapters must enter through the
local webhook contract unless they become first-party native bridges. The
`message:adapter:check` script now prints contract-compliant starter payloads
with `--template email`, `--template im`, `--template im-public-api`, and
related template ids, then validates filled adapter payload shape, dedupe
readiness, support boundary, permissioned capture method, and privacy warnings
without sending anything or copying private sender/text/id values into the
report. It can also persist that private-safe JSON with
`--output artifacts/v0.3.4/message-adapter-<source>.json --require-ready` for
adapter-readiness evidence. Planned email / IM payloads must declare
`mail-rule`, `imap-api`, `public-api`, `system-notification`, `user-automation`,
or `export-file`; private app database scraping is blocked. This is preparation
for email/more-IM adapters, not a claim that Nexus can directly read private
app databases.

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
- Keep the private-safe M1 gate runnable with
  `npm run m1:first-run:audit -- --sample --output artifacts/v1/m1-first-run-audit.json --require-ready`
  and record real first-reply observations with `npm run m1:first-run:record`
  until runtime first-conversation evidence replaces the sample input. Track
  full platform coverage with `npm run m1:first-run:status`, then feed
  `artifacts/v1/m1-first-run-status.json` into
  `npm run v1:milestone:audit -- --require-acceptance-evidence` for release
  candidate checks.
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

- Memory browser for facts, preferences, relationship-shaped memories, daily
  entries, and generated reflections. First pass is live for each of those
  lanes.
- Edit, forget, pin, recall-pause, and source-trace important memories.
- Chat-derived long-term memories and daily diary entries can jump back to the
  retained source message in Settings -> History.
- Short-term "recent thoughts" lane for inner monologue and proactive context.
- Relationship and emotion state injected into the main chat prompt when
  appropriate, not only displayed through UI effects.
- Guardrails for sensitive memory, crisis handling, and AI disclosure.

### Phase 5 — Voice naturalness

Voice is the main sensory continuity channel for the companion.

- Reduce first-audio latency and keep local low-latency TTS on the roadmap.
- Support interruption without the companion hearing its own playback.
- Add a voice diagnostics panel for mic level, VAD, ASR, TTS, and timing. First
  pass is live in Settings -> Console with first-audio budget status and
  recommendation.
- Move high-frequency audio paths toward typed chunks or stream-oriented IPC.
- Bind voice presets to companion personas.

### Phase 5a — IPC security inventory

Before adding broader task execution, keep the renderer/native bridge
auditable.

- Keep `npm run m3:ipc:audit -- --require-full-validation --require-high-risk-audit`
  green so preload invokes, IPC handlers, event sources, trusted sender checks,
  request validation, vault refs, and redacted high-risk invocation audit stay
  aligned.
- Use `artifacts/v1/m3-ipc-security.json` as the M3 work queue for response
  validation, central permission policy, and user-visible confirmation copy.
- Promote the static inventory into a central IPC contract registry once
  response schemas and permission explanations are classified.

### Phase 5b — Main-process storage migration

Before memory and task execution become deeper, move long-lived data out of
heavy renderer localStorage with a migration path that users can recover from.

- Keep `npm run m4:storage:audit -- --require-inventory-ready` green so chat,
  memory, settings/permissions, and audit/log-style keys stay inventoried.
- Use `npm run m4:sqlite:foundation -- --require-ready` to verify the
  main-process `node:sqlite` schema, backup ledger, rollback ledger,
	  localStorage migration ledger, migration event table, snapshot backup tables,
	  structured copy tables, read-only `storage:status` IPC, bounded
	  `storage:backup-local-snapshot` / `storage:copy-local-snapshot` IPC,
	  redacted `storage:read-through-preview` IPC, and user-confirmed
	  `storage:set-read-through-mode` IPC plus guarded
	  `storage:read-through-data` hydration IPC.
- Keep `storage:status` diagnostic-only: it may expose table readiness and
  privacy flags, but not absolute database paths or localStorage values.
- Use `storage:backup-local-snapshot` only for allowlisted chat/memory snapshot
  backups. It may write a private local backup file and ledger rows, but must
  preserve source localStorage and must not return values or absolute paths.
- Use `storage:read-through-preview` only for redacted copied-row summaries; it
  must not return chat text, memory bodies, localStorage values, or absolute
  paths, and it must not enable runtime fallback by itself.
- Use `storage:set-read-through-mode` only as the confirmed feature flag for an
  existing copied run. It must require `userConfirmed: true`, preserve source
  localStorage, record an audit event, and remain reversible by disabling the
  flag.
- Use `storage:read-through-data` only after the confirmed mode is enabled. It
  may return copied SQLite chat and memory values to the trusted renderer, so it
  must disclose `containsUserData`, block raw localStorage values, block path
  exposure, avoid audit-log value copying, and keep fallback localStorage
  intact.
- Use `npm run m4:storage:renderer-hydration:evidence` to verify the renderer
  adapter accepts confirmed read-through data, rejects unsafe privacy flags, and
  avoids fallback localStorage writeback while omitting hydrated content from
  the public report.
- Use `npm run m4:storage:downgrade:evidence` to verify that schema v3
  structured copy data can be rolled back to the v2 snapshot/ledger layer after
  a restore bundle and private database backup exist.
- Keep source localStorage as the fallback until renderer chat/memory hydration
  has real-profile evidence, writes move safely to the main-process store,
  restore/downgrade tooling is automatic enough for users, and
  macOS/Windows/Linux package evidence exists.
- Start with chat and memory migration; avoid moving secrets or high-risk
  permission state until IPC response validation and audit boundaries are
  strong enough.

### Phase 6 — Persona and character system

Let users shape a companion without editing source files.

- Character card import/export.
- Persona versioning: tone, boundaries, relationship mode, and prompt rules.
- Live2D expression and motion mapping editor. First pass is live in Settings
  -> Chat.
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

M2 governance now tracks this posture with
`npm run m2:distribution:trust -- --output artifacts/v1/m2-distribution-trust.json --require-ready`.
That report is allowed to pass only when installer targets, update metadata,
Linux integrity files, and macOS/Windows unsigned fallback docs are all present.
Set `PACKAGED_SMOKE_EVIDENCE_FILE` or run `npm run m2:package-smoke:current`
on each platform to attach package-smoke evidence, then rerun the M2 audit with
`--require-package-smoke` for release-candidate checks.
The top-level v1 gate now also accepts `--m2-trust-file` and
`--require-acceptance-evidence`, so M2 package-smoke gaps remain blocking
alongside M1 first-run evidence instead of living only in the M2 report.

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

These features can stay in the codebase, but they should not dominate
onboarding or the main settings flow until they are reliable and clearly
companion-led. Telegram / Discord are no longer speculative; they are
v0.3.4 beta surfaces that need live validation before being described as
stable.

- Realtime OpenAI voice.
- Minecraft / Factorio gateways.
- Telegram / Discord bridges after any live-validation regression.
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
