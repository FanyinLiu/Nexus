# GitHub Upload Prep - Nexus v0.4.3 stable unsigned publication

Date: 2026-07-16

This document is the upload note for the current Nexus worktree. It is written
for GitHub review and should be updated if another verification pass changes
the numbers below.

## Current state

- Package version: `0.4.3`.
- Current stable version: `0.4.3`.
- Current branch: `codex/v0.4.3-unsigned-release`.
- Remote: `origin` -> `https://github.com/FanyinLiu/Nexus`.
- Release state: prepare the v0.4.3 stable release commit for publication by
  the protected tag workflow. This preparation document does not claim that
  the tag or GitHub assets exist before that workflow succeeds.
- v0.4.4 and v0.4.5 remain separate drafts and are not part of this release.
  Their minimal release-state entries remain in this branch only as forward
  audit fixtures that prevent either draft from being presented as stable;
  they are not executable v0.4.3 product content.
- For v0.4.3 only, the maintainer explicitly waived the normal multi-day beta
  window after reviewing the complete automated gate, local staging checks,
  and the protected cross-platform artifact contract. No multi-day use or
  cross-platform physical-device evidence is claimed.

This document is an upload/review inventory. The 2026-07-14 evidence snapshot
below remains historical and fingerprint-bound. A separate 2026-07-16 local
acceptance record covers the current source tree. Earlier local package outputs
were later disqualified and do not substitute for gates on the final clean
pushed tag.

## Unsigned distribution contract

- Official `https://github.com/FanyinLiu/Nexus/releases` is the only binary
  source.
- macOS is arm64 only and ad-hoc signed; ad-hoc does not equal Apple trust or
  notarization, and Gatekeeper prompts are expected.
- Windows is x64 and the NSIS installer is `NotSigned`; SmartScreen prompts are
  expected.
- Each platform publishes a separate checksum list beside its assets:
  `SHA256SUMS-windows.txt`, `SHA256SUMS-macos.txt`, and
  `SHA256SUMS-linux.txt`.

### macOS unsigned auto-update limitation

The app checks for new versions and opens the official release page. It does
not silently download or replace the app; every update is a manual download and
application replacement.

### Windows unsigned installer limitation

The installer cannot establish verified publisher identity or stable
SmartScreen reputation. Users must confirm the official GitHub source before
choosing to run it.

## Current stable-promotion evidence — 2026-07-16

This is source and staging evidence for the release commit, not evidence that
final GitHub assets already exist:

- `npm run verify:release`: pass, including **2,983/2,983** tests across 69
  suites, fresh build, SQLite smoke, and the packaged Electron core-path smoke.
- Source and `dist` shared build
  fingerprint
  `00d009678f1ad1e6b3c93a991ad813a2afacd1216d236660bf39ad0101771b23`
  across 986 deterministic inputs.
- Current performance baseline: 27.45 MB total assets, 3.93 MB JavaScript,
  612.0 KB CSS, 21.60 MB WASM, and a 69.3 KB Settings drawer entry; every
  configured budget passed with a fresh build.
- **Superseded package evidence:** the earlier local macOS staging app, DMG,
  ZIP, and their recorded hashes are not releasable. Inspection found a
  residual `.nexus-sensevoice-*/model.tar.bz2.partial-*` download fragment in
  the package resources. Those containers must not be staged or uploaded.
- **Current clean local macOS evidence:** after the transient-resource guard
  landed, the arm64 staging app, DMG, and ZIP were rebuilt from the matching
  `00d009...` source/dist fingerprint. App and both containers passed the
  explicit unsigned verifier; no `.nexus-*`, `.partial*`, or model archive
  residue was present. The local DMG SHA-256 is
  `fbba5df0db10c8376f71bd974175114fef415df33289273267435b75215f20d3` and
  the ZIP SHA-256 is
  `e7f566778115fa97d1dcf22e17fdd9cdd7beedb72614eaed827967db92c435a7`.
  These hashes are local acceptance evidence only, not publishable assets.
- Final macOS, Windows, and Linux packages must be rebuilt from the merged
  release commit by the protected workflow. Only the workflow-generated assets
  and checksum files that pass the remote closure gate are release evidence.
- Updater metadata now binds `version`, `path`, every `files` entry, size, and
  SHA-512 to the real artifacts. The protected workflow redownloads and
  verifies the complete remote asset set in the same final step that publishes
  the draft.
- Windows and Linux package/resource verifiers are covered by focused tests,
  but their real installers still belong to the protected platform CI jobs;
  this Mac-local record does not claim physical Windows/Linux installation.

Package output and downloaded voice models remain local generated files and
must not be staged. Stable Stage E must pass on the final release commit before
the stable tag is created.

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

This should be opened as one large `v0.4.3` stable-release preparation PR. The branch is
broader than a small patch: it changes UI source organization, Settings surface
contracts, Image4 companion-panel structure, privacy/security audits, release
docs, icon assets, and verification scripts in one prepared worktree.

Use this framing in the PR description:

- **What this PR is:** a `v0.4.3` companion UI, Settings, privacy, reliability,
  and unsigned-distribution hardening pass that prepares the stable release
  commit.
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
| 1 | Release/upload framing | `docs/GITHUB_UPLOAD_PREP.md`, `CHANGELOG.md`, `README.md` | v0.4.3 is the current stable entry; publication still goes through the protected tag workflow and preserves unsigned-platform caveats. |
| 2 | Panel and Settings UI | `src/app/views/PanelView.tsx`, `src/components/SettingsDrawer.tsx`, `src/app/styles/panel-companion.css`, `src/app/settingsDrawerEntry.ts` | UI source is organized, Settings stays lazy, and the visual direction is guarded without freezing future design work. |
| 3 | UI contracts and references | `scripts/*surface-audit.mjs`, `scripts/image4-*`, `docs/*REFERENCE*.md`, `tests/*surface-audit.test.ts` | Source-only audits protect important surfaces without committing local screenshots. |
| 4 | Companion awareness and wake word | `src/features/context/*`, `src/features/hearing/companionWakeWordSync.ts`, related tests | Rough time language, check-in policy, custom companion names, and privacy boundaries stay explicit. |
| 5 | Privacy/security hardening | `electron/runtimeLogSanitizer.js`, `electron/services/*`, `scripts/*privacy*audit.mjs`, `scripts/error-redaction-*` | Logs, support buffers, message/privacy/vault paths, and redaction remain metadata-only where required. |
| 6 | Performance and packaging | `scripts/performance-baseline.mjs`, `scripts/source-size-audit.mjs`, `docs/PACKAGE_STARTUP_OPTIMIZATION.md` | Startup CSS, Settings lazy CSS, and Settings lazy JS budgets are enforced. |
| 7 | Icons and binary assets | `public/nexus-*`, `public/favicon.svg`, `public/nexus.ico`, `scripts/icon-source/nexus-icon-2048.png` | Visual assets are intentional and match the chosen app icon direction. |

Suggested reviewer notes:

- `docs/ui-qa/` and `artifacts/` are intentionally ignored; local screenshots,
  audit reports, and metrics should not be uploaded.
- The PR contains new generated-looking audit fixtures, but they are source
  tests and docs, not build output.
- The 2026-07-14 snapshot also recorded `npm audit --omit=dev` separately with
  zero vulnerabilities; rerun it for the final clean release commit.
- Run the release gates listed below again on the clean pushed release commit;
  this local evidence does not authorize tag creation or publication.

## Historical performance snapshot — 2026-07-14

Recorded `npm run performance:baseline` result for fingerprint
`6fdbb74c47e72f748acf38c281001412a8dc8e1fe2a29119bc4ebeb37c266e88`:

| Metric | Recorded | Budget |
|---|---:|---:|
| Total build assets | 27.44 MB | 35.00 MB |
| JavaScript | 3.93 MB | 5.00 MB |
| CSS | 611.8 KB | 710.0 KB |
| WASM | 21.60 MB | 25.00 MB |
| Largest JS chunk | 868.6 KB | 1.20 MB |
| Largest CSS chunk | 234.2 KB | — |
| Initial CSS chunk | 234.2 KB | 260.0 KB |
| OnboardingGuide lazy CSS | 22.7 KB | 30.0 KB |
| Settings lazy CSS aggregate (6 chunks) | 264.6 KB | 330.0 KB |
| Largest Settings CSS chunk | 142.6 KB | 200.0 KB |
| Settings drawer lazy JS entry | 69.1 KB | 100.0 KB |
| Settings UI JS aggregate (14 chunks) | 159.1 KB | 390.0 KB |
| Largest Settings UI JS chunk | 28.8 KB | 390.0 KB |

Important boundary: `settingsDrawerEntry` must keep the Settings styles lazy;
the recorded snapshot contained six Settings style chunks plus residual shared CSS,
together with a tiny lazy JS entry and bounded `settings-ui` chunks for the main
settings implementation. If these lazy outputs disappear or collapse back into
the startup path, `performance:baseline` fails.

## Five upload checks

The final upload prep requires five checks. They cover formatting hygiene,
source-size drift, bundle/startup budgets, release/distribution wiring, and the
full PR gate. Results in this table are the 2026-07-14 historical snapshot, not
a current-worktree verification.

| # | Check | Purpose | 2026-07-14 snapshot result |
|---:|---|---|---|
| 1 | `git diff --check` | No whitespace or patch-format errors before staging. | Pass |
| 2 | `npm run source-size:audit` | Large TypeScript, JavaScript, and CSS files stay inside explicit budgets. | Pass |
| 3 | `npm run performance:baseline` | Build assets, startup CSS, Settings lazy CSS, and Settings lazy JS stay inside budgets. | Pass |
| 4 | `npm run distribution:audit` | Release docs, installer config, privacy gates, and upload/release wiring stay aligned. | Pass |
| 5 | `npm run verify:pr` | Full TypeScript, lint, tests, build, UI audits, privacy audits, IPC audit, and distribution gate. | Pass: 2,921/2,921 tests |

The following source/build checks were recorded for the 2026-07-14
fingerprint-bound worktree snapshot:

```bash
git diff --check
npm run source-size:audit
npm run performance:baseline
npm run distribution:audit
npm run verify:pr
npm audit --omit=dev
```

## Historical local snapshot — 2026-07-14

- At that snapshot, `npm run verify:pr` recorded **2,921/2,921** tests passed.
- Snapshot source, `dist`, and packaged input fingerprint:
  `6fdbb74c47e72f748acf38c281001412a8dc8e1fe2a29119bc4ebeb37c266e88`.
- Snapshot-fingerprint visual matrix: **20/20** accepted across warm-day/night,
  720×640/300×480, and five zh-CN Settings states.
- Native hidden lifecycle: **4/4** cycles with at least five seconds hidden and
  zero hidden Live2D/ticker growth.
- Live2D remount: **5/5** cycles with one shell/canvas and first-frame proof.

These are historical, fingerprint-bound smoke results. They do not cover the
current source tree or a formal Nexus release package, and they also do not
cover every locale, Settings destination, native OS compositor, signed trust
path, external provider, GPU long-run, or non-macOS physical-device installation.

The release gates must be repeated on the final clean stable release commit:

```bash
npm run verify:release
npm run prerelease-check -- v0.4.3
npm run package:dir:smoke
npm run runtime:packaged-sustained
```

The historical packaged runtime report is a passing `Nexus Smoke.app` report
for the snapshot fingerprint above. It does not prove the current source tree
or a formal unsigned macOS arm64 Nexus package. Repeat the full gate for
`v0.4.3` on its clean release commit before creating the stable tag. Final
platform assets are accepted only after protected CI rebuilds and verifies them.

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
Prepare Nexus v0.4.3 stable release
```

## Suggested PR title

```text
Prepare Nexus v0.4.3 stable unsigned release
```

## Suggested PR summary

```markdown
## Summary
- prepare the v0.4.3 stable release commit under the documented one-version beta waiver
- organize panel, Settings, and Image4 companion UI source while keeping local UI QA screenshots ignored
- add source-only audits and review docs for chat, Settings, composer, Image4, forms, focus, streaming, and agent-activity surfaces
- keep Settings drawer styles lazy-loaded and guard startup/open-settings performance budgets
- expand privacy/security audits for desktop context, message, vault, runtime log, and redacted error boundaries
- update version, README entry points, release notes, upload scope, review order, and release-gate requirements
- document macOS arm64 manual updates, Windows x64 `NotSigned`/SmartScreen, and Linux x64 SHA-256 verification

## Verification
- git diff --check
- npm run source-size:audit
- npm run performance:baseline
- npm run distribution:audit
- npm run verify:pr
```
