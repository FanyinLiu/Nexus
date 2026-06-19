# Milestone 0 Baseline Audit - 2026-06-18

## Scope

This milestone establishes the current Nexus baseline before v1.0 work begins.
It does not change product behavior except for dependency hygiene and one
lint-only React hook dependency fix.

Repository: `https://github.com/FanyinLiu/Nexus`
Local branch: `codex/phase-0-audit`
Current app version: `0.3.4-beta.4`
Primary stack: Electron main process, React renderer, TypeScript renderer and
shared modules, JavaScript Electron runtime, Vite build, node:test suite.

## Problem Analysis

Nexus is already beyond a small beta prototype. The repository contains a large
desktop companion surface: model setup, Live2D/sprite pet presence, voice,
memory, reminders, agent traces, web search, notification bridges, MCP/plugin
hosts, updater wiring, release scripts, and many tests.

The current blockers for a stable v1.0 path are architectural rather than a
single missing feature:

- First-run and model setup exist, but the happy path still depends on local
  environment readiness such as Ollama, local models, Python modules, and
  platform permissions.
- IPC has sender checks and many payload schemas, but schema coverage and
  unknown-field policy are not yet uniformly strict across every renderer-facing
  channel.
- API keys are no longer stored as plain settings values in normal paths and
  use safeStorage-backed vault refs, but more outbound call sites must continue
  resolving secrets only inside the main process.
- Chat, memory, affect timeline, plans, cost history, letters, reminders, and
  other long-lived data still rely heavily on renderer `localStorage`.
- There is no main-process SQLite data layer, so large memories and chat history
  still face renderer quota, sync I/O, and cross-window consistency limits.
- macOS packaging currently falls back to ad-hoc signing in local smoke builds;
  notarized macOS and trusted Windows signing remain release-track work.
- Heavy subsystems such as ASR, TTS, OCR, Live2D, transformers, and local model
  assets are partially gated, but v1.0 needs stricter on-demand loading and
  resource budgets.

## Technical Design

The v1.0 upgrade path should use narrow, reversible milestones instead of a
rewrite:

1. Keep the existing Electron + React + TypeScript stack.
2. Treat Electron main as the authority for secrets, durable data, native
   capabilities, audit logs, and high-risk execution.
3. Keep the renderer focused on UI state, user intent, and low-risk local
   presentation.
4. Add main-process SQLite behind a storage adapter before migrating data.
5. Migrate data domain by domain with explicit import/export and rollback.
6. Require request and response validation for every renderer-visible IPC.
7. Route high-risk tools through a task state machine with preview,
   confirmation, cancelation, and audit log records.
8. Keep heavy modules opt-in or lazy-loaded until the companion loop is stable.

## Implementation Completed

- Connected the local workspace to `origin/main` from
  `https://github.com/FanyinLiu/Nexus`.
- Created the working branch `codex/phase-0-audit`.
- Installed dependencies from the existing lockfile and ran the vendor setup.
- Updated dependency locks to clear current npm audit findings:
  - `vite` lock resolution moved to `8.0.16`.
  - `esbuild` direct dev dependency moved to `^0.28.1`.
  - Transitive vulnerable packages such as `@babel/*`, `form-data`, `js-yaml`,
    `protobufjs`, and `tar` were refreshed by `npm audit fix`.
- Fixed the existing React hook lint warning in `src/hooks/useChat.ts` by adding
  the stable `currentSessionIdRef` to the `useMemo` dependency list.
- Added this milestone audit document and updated the roadmap, architecture, and
  changelog to reflect the v1.0 baseline.

## Verification

All commands below were run on 2026-06-18 in this workspace:

| Check | Result |
|---|---|
| `npm audit --omit=dev` | Pass, 0 vulnerabilities |
| `npm audit` | Pass, 0 vulnerabilities |
| `npm run lint` | Pass, 0 warnings |
| `npm test` | Pass, 1829 tests, 68 suites |
| `npm run build` | Pass, TypeScript + Vite production build |
| `npm run distribution:audit` | Pass, all distribution checks |
| `npm run doctor` | Pass with 2 environment warnings: preview server not running, Ollama not connected |
| `npm run package:dir:smoke` | Pass, macOS arm64 packaged app loaded renderer successfully |

Smoke-build environmental warnings observed:

- Local KWS/SenseVoice models are missing, so model manager reports missing
  `kws-en`, `kws-zh`, and `sensevoice`.
- Python sidecars detect Python 3.11 but skip OmniVoice and GLM-ASR because
  `torch` is not installed.
- The local macOS smoke build uses ad-hoc signing and skips notarization.

These are not regressions from this milestone, but they are relevant to first
launch and release-hardening work.

## Migration And Rollback

No user data migration is performed in this milestone.

Rollback plan:

- Revert `package.json` and `package-lock.json` to restore the previous
  dependency graph.
- Revert the one-line `src/hooks/useChat.ts` dependency-list fix if needed.
- Remove this milestone document and the related roadmap, architecture, and
  changelog entries.
- No localStorage, vault, filesystem, or SQLite data rollback is required
  because no user data shape changed.

## Completed

- Baseline audit of structure, dependencies, scripts, build, tests, IPC,
  storage posture, release configuration, and known blockers.
- Dependency vulnerability baseline reduced to zero current npm audit findings.
- Lint baseline reduced to zero warnings.
- Packaged smoke baseline confirmed on local macOS arm64.
- v1.0 milestone direction documented.

## Not Completed

- No SQLite storage adapter was introduced yet.
- No chat, memory, permission, or audit-log data was migrated.
- No signing, notarization, or Windows trusted-signing setup was performed.
- No first-run UI changes were made.
- No full cross-platform package build was run in this local macOS-only turn.
- No live Ollama or API-provider conversation test was run because local model
  connectivity was not available during `npm run doctor`.

## Known Risks

- Renderer `localStorage` remains the largest data durability and privacy
  limitation for v1.0.
- Renderer-exposed vault ref APIs still require continued discipline so future
  features do not reintroduce plaintext secret exposure.
- Some IPC schemas still use compatibility stripping; v1.0 should move high-risk
  channels toward unknown-field rejection.
- Local voice and model sidecars can fail quietly if prerequisites are missing;
  first-run repair flows should surface these as actionable steps.
- Release trust is not v1.0-ready until macOS hardened runtime/notarization and
  Windows signing are handled.

## Acceptance Results

- Dependency audit: 0 current npm vulnerabilities.
- Lint: 0 warnings.
- Unit/integration tests: 1829 passing tests.
- Build: production renderer and TypeScript build passed.
- Packaging: local directory packaged smoke passed.
- Documentation: baseline audit, roadmap, architecture, and changelog updated.

## Recommended Next Milestone

Milestone 1 should focus on first-run reliability:

- Make model setup state explicit and measurable.
- Show clear repair guidance for Ollama not running, missing local model,
  invalid API key, unsupported provider URL, and missing voice prerequisites.
- Keep all changes in the existing setup/onboarding/model modules.
- Add tests around connection preflight and setup-state messages.
- Do not begin SQLite migration until first-run and model diagnostics are
  stable.
