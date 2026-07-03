# GitHub Upload Prep - Nexus v0.4.1 release candidate

Date: 2026-07-03

This document is the upload note for the current Nexus worktree. It is written
for GitHub review and should be updated if another verification pass changes
the numbers below.

## Current state

- Package version: `0.4.1`.
- Current branch: `codex/core-path-smoke`.
- Remote: `origin` -> `https://github.com/FanyinLiu/Nexus`.
- Release state: prepare the `v0.4.1` candidate for GitHub upload and review.
  Do not create the final tag or GitHub Release until the release checklist is
  run again on the final pushed commit.
- Stable public entry point is moving from `v0.4.0` to `v0.4.1`; later
  `v0.4.x` items remain draft review layers unless explicitly promoted.

## Upload scope

This upload is mainly a source-quality, UI-foundation, and reliability pass:

- Desktop companion awareness documentation and guardrails for the v0.4 line.
- Chat, Settings, and Image4 companion-panel UI source organization.
- Settings options architecture and source-only UI surface audits.
- Companion wake-word synchronization support for custom companion names.
- Runtime privacy hardening for desktop context, messages, vault boundaries,
  and redacted error/support logs.
- Package/startup performance documentation and budget checks.
- Settings drawer performance protection: Settings styles remain lazy-loaded as
  CSS, while the lazy Settings entry JS stays tiny.
- New or expanded tests/audits wired into `verify:pr`.

## PR framing

This should be opened as one large `v0.4.1` release-candidate PR. The branch is
broader than a small patch: it changes UI source organization, Settings surface
contracts, Image4 companion-panel structure, privacy/security audits, release
docs, icon assets, and verification scripts in one prepared worktree.

Use this framing in the PR description:

- **What this PR is:** a `v0.4.1` companion UI, Settings, privacy, and
  reliability hardening candidate that prepares the codebase for GitHub release
  review.
- **What this PR is not:** the final tag or GitHub Release publication. Those
  still require the release gates to pass on the final pushed commit.
- **Why it is large:** the UI work needed source extraction plus matching audit
  scripts and tests so future edits do not quietly break the visual, privacy, or
  performance boundaries.
- **How to review it:** review by area instead of reading the diff strictly
  top-to-bottom.

Recommended review order:

| Order | Area | Files to start with | What to check |
|---:|---|---|---|
| 1 | Release/upload framing | `docs/GITHUB_UPLOAD_PREP.md`, `CHANGELOG.md`, `README.md` | Stable entry moves to `v0.4.1`; tag and release still wait for final gates. |
| 2 | Panel and Settings UI | `src/app/views/PanelView.tsx`, `src/components/SettingsDrawer.tsx`, `src/app/styles/panel-companion.css`, `src/app/settingsDrawerEntry.ts` | UI source is organized, Settings stays lazy, and the visual direction is guarded without freezing future design work. |
| 3 | UI contracts and references | `scripts/*surface-audit.mjs`, `scripts/image4-*`, `docs/*REFERENCE*.md`, `tests/*surface-audit.test.ts` | Source-only audits protect important surfaces without committing local screenshots. |
| 4 | Companion awareness and wake word | `src/features/context/*`, `src/features/hearing/companionWakeWordSync.ts`, related tests | Rough time language, check-in policy, custom companion names, and privacy boundaries stay explicit. |
| 5 | Privacy/security hardening | `electron/runtimeLogSanitizer.js`, `electron/services/*`, `scripts/*privacy*audit.mjs`, `scripts/error-redaction-*` | Logs, support buffers, message/privacy/vault paths, and redaction remain metadata-only where required. |
| 6 | Performance and packaging | `scripts/performance-baseline.mjs`, `scripts/source-size-audit.mjs`, `docs/PACKAGE_STARTUP_OPTIMIZATION.md` | Startup CSS, Settings lazy CSS, and Settings lazy JS budgets are enforced. |
| 7 | Icons and binary assets | `public/nexus-*`, `public/favicon.svg`, `public/nexus.ico`, `scripts/icon-source/nexus-icon-2048.png` | Visual assets are intentional and match the chosen app icon direction. |

Suggested reviewer notes:

- `docs/ui-qa/` is intentionally ignored; local screenshots and metrics should
  not be uploaded.
- The PR contains new generated-looking audit fixtures, but they are source
  tests and docs, not build output.
- `npm audit --omit=dev` was checked separately and reported zero
  vulnerabilities.
- Run the release gates listed below again on the final pushed commit before
  creating `v0.4.1`.

## Performance baseline

Latest local `npm run performance:baseline` result:

| Metric | Current | Budget |
|---|---:|---:|
| Total build assets | 27.64 MB | 35.00 MB |
| JavaScript | 3.88 MB | 5.00 MB |
| CSS | 852.4 KB | 900.0 KB |
| WASM | 21.60 MB | 25.00 MB |
| Largest JS chunk | 868.7 KB | 1.20 MB |
| Largest CSS chunk | 554.0 KB | 650.0 KB |
| Initial CSS chunk | 298.4 KB | 450.0 KB |
| Settings drawer lazy CSS | 554.0 KB | 600.0 KB |
| Settings drawer lazy JS entry | 0.1 KB | 100.0 KB |

Important boundary: `settingsDrawerEntry` must keep producing both a lazy CSS
chunk and a tiny lazy JS entry. If either disappears, `performance:baseline`
fails because it likely means Settings styles moved back into the startup path
or raw CSS was bundled into JavaScript again.

## Five upload checks

The current upload prep uses five checks. They cover formatting hygiene,
source-size drift, bundle/startup budgets, release/distribution wiring, and the
full PR gate.

| # | Check | Purpose | Latest local result |
|---:|---|---|---|
| 1 | `git diff --check` | No whitespace or patch-format errors before staging. | Pass |
| 2 | `npm run source-size:audit` | Large TypeScript, JavaScript, and CSS files stay inside explicit budgets. | Pass |
| 3 | `npm run performance:baseline` | Build assets, startup CSS, Settings lazy CSS, and Settings lazy JS stay inside budgets. | Pass |
| 4 | `npm run distribution:audit` | Release docs, installer config, privacy gates, and upload/release wiring stay aligned. | Pass |
| 5 | `npm run verify:pr` | Full TypeScript, lint, tests, build, UI audits, privacy audits, IPC audit, and distribution gate. | Pass |

Already passed locally on 2026-07-03:

```bash
git diff --check
npm run source-size:audit
npm run performance:baseline
npm run distribution:audit
npm run verify:pr
npm audit --omit=dev
```

Release-candidate gates also passed locally on 2026-07-03:

```bash
npm run verify:release
npm run prerelease-check -- v0.4.1 --skip=A --quick
npm run package:dir:smoke
```

`prerelease-check --skip=A --quick` finished with 24 pass, 0 warnings, and 0
failures. Stage A remains final-branch/tag only, so before creating the real
`v0.4.1` release tag on the final pushed commit, run:

```bash
npm run prerelease-check -- v0.4.1
```

## Git hygiene before push

- `docs/ui-qa/` is local evidence only and should stay ignored.
- Do not commit `dist/`, `release/`, `release-smoke/`, local model downloads,
  logs, or generated temporary audio files.
- Review binary icon changes before staging.
- Review all untracked files explicitly; this worktree contains many new audit,
  UI, and test files.
- Prefer a PR branch first. Do not push directly to `main` unless the maintainer
  decides this is ready to land.

## Suggested commit title

```text
Release v0.4.1 companion UI and reliability hardening
```

## Suggested PR title

```text
Release Nexus v0.4.1 companion UI, settings, and performance guardrails
```

## Suggested PR summary

```markdown
## Summary
- prepare the v0.4.1 companion UI/settings/reliability release candidate
- organize panel, Settings, and Image4 companion UI source while keeping local UI QA screenshots ignored
- add source-only audits and review docs for chat, Settings, composer, Image4, forms, focus, streaming, and agent-activity surfaces
- keep Settings drawer styles lazy-loaded and guard startup/open-settings performance budgets
- expand privacy/security audits for desktop context, message, vault, runtime log, and redacted error boundaries
- update version, README entry points, release notes, upload scope, review order, and release-gate requirements

## Verification
- git diff --check
- npm run source-size:audit
- npm run performance:baseline
- npm run distribution:audit
- npm run verify:pr
```
