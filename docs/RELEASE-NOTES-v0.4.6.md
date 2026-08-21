# Nexus v0.4.6 — Avatar Runtime Reliability

**Status: Stable unsigned release.** v0.4.6 is the current stable version and
this document is its formal release record. v0.4.6 was promoted through the
standard beta flow after the v0.4.6-beta.1 validation window. Official assets
are created only from the release commit by the protected tag workflow.

v0.4.6 is a focused reliability release for the desktop companion. It improves
transparent Live2D compositing, recovers from bounded WebGL context loss, and
keeps the companion readable when graphics initialization cannot complete.

## What changed

### Avatar runtime reliability

- Live2D now uses straight-alpha WebGL output to avoid white fringe pixels when
  Electron composites transparent companion windows on macOS.
- Pixi's local ImageBitmap capability probe is allowed through the narrow
  renderer CSP boundary without widening remote access.
- Lost WebGL contexts rebuild the owned Pixi application, canvas, and model with
  a bounded recovery budget. Repeated failure stops retrying and keeps a
  readable localized fallback instead of entering a restart loop.
- The three-model visual smoke covers Mao, Haru, and Hiyori cold starts,
  switching, transparent edges, and forced context loss recovery.

### Pet import boundary

- The stable UI no longer ships the image/atlas-to-pet generator. Existing
  Live2D/Sprite packages can still be imported, community packages can still
  be imported, and the Creator Kit remains available for users who want to
  author a package outside Nexus.

## Validation boundary

The release commit must pass `verify:release`, the Live2D smoke, packaged smoke,
the sustained runtime gate, and the full `prerelease-check -- v0.4.6` flow before
the protected tag workflow publishes assets. Cross-platform CI must be green on
macOS, Windows, and Linux.

No cross-platform physical-device evidence is claimed. macOS builds are arm64,
ad-hoc signed, and not notarized; Windows x64 installers remain unsigned.
Users should download only from the official GitHub Release and verify the
published platform checksum. On macOS, Gatekeeper may require right-clicking
Nexus.app and choosing Open, or running
`xattr -dr com.apple.quarantine /Applications/Nexus.app`.

## Scope boundary

- No dependency upgrade, storage migration, telemetry, or new desktop sensing.
- No v0.5 locomotion, mouse/typing reactions, or physical-device control.
- The direct image/atlas pet generator is intentionally outside the stable
  product surface; package import and Creator Kit authoring are the supported
  pet paths in this release.
