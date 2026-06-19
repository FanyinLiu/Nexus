# Milestone 1 Design - First-Run Model Repair Loop

## Problem Analysis

M0 confirmed that Nexus builds and launches, but first-run success still depends
on environment setup outside the app: Ollama may not be running, the selected
local model may not be installed, API keys may be missing or malformed, and
custom OpenAI-compatible endpoints may use the wrong URL shape.

The code already has two useful pieces:

- Renderer-side preflight catches missing fields before a network request.
- Main-process connection tests return actionable runtime failures for Ollama
  and DeepSeek after a request is attempted.

The gap is that the preflight layer is too generic. For first-run users, a
generic "no endpoint URL" or "no model picked" message does not clearly explain
the fastest repair path.

## Technical Design

This milestone should improve the model repair loop in small, reversible steps:

1. Keep the existing settings/onboarding flow and `chat:test-connection` IPC.
2. Extend renderer-side preflight with provider-aware repair guidance for:
   Ollama, DeepSeek, OpenAI-compatible, custom endpoints, and unknown cloud
   providers.
3. Keep preflight purely local: no network calls, no new dependencies, no secret
   resolution, and no plaintext key exposure beyond the already-present renderer
   input state.
4. Preserve main-process connection tests as the authority for runtime failures
   such as service unreachable, model missing, HTTP status, quota, and provider
   errors.
5. Add focused unit tests so first-run repair messages do not regress.

## Impact Scope

- `src/features/models/connectionPreflight.ts`
- `src/features/onboarding/components/onboardingGuideSupport.ts`
- i18n keys and locale dictionaries for preflight copy
- `tests/connection-preflight.test.ts`
- `tests/onboarding-guide-support.test.ts`
- M1 documentation and changelog entries

No Electron main-process IPC, vault API, storage model, model runtime, or
packaging config changes are required for this step.

## Risks

- Provider-specific copy can become stale as providers change default URLs or
  model names.
- Over-strict URL checks could block valid OpenAI-compatible local endpoints.
- Adding too much text to first-run UI can make setup feel heavier.

## Rollback Plan

- Revert the preflight helper changes and tests.
- Keep existing main-process connection tests; they already cover runtime
  failures.
- No user data migration or settings rollback is needed because this step adds
  no persisted data.

## Acceptance Criteria

- Missing Ollama URL recommends `http://127.0.0.1:11434/v1`.
- Missing Ollama model recommends `qwen3:8b` and `ollama pull qwen3:8b`.
- Missing DeepSeek key, URL, or model points to the supported DeepSeek defaults.
- Custom/OpenAI-compatible endpoint misconfiguration tells the user to use a
  full `http://` or `https://` base URL.
- `npm run lint`, `npm test`, `npm run build`, and packaged smoke stay green.

## Implementation Slice 1 - Provider-Aware Preflight

Status: implemented in this branch; full M1 remains open.

Completed:

- Provider-aware local preflight for Ollama, DeepSeek, cloud provider presets,
  and custom OpenAI-compatible endpoints.
- Ollama-specific detection for missing `/v1` before a network request is made.
- Focused tests in `tests/connection-preflight.test.ts`.
- Five-locale i18n copy and i18n audit verification.
- README and changelog notes.

Not completed yet:

- Persisted, local-first telemetry for "first conversation within 5 minutes"
  is now present, but there is not yet a full release-funnel report across
  installer download, launch, onboarding, and first chat.
- A guided one-screen repair flow that combines local model setup, text model
  provider setup, and voice prerequisites.
- Live Ollama/DeepSeek connection verification against real services in CI.
- Packaged smoke across Windows and Linux for this milestone.

Known risks:

- English preflight strings require the English dictionary to be loaded before
  synchronous `pickTranslatedUiText` calls; the current app provider does that,
  while isolated unit tests can still observe the default Chinese fallback.
- Provider defaults can drift, so provider catalog maintenance remains part of
  release hygiene.

## Implementation Slice 2 - Onboarding Repair Gate

Status: implemented in this branch; full M1 remains open.

Completed:

- Reused provider-aware preflight in the onboarding text-model step before the
  user advances past setup.
- Preserved the existing non-blocking behavior for missing cloud API keys:
  users can still save and inspect the companion UI, while the finish hint now
  includes the provider-specific repair path.
- Added focused onboarding support tests for Ollama `/v1`, malformed keys, and
  missing DeepSeek keys.

Rollback:

- Revert `onboardingGuideSupport.ts` and
  `tests/onboarding-guide-support.test.ts`.
- No migration, IPC rollback, or persisted setting changes are required.

Known risks:

- The onboarding inline alert is still plain text rather than the richer
  two-line connection-test result component, so a later UI pass should make the
  repair action more visually scannable.

## Implementation Slice 3 - Structured Onboarding Repair Copy

Status: implemented in this branch; full M1 remains open.

Completed:

- Added a structured onboarding issue helper so first-run validation can carry
  both the problem and the recommended repair action without flattening them
  into one sentence.
- Updated the onboarding alert to render the same two-part repair shape used by
  the connection-test result surface.
- Kept the legacy string helper for tests and narrow callers that only need a
  single message.

Rollback:

- Revert the structured issue helper and `OnboardingGuide.tsx` rendering change.
- No user data, IPC, migration, or settings rollback is required.

Known risks:

- This improves copy hierarchy but is still not a full guided repair wizard with
  action buttons or automated field correction.

## Implementation Slice 4 - Safe Onboarding Auto-Fill

Status: implemented in this branch; full M1 remains open.

Completed:

- Added a local-only repair payload to connection preflight results for safe,
  non-sensitive fields.
- Let the onboarding repair alert apply provider defaults for Base URL and model
  name with one click.
- Kept API keys, custom provider endpoints, and malformed secret values out of
  auto-fill. Those still require explicit user input.

Rollback:

- Revert the optional preflight repair payload, onboarding issue repair metadata,
  and `OnboardingGuide.tsx` apply button.
- No migration or persisted setting rollback is required because the button only
  mutates the unsaved onboarding draft.

Known risks:

- Provider defaults can still drift, so the provider catalog remains the source
  that must be maintained before releases.
- This does not verify that Ollama is installed or that the model has been
  pulled; runtime connection testing remains the authority for those checks.

## Implementation Slice 5 - Post-Repair Preflight Loop

Status: implemented in this branch; full M1 remains open.

Completed:

- After the onboarding auto-fill button mutates the draft, Nexus reruns local
  preflight against the updated draft instead of blindly clearing the alert.
- A successful local repair now shows a follow-up hint to run the real
  connection test before continuing.
- Onboarding no longer lets a missing cloud API key mask missing Base URL or
  model fields. Missing keys remain non-blocking, but endpoint/model
  misconfiguration is still caught before advancing.

Rollback:

- Revert the optional `skipMissingApiKey` preflight mode, the post-repair
  onboarding status message, and the focused tests.
- No persisted data, migration, IPC, or key-storage rollback is required.

Known risks:

- The repair loop is still local-only. It cannot prove Ollama is running,
  a model is pulled, or a cloud key is valid; connection testing remains the
  runtime authority.

## Implementation Slice 6 - Runtime Test Repair Actions

Status: implemented in this branch; full M1 remains open.

Completed:

- Added a two-stage text connection-test preflight: structural setup problems
  such as Base URL and model are reported before a missing cloud API key, so
  one missing field no longer hides another.
- Added a shared connection-test repair helper for safe post-test fixes. It can
  apply known provider defaults or switch Ollama to an installed discovered
  model, but it never writes API keys.
- Wired the repair action into both the first-run text-model connection test
  and the Settings model connection test.
- Added focused tests for two-stage preflight and post-test repair decisions.

Rollback:

- Revert `runTextConnectionTestPreflight`, `connectionRepair.ts`, the two UI
  call sites, and the focused tests.
- No migration, IPC schema change, persisted data change, or key-storage
  rollback is required.

Known risks:

- The repair action can only adjust fields Nexus can prove are safe to write:
  Base URL and model name. API keys, custom provider endpoints, and local
  service installation remain manual.
- A post-test repair still requires the user to run the real connection test
  again before Nexus can claim the model is usable.

## Implementation Slice 7 - Ollama Service Unreachable Guidance

Status: implemented in this branch; full M1 remains open.

Completed:

- Added a shared runtime transport-failure summarizer for text model connection
  tests.
- When the selected provider is Ollama and the local service is refused or
  times out, Nexus now tells the user to start Ollama, confirms the expected
  Base URL `http://127.0.0.1:11434/v1`, and suggests `ollama serve` plus
  `ollama pull qwen3:8b` if no model is installed yet.
- Reused that guidance for both `chat:test-connection` and `chat:list-models`
  transport failures.
- Kept non-local provider network failures on the existing generic network
  repair path.

Rollback:

- Revert `summarizeChatConnectionTransportFailure`, the two `chatIpc` catch
  call sites, and the focused `chat-runtime` tests.
- No IPC schema change, renderer change, persisted data change, migration, or
  key-storage rollback is required.

Known risks:

- This detects the failed connection after a runtime request fails; it does not
  proactively start Ollama or install a model.
- The command text is intentionally generic across macOS/Windows/Linux. Users
  who installed Ollama with a custom service manager may still need their own
  launch method.

## Implementation Slice 8 - Visible Five-Minute First-Conversation Target

Status: implemented in this branch; full M1 remains open.

Completed:

- Added an explicit `FIRST_CONVERSATION_TARGET_MINUTES = 5` readiness constant.
- The final onboarding wake-up checklist now shows whether the current setup is
  on track for a first conversation within 5 minutes, degraded but still
  startable, or blocked until required fields are fixed.
- Added five-locale copy for the timeboxed first-conversation target.
- Added focused readiness tests so the 5-minute target remains part of the
  first-run acceptance surface.

Rollback:

- Revert the readiness summary fields, `CompanionStep` timebox line, i18n keys,
  and `companion-readiness` test assertions.
- No migration, IPC change, persisted data change, or dependency rollback is
  required.

Known risks:

- This makes the target visible and testable, but it does not yet collect live
  stopwatch telemetry from install to first successful chat.
- The timebox is a product acceptance target, not a guarantee; real network,
  provider account, and local model download time can still exceed 5 minutes.

## Implementation Slice 9 - Verified Connection Readiness

Status: implemented in this branch; full M1 remains open.

Completed:

- Lifted the onboarding text-model connection-test success state into the
  parent guide so the final wake-up checklist can distinguish "fields are
  filled" from "the model actually passed a connection test".
- The readiness text item now stays in warning state until the current
  onboarding session has a successful text-model connection test.
- Editing the text provider, Base URL, model, API key, or applying a text-model
  repair clears the verified state, so changed settings must be tested again.
- Added five-locale copy for the unverified text-model warning.
- Added focused readiness coverage for the filled-but-untested model state.

Rollback:

- Revert the `textConnectionVerified` readiness input, the lifted onboarding
  state in `OnboardingGuide`, the `TextStep` invalidation callback, the new
  i18n key, and the readiness test.
- No migration, IPC change, persisted data change, dependency rollback, or
  key-storage rollback is required.

Known risks:

- The verified state is intentionally session-local. It proves the user tested
  this draft in the current onboarding run, but it is not persisted as a long-
  term provider health record.
- Editing fields invalidates the success state conservatively. That avoids
  stale success claims, but users may need to retest after a harmless change.

## Implementation Slice 10 - First Conversation Telemetry

Status: implemented in this branch; full M1 remains open.

Completed:

- Extended the explicit onboarding completion state with optional
  `firstConversationAt` and `firstConversationElapsedMs` fields.
- Recorded the first direct text/voice assistant reply after onboarding
  completion as the first successful conversation milestone.
- Classified the milestone against the 5-minute target without storing message
  content, model output, API keys, or provider credentials.
- Added a Debug Console system event for the first recorded milestone so the
  result is auditable during manual first-run checks.
- Added storage and telemetry tests for normalization, one-time recording, and
  target met/missed classification.

Rollback:

- Revert the optional onboarding storage fields, `firstConversationTelemetry`
  helper, assistant-reply hook call, and storage tests.
- Existing users with the optional telemetry fields can safely keep them; older
  builds ignore the extra JSON fields.
- No IPC change, secret-handling change, dependency rollback, or destructive
  data migration is required.

Known risks:

- This records the interval from onboarding completion to the first successful
  direct text/voice assistant reply. It does not measure installer download,
  OS first launch, or external Ollama model download time.
- Debug Console visibility is enough for manual/audit checks, but a later M1
  pass should present aggregate first-run timing more directly in release QA
  artifacts.

## Implementation Slice 11 - Idempotent Onboarding Completion State

Status: implemented in this branch; full M1 remains open.

Completed:

- Made `saveOnboardingCompleted(true)` preserve an existing valid onboarding
  state instead of overwriting it on repeated onboarding saves.
- Protected `completedAt`, `firstConversationAt`, and
  `firstConversationElapsedMs` from being reset when a user reopens onboarding
  from Settings and saves again.
- Updated state-classification documentation for the expanded onboarding
  storage shape.
- Added focused storage coverage for repeated-save preservation.

Rollback:

- Revert the idempotent save branch, storage test, state-classification row,
  and this slice note.
- No migration, IPC change, dependency rollback, or secret-handling change is
  required. Existing optional telemetry fields remain safe for older builds to
  ignore.

Known risks:

- Re-running onboarding no longer restarts the first-run stopwatch. That is
  intentional for first-run measurement, but a later release-QA tool may want a
  separate explicit "reset first-run timing" test mode.

## Implementation Slice 12 - Startup Status First-Conversation Check

Status: implemented in this branch; full M1 remains open.

Completed:

- Added a first-conversation item to the Settings → Console → Advanced
  Diagnostics startup status panel.
- The startup check now distinguishes no legacy record, completed onboarding
  awaiting the first direct text/voice assistant reply, target met, and target
  missed.
- Kept the check local-only and content-free: it reads only onboarding timing
  metadata and does not inspect chat messages, model output, or credentials.
- Added focused tests for startup-status timing states and telemetry summary
  loading.

Rollback:

- Revert the startup-status item, i18n keys, `loadFirstConversationTelemetryStatus`
  summary helper, focused tests, and this slice note.
- No migration, IPC change, dependency rollback, or secret-handling change is
  required.

Known risks:

- This makes the M1 timing result visible in diagnostics, not in a polished
  first-run report. A later release-QA pass should export or summarize the same
  metric alongside installer/build evidence.

## Implementation Slice 13 - Downloadable First-Run QA Report

Status: implemented in this branch; full M1 remains open.

Completed:

- Added a pure first-run QA report builder that combines startup-status check
  items with the local first-conversation timing state.
- Added a download button to the Settings -> Console -> Advanced Diagnostics
  startup status panel.
- The downloaded JSON includes stable check IDs, localized labels/details,
  warning count, generated timestamp, first-conversation target state, and
  explicit privacy flags.
- Kept the report local-only and content-free: it does not include chat
  messages, model output, API keys, provider secrets, or credentials.
- Added focused report-shape coverage and five-locale i18n copy.

Rollback:

- Revert `firstRunQaReport.ts`, the startup-status download button, i18n keys,
  focused test assertions, and this slice note.
- No migration, IPC change, dependency rollback, or key-storage rollback is
  required because the report is generated on demand from existing local
  metadata.

Known risks:

- The report captures the renderer-visible startup checks and first-run timing
  metadata. It is suitable for manual QA evidence, but it still does not measure
  installer download time, OS launch time, or external Ollama model download
  duration.

## Implementation Slice 14 - Doctor JSON Startup Report

Status: implemented in this branch; full M1 remains open.

Completed:

- Added `npm run doctor -- --json` support so the existing startup doctor can
  emit a structured local JSON report instead of human-only console text.
- Added `--skip-network` for offline CI or release-note evidence where preview
  and Ollama port probes should not run.
- The JSON report includes schema version, generated timestamp, provider mode,
  runtime shape, check statuses, summary counts, and explicit privacy flags.
- Kept the report content-free and secret-free: it records whether a DeepSeek
  environment variable exists, but never serializes API Key values, app-local
  encrypted settings, chat content, or model output.
- Preserved the default human-readable `npm run doctor` output.
- Added CLI tests for JSON parsing, secret non-leakage, and default output.

Rollback:

- Revert the `nexus-doctor.mjs` JSON/skip-network mode, CLI tests, README and
  release-doc notes, and this slice note.
- No migration, IPC change, dependency rollback, settings rollback, or
  key-storage rollback is required because the report is generated on demand
  from process/runtime checks only.

Known risks:

- The CLI report cannot read application-local encrypted provider settings and
  intentionally only reports environment-variable presence for DeepSeek. The
  in-app connection test remains the authority for saved provider credentials.

## Implementation Slice 15 - Focused First-Run Verification Gate

Status: implemented in this branch; full M1 remains open.

Completed:

- Added `npm run verify:first-run` as a focused, cross-platform M1 verification
  command.
- The gate validates `doctor --json --skip-network`, checks explicit privacy
  flags, and asserts a sentinel API key is not serialized.
- The gate runs focused tests for connection preflight, safe repair actions,
  onboarding repair copy, companion readiness, startup status, first-run timing,
  doctor JSON behavior, and runtime Ollama/DeepSeek repair guidance.
- The gate also runs the i18n audit so first-run copy stays complete across all
  supported UI languages.
- Added README, release-process, architecture, roadmap, changelog, and this
  milestone documentation.

Rollback:

- Revert `verify-first-run.mjs`, the `verify:first-run` npm script, related
  docs, and this slice note.
- No migration, IPC change, dependency rollback, settings rollback, or
  key-storage rollback is required because the gate only executes existing
  local checks and focused tests.

Known risks:

- This is a focused M1 gate, not a full release gate. Full releases still need
  `npm run verify:release`, security audits, and packaged smoke across the
  relevant platforms.
