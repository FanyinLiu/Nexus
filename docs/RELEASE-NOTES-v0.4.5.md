# Nexus v0.4.5 — Memory Integrity And Maintenance

**Status: Stable unsigned release.** v0.4.5 is the current stable version and
this document is its formal release record. Publication and platform assets are
created only from the release commit by the protected tag workflow; this
document does not claim that a GitHub asset exists before that workflow
succeeds.

v0.4.5 shipped through the standard beta flow, with no maintainer exception:
`v0.4.5-beta.1` was published as a GitHub pre-release on 2026-08-03 after the
full automated gate (prerelease-check 30/30, verify:release, CI green on all
three platforms), and the beta validation window ran from 2026-08-03 to
2026-08-06 before this stable promotion. No cross-platform physical-device
evidence is claimed; validation is automated gates plus packaged smoke checks.

v0.4.5 builds on the stable v0.4.4 maintenance and hardening release. It adds
one user-visible memory integrity slice, wires companion presence to real
request signals, and carries the reliability, security, and cleanup work
accumulated on `main` since v0.4.4.

## What Changed

### Memory integrity (user-visible)

- **Contradiction detection** — the dream pipeline now ranks, judges, and
  applies contradiction candidates between decay and clustering. Superseded
  memories are demoted automatically in two tiers (likely ×0.3, possible ×0.6)
  in both keyword and vector recall, with no confirmation UI. Each demoted
  memory records `supersededBy` / `supersededAt` / `supersededPending` on the
  memory item, so the Memory settings surface can show why an entry faded.
- **Local-data migration on by default** — the memory local-data migration
  flags now default to on. The environment kill switches and the rollback
  path are kept, and migration still requires explicit user authorization
  before any data moves.

### Companion presence

- Presence phases (`thinking` / `waiting` / `offline` / `error`) are now
  derived in the main process from the real chat request lifecycle instead of
  renderer-side heuristics. `waiting` is reported only while every in-flight
  request is parked in bounded retry backoff and always clears when the
  request settles, so the phase cannot stick; the retry reason is a stable
  diagnostic code, never a URL.

### Release-path fixes from the beta window

- Linux deb verification now compares the Debian-normalized pre-release
  version (`0.4.5~beta.1`) that electron-builder produces, instead of the raw
  semver (`scripts/verify-linux-release.mjs`).
- A stale pre-release entry left behind when a tag was force-moved to a fix
  commit now gets deleted and recreated, so the publish tag-binding check
  passes.

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

### Internal cleanup and contract single-sourcing

- **Mirrored contracts single-sourced (~2,600 lines)** — localData storage
  keys, runtime-state field names, and power event kinds now live in shared
  tuples, and the former hand-written mirrors (main payload schemas, renderer
  storage groups, vite-env types, storage contract, web-search/sprite id
  unions) are derived from them, so the main-process key set can no longer
  drift silently. The five `RuntimeStateSnapshot` declarations converge on
  one shared schema (26 fields: 20 patchable + 6 main-only). Translation keys
  are derived from the zh-CN message catalog via `keyof typeof` instead of a
  generated manifest.
- **Normative conventions documented** — a root `AGENTS.md` records the
  numbered code conventions (ARCH/SRC/FILE/IMP/DOC/ERR/STORE/I18N/TEST/CSS/
  GIT/AGT) that this and future work must follow.
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
  low-value process/structure tests and duplicate audit runs were dropped;
  knip ignore entries shrank accordingly.
- **Packaged runtime baseline** — `scripts/packaged-runtime-baseline.mjs`
  records the sustained-runtime reference locally and warns on regression
  (warn-only, machine-local, non-blocking).

## Unsigned Distribution Contract

Official GitHub Releases are the only supported binary source. v0.4.5 targets
macOS arm64, Windows x64, and Linux x64; it does not claim a macOS x64 or
universal artifact. Signing and notarization posture is unchanged from
v0.4.4.

### macOS unsigned auto-update limitation

The macOS arm64 app is ad-hoc signed, not Apple Developer ID signed or
notarized. Ad-hoc signing does not establish Apple trust, and Gatekeeper may
require right-click → Open or explicit quarantine removal
(`xattr -dr com.apple.quarantine /Applications/Nexus.app`). The app only
checks for a newer version and opens the official release page; users manually
download and replace the app.

### Windows unsigned installer limitation

The Windows x64 NSIS installer is `NotSigned`. SmartScreen may show an
unknown-publisher warning, and the installer cannot provide verified publisher
identity or established reputation. Users should proceed only after confirming
the artifact came from the official GitHub Release.

Each platform build publishes its own checksum list in the same GitHub
Release: `SHA256SUMS-windows.txt`, `SHA256SUMS-macos.txt`, and
`SHA256SUMS-linux.txt`. Linux users who download one package format can run
`sha256sum --ignore-missing -c SHA256SUMS-linux.txt` to verify it.

## Privacy Boundary

Unchanged from v0.4.4. Desktop companion awareness still produces only
short-lived, coarse, sanitized summaries; pausing stops collection and model
reach; raw window titles, screenshots, clipboard bodies, message bodies, file
paths, exact timers, and desktop activity timelines stay out of the model
boundary. Memory contradiction detection runs entirely inside the local dream
pipeline; no memory content leaves the device.

## Not Included

- No new sensing source, check-in behavior, Settings redesign, feedback
  analytics, adaptive copy, external notifications, message sending, tool
  execution, productivity score, pet movement, or desktop window control.
- No changes to the check-in policy, privacy boundary, or Settings contract.
- No v0.5 desktop pet mouse-following, typing reactions, or window control.
