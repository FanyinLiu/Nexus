# Nexus v0.4.5 — Release Hardening Draft

Status: Draft. Do not publish until Klein explicitly asks for the final release
gate, tag, and GitHub Release.

v0.4.5 does not ship a new runtime feature. It consolidates the current public
stable v0.4.4 release into a
release-hardening review layer so the project can prove the 0.4 line is
coherent before any future release decision.

## What Changed

- Added a v0.4 draft-stack audit that checks release-state invariants from
  source files only, with a quick PR guard and a full release-review mode.
- Added a v0.4.5 draft hardening handoff with stacked PR traceability,
  rollback notes, privacy assertions, and verification commands.
- Kept the public stable entry point on v0.4.4 while documenting v0.4.5 as
  the only draft-only review layer.
- Added tests around the draft-stack boundary so future documentation edits do
  not accidentally promote v0.4.5 to a release.
- Recorded local draft-hardening evidence for `verify:release`, packaged smoke,
  and the full v0.4 draft-stack audit without creating release artifacts.
- Clarified that v0.5 is the next desktop pet behavior line, not a workaround
  for any v0.4 release-state issue.

## Accumulated Since v0.4.4

The following maintenance work has landed on `main` after the v0.4.4 stable
release and belongs to this draft layer. None of it changes user-facing
behavior.

### Toolchain and lint

- **eslint-plugin-react-hooks 7.1.1** — adopted the React Compiler-era rules
  (`react-hooks/refs`, `set-state-in-effect`, component creation) and cleared
  all 58 violations with behavior-preserving rewrites: lazy ref init moved to
  `useState` initializers, render-time ref writes moved to commit-phase
  effects, synchronous effect `setState` became render-phase adjust with
  prior-value snapshots. The v0.2.7 render-storm invariants (memoized hook
  bags, no store-to-render `setState` loops) are preserved.
- **Import path style unification** — every file-level relative import now
  carries an explicit `.ts` / `.tsx` extension (826 sites across 221 files),
  matching the `allowImportingTsExtensions` configuration already used by
  newer code. Directory (barrel) imports stay extensionless. Audit scripts
  that match import strings verbatim and their test fixtures were updated to
  the canonical form.

### Security

- **High-risk IPC schemas reject unknown fields** — the phase-three IPC
  payload schema rollout switched plugin, plugin-bus, telegram/discord send,
  game command, text file, VTS legacy token, MCP call/sync, external action
  policy, open-external tool policy, desktop context policy, and pet-model
  creator kit channels from silently stripping undeclared payload fields to
  rejecting them. The `mcp:sync-servers` caller now sanitizes stored server
  entries to the schema whitelist before sending, and a guard test keeps every
  high-risk schema on reject.
- **Vault IPC channels** — all six `vault:*` invoke channels joined the
  schema system (reject-unknown-fields posture), and a corrupted
  `vault.json` is never overwritten in place — the failure is surfaced
  instead of silently destroying the vault.
- **SSRF hardening on chat completion paths** — closed server-side request
  forgery bypasses in the chat completion flow (proxy-style URL handling now
  validates targets before any outbound request).

### Reliability fixes

- **Errand recovery** — background errands interrupted by a process exit are
  re-queued on the next boot instead of being stuck in `running` forever.
- **Voice / VAD** — VAD frame subscriptions survive wake-word listener
  rebuilds (the shared-mic path no longer starves after a listener error),
  stale `onstop` events from a superseded recorder are ignored, and the
  wake-word runtime's unreachable cooldown state was removed.
- **Chat turn guards** — the 90 s hard timeout now invalidates the turn id
  before aborting (late continuations take the silent stale-turn path), and
  the tool-call loop carries earlier rounds' tool exchanges into later
  continuation payloads.
- **Storage** — deleting every chat session or memory no longer resurrects
  the legacy flat storage keys on the next load; the memory decay anchor
  advances on each dream cycle so decay is not compounded; the memory
  migration package and dry-run report fall back to legacy data only when
  the current key is genuinely absent; a memory migration backup export was
  added to the hidden preview panel.
- **IPC startup** — deferred IPC modules that fail to load are logged and
  retried instead of failing silently.

### Internal cleanup

- **Legacy settings panels removed** — the superseded
  `src/components/settingsSections` tree (36 files, ~12 k lines) is gone;
  the three still-referenced components (About panel, release spotlight
  actions, URL input) moved into `settingsV3`, and the error-redaction,
  message-privacy, and forms/settings-surface audit baselines now track the
  V3 implementation.
- **TTS pipeline removed** — the pipecat-style pipeline
  (`tts-pipeline/`, gated behind an off-by-default flag) was deleted after
  it stalled `waitForCompletion` without audio; the legacy streaming
  controller remains the single TTS path.
- **Dead code removal** — ~270 unused exports across `src` and electron
  services, the `choiceRadioNav` component, unused errand/arc/reminder
  helpers, and the `usedPromptMode` stub in the tool-call loop were removed;
  knip ignore entries shrank accordingly.
- **Packaged runtime baseline** — `scripts/packaged-runtime-baseline.mjs`
  records the sustained-runtime reference locally and warns on regression
  (warn-only, machine-local, non-blocking).

### Docs

- The beta feedback and copy-tuning slice was evaluated and dropped (decided
  2026-08-01); community feedback stays qualitative.
- v0.4.5 draft layer rescoped to the accumulated maintenance described here.

## Not Included

- No formal v0.4.5 release yet.
- No package version bump.
- No tag or GitHub Release.
- No README stable-entry switch.
- No new sensing source, check-in behavior, Settings redesign, feedback
  analytics, adaptive copy, external notifications, message sending, tool
  execution, productivity score, pet movement, or desktop window control.
