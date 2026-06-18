# Nexus v1.0 M1 First-Run Setup And Model Repair

This note is the implementation contract for M1. It turns the companion-first
first-run path into private-safe evidence that can be checked before release.

## Objective

Make a new user reach a working standard companion path quickly: model selected,
provider connection checked, first conversation confirmed, voice and presence
readiness visible, and repair actions available when setup fails.

## Problem Analysis

Nexus already has companion readiness checks, `npm run doctor`, model-provider
settings, and runtime errors for common local provider failures. Those pieces
were not yet tied to a single M1 gate that answers: can a user install, repair
model setup, and complete the first conversation in about five minutes?

The M1 risk is not only a broken model setting. It is a trust break: the
desktop companion appears, but does not respond, speak, or explain what is
wrong. The first-run audit therefore checks readiness, model repair state,
budget, and first conversation evidence together.

## Technical Design

`scripts/m1-first-run-audit.mjs` builds a private-safe JSON report from either a
sample or a captured input snapshot. It imports the existing
`buildCompanionHealthSummary` readiness model instead of creating a second
health system.

`src/features/onboarding/firstRunAuditInput.ts` is the runtime bridge for the
same evidence shape. It converts existing text connection test results into
`modelSetup` booleans and converts chat history into first-conversation evidence
using only roles, timestamps, and error tone.

Settings -> Console -> Companion readiness can copy or save the same
private-safe M1 evidence report. The UI report is generated from current
readiness state, the latest text connection-test result when available, and
chat-history metadata that omits message content. The same panel exposes the M1
runtime repair list from the report's `nextActions`, so the user can see the
same actionable fix steps after onboarding that the final onboarding evidence
card showed. It also exposes the M1 handoff commands: save the runtime report as
`artifacts/v1/m1-first-run-audit.json`, record operator evidence for macOS,
Windows, and Linux after real first replies, then run
`npm run m1:first-run:status -- --audit-file "artifacts/v1/m1-first-run-audit.json" --operator-dir "artifacts/v1" --output "artifacts/v1/m1-first-run-status.json"`.
Operator record templates use placeholders for observed time, operator, and
latency, and use a provider-id placeholder when a custom provider id is not a
safe command token.

The runtime repair list can also navigate to Model settings for model-scoped
repair actions such as missing base URL, missing API key, missing model,
unreached local providers, model-unavailable checks, and first-reply latency
repair. It deliberately does not auto-run connection tests from Console, because
that would initiate provider/network work without the user being in the model
settings context. When Model settings is opened from this M1 repair path, the
current provider detail opens directly and shows a reminder to check provider,
base URL, API key, and model before explicitly clicking Test connection.

The onboarding text-model step now records its latest connection-test result
into the same runtime evidence chain used by Console. That record is only reused
when the saved provider/base URL/model/API-key fingerprint still matches the
tested draft, so a user changing model settings after a test cannot accidentally
produce stale M1 evidence. The fingerprint is hashed and does not store raw
keys, endpoints, or model names.

The onboarding companion step also shows a first-run evidence preview before the
user clicks Finish. It summarizes model-test evidence, first-conversation
evidence, privacy redaction, and the next setup action, and can copy the same
private-safe JSON report with `evidenceSource=runtime-onboarding-summary`. When
the report has repair actions, the card shows bounded localized fix steps such
as adding a base URL, selecting an available model, starting Ollama, pulling a
missing local model, or retrying the first message after model repair.

After onboarding, the Panel composer shows a first-reply guide until the first
successful assistant response is recorded. The guide can fill a starter prompt,
but it does not auto-send; the user still chooses whether to send it. Its
status is derived only from chat roles, timestamps, and assistant error tone, so
the runtime does not copy the user's message text or the assistant reply into
M1 evidence.

`scripts/m1-first-run-record.mjs` records the real-machine operator observation
for the first reply. It stores only booleans, platform, provider id, and latency;
operator names, notes, prompts, replies, transcripts, model names, endpoints,
and keys are omitted. The record is meant to be attached as `operatorEvidence`
to a runtime M1 input/report. Running the audit on the operator record alone
does not prove full readiness, because it does not contain companion health,
model setup UI state, voice, Live2D, notification, or webhook evidence.

`scripts/m1-first-run-status.mjs` is the M1 acceptance status rollup. It reads a
runtime M1 audit report plus private-safe operator records and requires macOS,
Windows, and Linux first-reply evidence before it reports `ready`. A sample M1
audit remains useful for scaffold testing, but the status rollup deliberately
keeps `--require-ready` failing until the sample is replaced with runtime
evidence and all three platform records exist.

The report contains:

- Companion readiness counts and blocked/warning item ids.
- Five-minute budget fields for install, model setup, and first conversation.
- Model setup booleans: provider id, local provider posture, API-key
  requirement/satisfaction, base URL presence, model presence, connection
  checked, provider reachability, and model availability.
- Repair action ids such as `set-text-provider-base-url`,
  `select-text-model`, `add-provider-api-key`, `start-ollama`,
  `pull-ollama-model`, and `run-first-conversation-smoke`.
- First conversation evidence: attempted, succeeded, latency when available,
  and whether evidence is present.
- Privacy metadata proving that the artifact omits API keys, base URLs, exact
  model names, prompts, transcripts, webhook URLs, and auth headers.

The audit intentionally performs no network calls. Runtime provider discovery
and first-chat probes should feed it with a bounded snapshot once the UI flow
is wired. Captured inputs may provide either explicit `modelSetup` booleans or a
`textConnectionResult`/`connectionResults.text` object from the existing
connection-test IPC; the audit derives repair status from that result.

## Impact Scope

This increment is limited to docs, package scripts, a private-safe audit script,
focused tests, and renderer-only runtime evidence wiring between onboarding,
Settings, Console, and the Panel composer. It does not change Electron IPC payloads, provider
defaults, persistence schema, or companion prompts.

## Risks

Provider-specific repair actions can drift as Ollama, DeepSeek, OpenAI-compatible
providers, or local adapters change behavior. The audit is also only as current
as the input snapshot: a passing sample proves the gate shape, not a user's
machine state.

## Rollback Plan

Remove `scripts/m1-first-run-audit.mjs`, `scripts/m1-first-run-record.mjs`,
`scripts/m1-first-run-status.mjs`, their focused tests, the
`m1:first-run:audit`, `m1:first-run:record`, and `m1:first-run:status` package
entries, this document, the small doc links, and the renderer evidence wiring in
`useAppOverlays`, `SettingsDrawer`, `TextStep`, and the companion-step evidence
preview.

## Data Migration And Rollback

No user data migration. The runtime evidence is in-memory only and safe to lose
between app sessions. No rollback data transform required. The future runtime
flow must tolerate missing audit fields and old readiness snapshots.

## Tests And Evidence

Run:

```bash
npm run m1:first-run:audit -- --sample --output artifacts/v1/m1-first-run-audit.json --require-ready
npm run m1:first-run:record -- --observed-at "2026-06-18T08:30:00Z" --operator "REPLACE_WITH_OPERATOR" --platform macos --provider-id ollama --latency-ms 1800 --app-started --model-connection-checked --first-message-sent --assistant-reply-observed --panel-guide-ready --private-safe-report-copied --no-transcript-copied --require-ready
npm run m1:first-run:status -- --output artifacts/v1/m1-first-run-status.json
node --experimental-strip-types --test tests/first-run-audit-input.test.ts tests/m1-first-run-audit.test.ts tests/m1-first-run-record.test.ts tests/m1-first-run-status.test.ts
```

Release-level verification should also keep running:

```bash
npm run v1:milestone:audit -- --output artifacts/v1/milestone-audit.json --require-ready
npm run v1:milestone:audit -- --m1-status-file artifacts/v1/m1-first-run-status.json --require-acceptance-evidence --output artifacts/v1/milestone-audit.json
npm run companion:readiness:report -- --sample --require-ready
npm run stabilization:evidence:status -- --require-ready
```

The first `v1:milestone:audit` command checks the governance contract. The
second one is the release-candidate gate: it reads the M1 status rollup and
fails if runtime first-run evidence or macOS/Windows/Linux operator records are
missing.

## User Documentation

User-facing setup docs should describe the first-run path as:

1. Choose standard companion.
2. Select Ollama/local or a cloud API provider.
3. Fix any visible provider, model, API key, voice, Live2D, notification, or
   webhook readiness issue.
4. Finish onboarding, use the Panel first-reply guide to send one real message,
   and confirm the first assistant response.
5. Keep advanced/Beta providers outside the default path.

Do not claim broad message reading. Use permissioned language: Nexus can use
authorized notifications, local webhook payloads, and bridge messages.

## Acceptance Results

The M1 audit scaffold is implemented. The sample private-safe evidence is
expected to pass and write `artifacts/v1/m1-first-run-audit.json`. Onboarding
text connection checks now feed the runtime-safe Console report when the tested
settings still match, and the final onboarding step previews/copies the same M1
evidence state. The Panel composer now guides the first real message, explains
waiting/failed/slow states, and records first-conversation evidence from
role/timestamp/tone metadata only. The onboarding evidence card now translates
repair/next-action ids into concrete localized fix steps. The
`m1:first-run:record` command can capture a real-machine first-reply operator
record without copying message text or model details. The
`m1:first-run:status` rollup now keeps full M1 acceptance machine-checkable: it
requires runtime audit evidence and macOS/Windows/Linux operator records. The
v1 milestone audit now consumes that status artifact as acceptance evidence and
can make it blocking with `--require-acceptance-evidence`.
Settings -> Console -> Companion readiness now exposes the report save action,
the visible runtime repair list, the status rollup command, and the three
platform record templates in one private-safe handoff. Model-scoped repair
items can open the Model settings page directly, while network/provider tests
still require explicit action inside Model settings, where an M1 repair hint
now explains exactly what to verify before clicking Test connection. Full M1
acceptance still needs those real platform records to be captured and merged
with runtime M1 readiness evidence.

## Known Gaps

- The audit does not yet run a live provider connection check itself.
- The first conversation guide is implemented in the Panel after onboarding,
  and operator evidence can be recorded, but real platform runs still need to be
  captured on macOS, Windows, and Linux.
- `m1:first-run:status --require-ready` is expected to fail while only sample
  audit evidence exists.
- The Console handoff still relies on the operator to save the copied runtime
  report to the expected path and replace placeholders before recording
  platform evidence.
- Real Ollama, DeepSeek, and OpenAI-compatible failure cases still need
  machine evidence.

## Next Stage Tasks

- Merge real operator evidence with copied runtime M1 reports for macOS,
  Windows, and Linux.
- Promote the audit into the v1 release evidence bundle once runtime data is
  available.
