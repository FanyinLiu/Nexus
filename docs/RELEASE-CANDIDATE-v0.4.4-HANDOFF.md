# Nexus v0.4.4 Stable Release Handoff

Phase: Stable release commit → protected tag workflow → verified publication.

Status: Stable unsigned release handoff.

Boundary: v0.4.4 is the current stable version. The release commit and platform
assets are published only by the protected tag workflow; this handoff does not
claim that GitHub assets exist before that workflow succeeds.

For v0.4.4 only, the maintainer explicitly waived the normal multi-day beta
window after reviewing the complete automated release gate: v0.4.4 is a
maintenance and hardening slice with no user-visible behavior change, so a
multi-day conversation validation window is not meaningful for it. No
multi-day conversation evidence or cross-platform physical-device validation
is claimed. The exception is recorded in
[RELEASING.md](RELEASING.md) next to the v0.4.3 precedent and does not change
the default policy for v0.4.5 or later.

## Distribution contract

- Official `https://github.com/FanyinLiu/Nexus/releases` is the only supported
  binary source.
- macOS is arm64 only and ad-hoc signed. Ad-hoc does not equal Apple Developer
  ID trust or notarization; Gatekeeper prompts remain expected, and users may
  need right-click → Open or `xattr -dr com.apple.quarantine` on first launch.
- Windows is x64 with an NSIS installer whose signature state is `NotSigned`;
  SmartScreen prompts remain expected.
- Each platform publishes a separate checksum list beside its artifacts:
  `SHA256SUMS-windows.txt`, `SHA256SUMS-macos.txt`, and `SHA256SUMS-linux.txt`.

### macOS unsigned auto-update limitation

The app may check for a newer version and open the official release page, but
it does not silently download, replace, or restart the app. Users manually
download the next `.dmg` / `.zip`, handle Gatekeeper again, and replace the app.

### Windows unsigned installer limitation

The installer cannot provide verified publisher identity or stable SmartScreen
reputation. Users must confirm the artifact came from the official GitHub
Release before choosing to run it.

## Release content boundary

v0.4.4 carries the 18 commits on main since the v0.4.3 tag: the toolchain
upgrade (ESLint 10.7, TypeScript 7.0.2 dual-stack, Electron 43.2.0,
`@huggingface/transformers` 4.2.0, pixi.js 8.19.0), circular-dependency
elimination, large-file splits (i18n, `localDataStore`, `windowManager`), two
new ESLint rules cleaned to zero, the Live2D UMD `process.env` boot fix, the
`brace-expansion` CVE-2026-14257 fix, CI fixes (`.npmrc` + `minimatch`
override), release-pipeline ORT wasm verification, cross-window chat sync
tests, and the `BEHAVIOR_MAP` doc. There is no user-visible new feature.

The beta feedback and copy tuning slice once planned under the v0.4.4 number
never merged into main and is deferred to a later release.

## Evidence boundary

Local gate evidence collected on the release working tree (2026-07-31):

- `npx node --experimental-strip-types --test tests/project-alignment.test.ts
  tests/release-spotlight.test.ts tests/v04-draft-stack-audit.test.ts` —
  passed; the four previously failing stable-boundary cases are green against
  the v0.4.4 boundary.
- `npm run v04:draft-stack:audit:quick` and `npm run v04:draft-stack:audit` —
  passed with `ok=true`; current stable release `v0.4.4`, previous public
  release `v0.4.3`, draft releases `v0.4.5`, 0 errors.
- `npm run i18n:audit` — passed; the new v0.4.4 release-spotlight keys are
  present and translated in all five locales.
- `npm run lint` — passed.
- `npm test` — passed locally with 2,989 tests.
- `npm run verify:release` — remains the final pre-tag gate and is run by the
  maintainer on the clean release commit before tagging.

No local staging app, DMG, ZIP, or recorded hash is claimed as releasable.
Final macOS, Windows, and Linux assets must be rebuilt from the merged release
commit by protected CI and pass the remote checksum closure.

## Remaining review gates

- Human studies and multi-day real-user validation were explicitly waived for
  v0.4.4; they are not represented as completed evidence.
- PR CI and the protected tag workflow must reproduce the applicable gates
  from clean checkouts.
- Tag creation and GitHub publication remain explicit maintainer actions after
  the matching gates pass and the release commit reaches `main`.

## Handoff rule

Keep v0.4.4 separate from the v0.4.5 draft. The v0.4.5 release-hardening
review layer stays a non-shipping boundary fixture and must not claim stable
status. Publish v0.4.4 only through the protected workflow and retain all
unsigned-platform caveats.
