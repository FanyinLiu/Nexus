# Nexus v0.4.4 — Maintenance And Hardening

**Status: Stable unsigned release.** v0.4.4 is the current stable version and
this document is its formal release record. Publication and platform assets are
created only from the release commit by the protected tag workflow; this
document does not claim that a GitHub asset exists before that workflow succeeds.

For this release only, the maintainer explicitly waived the normal multi-day
beta window after reviewing the complete automated release gate. v0.4.4 is a
maintenance and hardening slice with no user-visible behavior change, so a
multi-day conversation validation window is not meaningful for it. Final
binaries must still be rebuilt by the protected workflow. No multi-day or
cross-platform physical-device evidence is claimed.

v0.4.4 builds on the stable v0.4.3 companion surface release. It ships no new
features and no behavior changes: the companion surface, check-in policy,
Settings contract, privacy boundary, and localized copy are identical to
v0.4.3. What users get is a safer, more current foundation.

## What Changed

### Security

- **CVE-2026-14257** — the bundled dependency stack now carries the patched
  `brace-expansion` releases (1.1.18 / 2.1.4 / 5.0.9), closing a
  denial-of-service issue in a widely used transitive dependency.

### Stability updates

- Electron 43.2.0, the on-device inference runtime
  (`@huggingface/transformers` 4.2.0), and the Live2D rendering stack
  (pixi.js 8.19.0 + `@jannchie/pixi-live2d-display` 1.4.0) all move to
  current releases, picking up upstream crash and compatibility fixes.
- A boot fix: the Live2D UMD vendor bundle now inlines `process.env`,
  repairing a startup path that could end on a boot-failed screen.

### Toolchain upgrade

- ESLint 10.7.0 and TypeScript 7.0.2, with the `typescript6@6.0.3` dual-stack
  shim kept for tooling that still requires the classic compiler.
- ESLint 10's `no-useless-assignment` (38 sites) and `preserve-caught-error`
  (24 sites) rules are enabled and cleaned to zero violations.

### Codebase structure

- **Circular-dependency elimination** — the pet, agent, chat, and prompts
  modules now share extracted type modules, breaking the import cycles
  between them.
- **Large-file splits** — i18n locales are split per namespace,
  `localDataStore` is split into core and chat domains, and `windowManager`
  has window creation and runtime state extracted into focused modules.

### CI and release pipeline

- Added a repo-root `.npmrc` with `legacy-peer-deps=true` so CI `npm ci`
  resolves the current peer-dependency graph, and relaxed the stale
  `minimatch` override key to `minimatch@10` so the lockfile stays in sync.
- The release pipeline now verifies size and SHA-256 for the four
  `dist/vendor/ort/` WebAssembly files, so a truncated or corrupted inference
  runtime cannot ship silently.

### Tests and documentation

- Added a focused suite (3 cases) for cross-window chat synchronization over
  `BroadcastChannel`, including echo prevention between windows.
- Added `docs/BEHAVIOR_MAP.md`, a navigation map for coding agents that ties
  user-visible behaviors to the source modules that implement them.

## Deferred scope

- The beta feedback and copy tuning slice once planned under the v0.4.4
  number never merged into main; it was later evaluated and dropped because
  no beta program is planned and its copy guardrails already shipped in other
  form with v0.4.3.
- The `eslint-plugin-react-hooks` 7.1.1 upgrade was pending at release time
  and landed on main shortly after (all 58 new-rule violations cleared).

## Unsigned Distribution Contract

Official GitHub Releases are the only supported binary source. v0.4.4 targets
macOS arm64, Windows x64, and Linux x64; it does not claim a macOS x64 or
universal artifact. Signing and notarization posture is unchanged from
v0.4.3.

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

Unchanged from v0.4.3. Desktop companion awareness still produces only
short-lived, coarse, sanitized summaries; pausing stops collection and model
reach; raw window titles, screenshots, clipboard bodies, message bodies, file
paths, exact timers, and desktop activity timelines stay out of the model
boundary.

## Not Included

- No new features, UI changes, prompt changes, or companion-behavior changes.
- No changes to the check-in policy, privacy boundary, or Settings contract.
- No v0.5 desktop pet mouse-following, typing reactions, or window control.
