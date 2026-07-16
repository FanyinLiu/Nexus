# Nexus v0.4.3 Stable Release Handoff

Phase: Stable release commit → protected tag workflow → verified publication.

Status: Stable unsigned release handoff.

Boundary: v0.4.3 is the current stable version. The release commit and platform
assets are published only by the protected tag workflow; this handoff does not
claim that GitHub assets exist before that workflow succeeds.

For v0.4.3 only, the maintainer explicitly waived the normal multi-day beta
window after reviewing the complete automated release gate, local staging
checks, and protected platform contracts. No multi-day conversation evidence
or cross-platform physical-device validation is claimed.

## Distribution contract

- Official `https://github.com/FanyinLiu/Nexus/releases` is the only supported
  binary source.
- macOS is arm64 only and ad-hoc signed. Ad-hoc does not equal Apple Developer
  ID trust or notarization; Gatekeeper prompts remain expected.
- Windows is x64 with an NSIS installer whose signature state is `NotSigned`;
  SmartScreen prompts remain expected.
- Each platform publishes a separate checksum list beside its artifacts:
  `SHA256SUMS-windows.txt`, `SHA256SUMS-macos.txt`, and
  `SHA256SUMS-linux.txt`.

### macOS unsigned auto-update limitation

The app may check for a newer version and open the official release page, but
it does not silently download, replace, or restart the app. Users manually
download the next `.dmg` / `.zip`, handle Gatekeeper again, and replace the app.

### Windows unsigned installer limitation

The installer cannot provide verified publisher identity or stable SmartScreen
reputation. Users must confirm the artifact came from the official GitHub
Release before choosing to run it.

## Evidence boundary

The current source tree passed `npm run verify:release` with 2,983/2,983 tests.
Source and `dist` match fingerprint
`81d717c4c44d342c701205f02d8e5b772e3f4ef15053e23bc50901357b8deb65`
across 986 inputs.

The earlier local macOS staging app, DMG, ZIP, and recorded hashes are
**superseded and not releasable**: inspection found a residual
`.nexus-sensevoice-*/model.tar.bz2.partial-*` download fragment in package
resources. Final macOS, Windows, and Linux assets must be rebuilt from the
merged release commit by protected CI and pass the remote checksum closure.

### Historical snapshot

The 2026-07-14 local smoke snapshot is bound to source/build fingerprint
`6fdbb74c47e72f748acf38c281001412a8dc8e1fe2a29119bc4ebeb37c266e88`.
It records source contracts, focused tests, documentation consistency, privacy
boundaries, visual review, and packaged lifecycle behavior for `Nexus Smoke.app`.
It is historical evidence only: it does not cover the current source tree, a
formal Nexus release package, or future GitHub CI artifacts built from a pushed
tag.

## Remaining review gates

- Human studies and multi-day real-user validation were explicitly waived for
  v0.4.3; they are not represented as completed evidence.
- The automated gates passed locally but must be rerun on the final clean
  pushed commit, including fresh build, performance, distribution, prerelease
  wiring, unsigned platform artifacts, and the packaged Electron cutover.
- Stable Stage E must pass on the clean release commit.
- Tag creation and GitHub publication remain explicit maintainer actions after
  the matching gates pass and the release commit reaches `main`.

## Handoff rule

Keep v0.4.3 separate from the later v0.4.4/v0.4.5 drafts. Publish v0.4.3 only
through the protected workflow and retain all unsigned-platform caveats.
