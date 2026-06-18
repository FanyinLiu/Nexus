# Nexus v1.0 M2 Distribution And Update Trust

This note is the implementation contract for M2. It makes installation,
update metadata, signing posture, unsigned fallback, and release evidence
machine-checkable without storing signing secrets or operator-private data.

## Objective

Make macOS, Windows, and Linux distribution predictable enough for a beta user
or release operator to know which installer to download, how updates are
delivered, which integrity guarantees exist, and where unsigned-build caveats
still apply.

## Problem Analysis

Nexus already has Electron Builder targets, a GitHub release workflow,
`electron-updater`, Linux checksums, optional GPG signing, and a distribution
audit. The gap is evidence shape: `distribution:audit` is a useful hard check,
but it prints process output instead of writing a reusable v1 milestone
artifact. M2 also needs to avoid overstating trust. macOS and Windows binaries
are currently unsigned by policy/cost, so a correct gate must prove that this
is explicit and documented rather than pretending signed distribution is done.

## Technical Design

`scripts/m2-distribution-trust-audit.mjs` reads `package.json`,
`.github/workflows/release.yml`, `docs/RELEASING.md`, `README.md`,
`electron/services/updaterService.js`, and `electron/preload.js`. It writes a
private-safe JSON report with:

- package scripts for platform builds, smoke packaging, prerelease checks, and
  release verification;
- Electron Builder targets for Windows NSIS, macOS dmg/zip, and Linux
  AppImage/deb;
- GitHub publish/update metadata and `electron-updater` dependency posture;
- release workflow checks for tag triggers, draft release safety, preflight
  gating, platform assets, updater metadata, Linux `SHA256SUMS`, and optional
  GPG signatures;
- updater runtime wiring for background downloads, downgrade blocking, dev-mode
  skip, and renderer status APIs;
- signing posture that distinguishes signed artifacts from documented unsigned
  fallback.

The audit reports `ready-with-documented-unsigned-fallback` when all installer,
update, integrity, and documentation checks are present. It does not require
Apple Developer ID, Windows certificates, or GPG private keys to exist in the
repository.

`scripts/packaged-smoke.mjs` can now write private-safe M2 package-smoke
evidence when `PACKAGED_SMOKE_EVIDENCE_FILE` is set. The report records the
platform, sanitized release directory, executable kind, timeout, and pass/fail
status, but omits absolute executable paths, user home paths, signing secrets,
and operator notes. `m2:distribution:trust -- --require-package-smoke` consumes
those records and requires Windows, macOS, and Linux evidence before passing.

## Impact Scope

Docs, package scripts, release audit tooling, and v1 milestone governance. No
runtime app behavior, installer target, signing secret, IPC surface, or storage
schema changes.

## Risks

String-based workflow checks can drift if the release workflow is heavily
refactored. The audit proves configuration and docs, not that a real GitHub
Actions run has completed. Signed macOS/Windows distribution remains a future
external-cost decision.

## Rollback Plan

Remove `scripts/m2-distribution-trust-audit.mjs`, its package script,
distribution-audit references, the M2 evidence-gate entry in
`scripts/v1-milestone-audit.mjs`, this document, and the changelog/roadmap
notes. Runtime builds and user data are unaffected.

## Data Migration And Rollback

No user data migration. The audit writes only optional JSON artifacts under
`artifacts/v1/`, which is an ignored evidence directory. No rollback transform
is required.

## Tests And Evidence

Run:

```bash
npm run m2:distribution:trust -- --output artifacts/v1/m2-distribution-trust.json --require-ready
npm run m2:package-smoke:current
npm run m2:distribution:trust -- --package-smoke-dir artifacts/v1 --require-package-smoke --output artifacts/v1/m2-distribution-trust.json
node --experimental-strip-types --test tests/m2-distribution-trust-audit.test.ts tests/v1-milestone-audit.test.ts
npm run distribution:audit
```

Release-level verification should also keep running:

```bash
npm run verify:release
npm run v1:milestone:audit -- --output artifacts/v1/milestone-audit.json --require-ready
```

## User Documentation

README installation notes now keep the normal user path on GitHub Releases and
state the unsigned fallback plainly: macOS may require the documented
`xattr -dr` path, Windows may show SmartScreen, and Linux artifacts can be
checked with `SHA256SUMS` plus optional GPG signatures.

## Acceptance Results

M2 scaffold is implemented as a private-safe report generator. It currently
accepts the existing unsigned macOS/Windows posture only because the fallback
is documented and Linux has checksum plus optional detached-signature support.
Package-smoke evidence can now be recorded from real packaged builds and made
blocking with `--require-package-smoke`. The v1 milestone audit now also
consumes this report in strict acceptance mode, so release-candidate checks
block on M2 until Windows, macOS, and Linux package-smoke records are attached.
Real platform records still need to be captured by release operators before M2
can graduate beyond configuration evidence.

## Known Gaps

- macOS Developer ID signing and notarization remain deferred.
- Windows certificate signing remains deferred.
- Linux GPG signing is optional until a release key is configured.
- This audit does not inspect a completed GitHub Actions run or downloaded
  release assets yet, beyond package-smoke evidence files provided by the
  operator.

## Next Stage Tasks

- Capture real package-smoke evidence on Windows, macOS, and Linux after a
  workflow run and rerun the strict `--require-package-smoke` gate.
- Add signing/notarization evidence fields once certificates exist.
- Keep `npm run v1:milestone:audit -- --m2-trust-file artifacts/v1/m2-distribution-trust.json --require-acceptance-evidence`
  in release-candidate checks so missing M2 package-smoke platforms stay
  visible at the top-level v1 gate.
