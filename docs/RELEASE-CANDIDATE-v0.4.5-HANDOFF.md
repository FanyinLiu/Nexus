# Nexus v0.4.5 Stable Release Handoff

Phase: Stable release commit → protected tag workflow → verified publication.

Status: Stable unsigned release handoff.

Boundary: v0.4.5 is the current stable version. The release commit and platform
assets are published only by the protected tag workflow; this handoff does not
claim that GitHub assets exist before that workflow succeeds.

v0.4.5 followed the standard beta flow with no maintainer exception:
`v0.4.5-beta.1` was published as a GitHub pre-release on 2026-08-03 after the
full automated gate (prerelease-check 30/30, verify:release, CI green on all
three platforms), and the beta validation window ran from 2026-08-03 to
2026-08-06. The v0.4.5 beta window surfaced two release-path defects — the
Linux deb version normalization comparison and the stale-draft tag-binding
failure — both fixed and recorded in [RELEASING.md](RELEASING.md). No
cross-platform physical-device validation is claimed.

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

v0.4.5 carries everything on main since the v0.4.4 tag: the memory integrity
slice (two-tier contradiction demotion, default-on local-data migration with
rollback and authorization), companion presence driven by the real main-process
request lifecycle (`thinking` / `waiting` / `offline` / `error`), the two beta
release-path fixes, and the accumulated maintenance — react-hooks 7.1.1
cleanup, import extension unification, IPC schema reject-unknown-fields
rollout, vault IPC schema coverage, SSRF hardening, errand/voice/chat/storage
reliability fixes, legacy settings panel and TTS pipeline removal, dead-code
cleanup, mirrored-contract single-sourcing (~2,600 lines), and the root
`AGENTS.md` conventions.

## Evidence boundary

Local gate evidence collected on the release working tree (2026-08-06):

- `npm test` — passed locally with 2,749 tests.
- `npm run v04:draft-stack:audit` — passed with `ok=true`; current stable
  release `v0.4.5`, previous public release `v0.4.4`, no draft layer in
  flight, 0 errors.
- `npm run verify:release` — remains the final pre-tag gate and is run by the
  maintainer on the clean release commit before tagging.
- CI on the release commit must be green on all three platforms before the
  tag is created.

No local staging app, DMG, ZIP, or recorded hash is claimed as releasable.
Final macOS, Windows, and Linux assets must be rebuilt from the merged release
commit by protected CI and pass the remote checksum closure.

## Remaining review gates

- Cross-platform physical-device validation was not performed; it is not
  represented as completed evidence.
- PR CI and the protected tag workflow must reproduce the applicable gates
  from clean checkouts.
- Tag creation and GitHub publication remain explicit maintainer actions after
  the matching gates pass and the release commit reaches `main`.

## Handoff rule

The former v0.4.5 release-hardening draft review layer is closed; its evidence
stays in `RELEASE-CANDIDATE-v0.4.5-DRAFT-HARDENING.md` as a historical record.
No later draft layer is in flight. Publish v0.4.5 only through the protected
tag workflow and retain all unsigned-platform caveats.
