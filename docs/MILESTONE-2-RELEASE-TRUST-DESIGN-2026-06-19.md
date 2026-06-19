# Milestone 2 Design - Release Trust and Update Hardening

## Problem Analysis

M1 made first-run model setup measurable and repairable. The next v1.0 blocker
is distribution trust: Nexus can already build installers, publish GitHub
Release assets, and wire `electron-updater`, but the trust posture differs by
platform.

Current state:

- Windows builds produce NSIS installers, but CI explicitly disables executable
  signing for the normal release matrix.
- macOS builds produce `.dmg` and `.zip` artifacts, but the package config keeps
  hardened runtime and Gatekeeper assessment disabled for unsigned local and
  beta builds.
- Linux builds produce AppImage, deb, tarball, `SHA256SUMS`, and optional GPG
  detached signatures when release secrets are configured.
- The app has an updater service, but unsigned macOS builds must not be treated
  as fully trusted automatic updates because the signed-app requirement belongs
  to the macOS update chain.

The immediate risk is not that the app cannot package; it is that docs and
release checks can imply a higher-trust update path than the artifacts actually
provide.

## Technical Design

M2 should harden release trust in small, reversible slices:

1. Add a local release-trust audit that classifies the current platform posture
   without reading certificates, environment secrets, user data, app settings,
   or keychain state.
2. Integrate that audit into the existing distribution audit so release-related
   config changes cannot silently remove the signing/update caveats.
3. Document the current unsigned posture separately from the future signed
   release path.
4. Keep local smoke builds working while Apple Developer ID and Windows signing
   infrastructure remain external prerequisites.
5. Later M2 slices can switch macOS to hardened runtime/notarization and Windows
   signing only after the required secrets and rollback plan exist.

## Impact Scope

- `scripts/release-trust-audit.mjs`
- `scripts/distribution-audit.mjs`
- `package.json` scripts
- release docs: `docs/RELEASING.md`, `README.md`
- architecture, roadmap, changelog, and focused tests

This slice does not change installer binaries, CI signing credentials,
auto-update runtime behavior, user data, settings, IPC, or storage.

## Risks

- The audit could become too rigid and block legitimate future signing config
  changes. To reduce that risk, it accepts either an explicit unsigned posture
  with documentation or a future signed-ready posture with signing prerequisites
  wired.
- Release documentation could still drift if platform policies change. The
  audit checks repo consistency, not external policy freshness.
- macOS users still need manual update/install guidance until a signed
  Developer ID build is shipped.

## Rollback Plan

- Revert the new audit script, package script, test, and distribution-audit
  integration.
- Keep existing packaging commands and release workflow unchanged.
- No migration or user-data rollback is required.

## Acceptance Criteria

- `npm run release:trust:audit` reports the current Windows, macOS, and Linux
  trust posture and exits non-zero only on undocumented or inconsistent release
  configuration.
- `npm run distribution:audit` includes the release-trust gate.
- Release docs clearly distinguish unsigned local/beta builds from trusted
  signed release behavior.
- macOS unsigned builds are documented as manual-update downloads until
  Developer ID signing is enabled.
- Tests cover the audit report and current posture.

## Implementation Slice 1 - Release Trust Audit Gate

Status: implemented in this branch; full M2 remains open.

Completed:

- Added `npm run release:trust:audit` for a local, no-secret release trust
  report.
- Classified the current macOS and Windows posture as explicit unsigned
  distribution with documented limitations rather than trusted signed release.
- Kept Linux integrity checks for `SHA256SUMS` and optional GPG signing.
- Integrated the trust audit into `npm run distribution:audit`.
- Updated release/user docs with signing prerequisites, macOS unsigned update
  caveats, rollback notes, and recovery expectations.

Not completed yet:

- macOS Developer ID signing, hardened runtime, and notarization are not enabled.
- Windows code signing is not enabled.
- End-to-end signed installer verification on macOS and Windows is not present.
- A signed-update transition test from unsigned macOS builds remains future work.

Known risks:

- Current macOS release artifacts remain installable only through the documented
  unsigned path, and updates should be treated as manual downloads until signed
  artifacts ship.
- The audit is repository-local evidence; it does not prove that external
  certificates, GitHub Actions secrets, or platform notarization services are
  available.

Validation results:

- `npm run release:trust:audit` passed with 6 OK, 2 documented warnings, and 0
  errors. The warnings are the current explicit unsigned macOS and Windows
  posture.
- `node --experimental-strip-types --test tests/release-trust-audit.test.ts`
  passed 2 focused tests.
- `npm run distribution:audit` passed with the release-trust gate included.
- `npm run lint` passed.
- `npm test` passed 1870 tests across 68 suites.
- `npm run build` passed.
- `npm run package:dir:smoke` passed; the packaged macOS app loaded the
  renderer successfully.

Packaged-smoke notes:

- The local smoke build still uses ad-hoc macOS signing and skips notarization.
- KWS/SenseVoice models were not installed in this environment.
- Python sidecars skipped OmniVoice and GLM-ASR because `torch` is not
  installed.

Suggested later M2 slice:

- Add a signed-release readiness mode that can be enabled in CI once Apple
  Developer ID and Windows signing secrets exist, then verify macOS
  hardened-runtime/notarization changes in a beta build before touching stable.

## Implementation Slice 2 - macOS Unsigned Check-Only Updates

Status: implemented in this branch; full M2 remains open.

Problem:

- The release docs correctly describe unsigned macOS builds as manual update
  downloads, but the runtime still attempted the normal `electron-updater`
  auto-download/install path in every packaged macOS build.

Design:

- Keep Windows and Linux on the existing `electron-updater` path.
- Resolve current packaged macOS builds to `manual-download` unless
  `NEXUS_MAC_AUTO_UPDATE_MODE=electron-updater` is explicitly set by a future
  signed release job.
- In `manual-download`, check the latest stable GitHub Release with a timeout,
  compare versions locally, and broadcast a `manual-update` event when a newer
  version exists.
- Reuse the existing updater install IPC as the button action, but open the
  safe GitHub Releases URL instead of calling `quitAndInstall`.

Rollback:

- Revert `electron/services/updatePolicy.js`,
  `electron/services/updaterService.js`, updater state/UI changes, locale copy,
  and tests.
- No user data, settings, IPC payload persistence, or migration rollback is
  required.

Known risks:

- GitHub reachability still controls update checks. Failures surface as updater
  errors but do not affect app startup.
- Future signed macOS CI must set `NEXUS_MAC_AUTO_UPDATE_MODE=electron-updater`
  after Developer ID signing and notarization are verified.

Validation results:

- `node --experimental-strip-types --test tests/update-policy.test.ts
  tests/updater-state.test.ts` passed 15 focused updater tests.
- `npm run release:trust:audit` passed with 7 OK, 2 documented warnings, and 0
  errors. The added OK verifies the macOS unsigned runtime fallback.
- `npm run i18n:audit` passed across all five locales with 2089 keys each.
- `npm run build` passed.
- `npm run lint` passed.
- `npm test` passed 1874 tests across 68 suites.
- `npm run distribution:audit` passed with the release-trust gate included.
- `npm run package:dir:smoke` passed; the packaged macOS app loaded the
  renderer and logged `unsigned macOS mode - using check-only release
  downloads`.

Packaged-smoke notes:

- The local smoke build still uses ad-hoc macOS signing and skips notarization.
- KWS/SenseVoice models were not installed in this environment.
- Python sidecars skipped OmniVoice and GLM-ASR because `torch` is not
  installed.

Suggested next M2 slice:

- Add a signed macOS CI readiness profile that requires Developer ID secrets,
  hardened runtime, notarization, and `NEXUS_MAC_AUTO_UPDATE_MODE=electron-updater`
  before the full macOS auto-install updater path can be enabled for releases.

## Implementation Slice 3 - Signed macOS Readiness Profile

Status: implemented in this branch; full M2 remains open.

Problem:

- Slice 2 prevents unsigned macOS builds from pretending to be trusted
  auto-install updates, but the future signed release path still lacked a
  concrete gate. Without a gate, a maintainer could set
  `NEXUS_MAC_AUTO_UPDATE_MODE=electron-updater` before Developer ID signing,
  hardened runtime, notarization, or release verification are actually ready.

Design:

- Extend `release:trust:audit` with an optional signed macOS readiness profile.
- Add `npm run release:signing:readiness` as a non-blocking report that is also
  printed in the release workflow preflight job.
- Add `npm run release:signing:gate` as the future hard gate. It is expected to
  fail today because current releases are intentionally unsigned.
- Check only repository config, docs, and secret names referenced by CI. The
  gate never reads certificate files, keychain state, GitHub secret values, API
  keys, user data, or app-local settings.

Current blockers reported by the gate:

- `build.mac.hardenedRuntime` is not `true`.
- `build.mac.notarize` is not `true`.
- `build.mac.gatekeeperAssess` is explicitly `false`.
- Release workflow still forces `CSC_IDENTITY_AUTO_DISCOVERY=false`.
- Release workflow does not wire the Apple signing secret names into the macOS
  package step.
- Release workflow does not set
  `NEXUS_MAC_AUTO_UPDATE_MODE=electron-updater` for a signed macOS job.

Rollback:

- Revert the optional readiness mode in `scripts/release-trust-audit.mjs`, the
  two package scripts, the non-blocking release workflow preflight step, tests,
  and docs.
- Existing unsigned packaging, manual macOS update fallback, and
  `distribution:audit` continue to work without data migration.

Known risks:

- The readiness profile proves that repository wiring is ready; it does not
  prove external Apple Developer credentials or notarization services are valid.
- Slice 3 covered signed macOS first. Windows signing remained explicit
  unsigned posture work until Slice 4 added a Windows readiness profile.

Validation results:

- `node --experimental-strip-types --test tests/release-trust-audit.test.ts`
  passed 4 focused release-trust tests.
- `npm run release:trust:audit` passed with 7 OK, 2 documented warnings, and 0
  errors.
- `npm run release:signing:readiness` passed with 7 OK, 3 documented warnings,
  and 0 errors; the extra warning lists the current signed macOS blockers.
- `npm run release:signing:gate` failed by design with 1 error because the
  signed macOS prerequisites are not yet wired.
- `npm run lint` passed.
- `npm test` passed 1876 tests across 68 suites.
- `npm run build` passed.
- `npm run distribution:audit` passed with the release-trust gate included.
- `npm run package:dir:smoke` passed; the packaged macOS app loaded the
  renderer and remained on unsigned check-only update mode.

Packaged-smoke notes:

- The local smoke build still uses ad-hoc macOS signing and skips notarization.
- KWS/SenseVoice models were not installed in this environment.
- Python sidecars skipped OmniVoice and GLM-ASR because `torch` is not
  installed.

Suggested next M2 slice:

- Add a Windows signed readiness profile before preparing a real signed beta
  branch.

## Implementation Slice 4 - Windows Signed Readiness Profile

Status: implemented in this branch; full M2 remains open.

Problem:

- Slice 3 made macOS signed-release blockers explicit, but Windows still only
  had the current unsigned posture warning. A maintainer could remove the
  SmartScreen caveat or forget that CI still passes
  `--config.win.signAndEditExecutable=false` without a platform-specific hard
  gate catching it.

Design:

- Extend the release trust audit with a Windows signed readiness profile.
- Keep `npm run release:signing:readiness` non-blocking and report both macOS
  and Windows blockers in CI preflight.
- Make `npm run release:signing:gate` require every signed platform profile.
- Add `npm run release:signing:gate:mac` and
  `npm run release:signing:gate:windows` so one platform can be brought up and
  verified without implying the other is ready.
- Accept either a certificate-file Windows signing path
  (`WINDOWS_CSC_LINK` + `WINDOWS_CSC_KEY_PASSWORD`) or a cloud-signing path via
  the `WINDOWS_SIGNING_*` secret group. The audit checks only secret names
  referenced by CI, never secret values.

Current Windows blockers reported by the gate:

- Release workflow still passes `--config.win.signAndEditExecutable=false`.
- Release workflow does not wire either accepted Windows signing secret group.
- A real signed beta still needs installer launch, SmartScreen, NSIS update,
  and rollback verification.

Rollback:

- Revert the Windows readiness branch in `scripts/release-trust-audit.mjs`, the
  platform-specific package scripts, tests, and docs.
- The existing unsigned Windows installer path, SmartScreen caveat, and
  `distribution:audit` continue to work without data migration.

Known risks:

- The readiness profile verifies repository wiring only. It does not prove a
  certificate file, cloud signing account, timestamp service, or SmartScreen
  reputation is valid.
- Windows signing provider selection remains an external release-management
  decision; this slice only prevents Nexus from treating that path as complete
  before the repo is wired.

Validation results:

- `node --experimental-strip-types --test tests/release-trust-audit.test.ts`
  passed 6 focused release-trust tests.
- `npm run release:trust:audit` passed with 7 OK, 2 documented warnings, and 0
  errors.
- `npm run release:signing:readiness` passed with 7 OK, 4 documented warnings,
  and 0 errors; the added warning lists the current Windows signed-release
  blockers.
- `npm run release:signing:gate` failed by design with 2 errors because both
  macOS and Windows signed-release prerequisites are not yet wired.
- `npm run release:signing:gate:mac` failed by design with 1 macOS readiness
  error and kept Windows readiness as a warning.
- `npm run release:signing:gate:windows` failed by design with 1 Windows
  readiness error and kept macOS readiness as a warning.
- `npm run lint` passed.
- `npm test` passed 1878 tests across 68 suites.
- `npm run i18n:audit` passed across all five locales with 2089 keys each.
- `npm run build` passed.
- `npm run distribution:audit` passed with the release-trust gate included.
- `npm run package:dir:smoke` passed; the packaged macOS app loaded the
  renderer and remained on unsigned check-only update mode.
- `git diff --check` passed.

Packaged-smoke notes:

- The local smoke build still uses ad-hoc macOS signing and skips notarization.
- KWS/SenseVoice models were not installed in this environment.
- Python sidecars skipped OmniVoice and GLM-ASR because `torch` is not
  installed.

Suggested next M2 slice:

- Choose the real Windows signing provider and/or prepare a signed macOS beta
  branch with the matching hard gate enabled in CI for that beta branch only.
