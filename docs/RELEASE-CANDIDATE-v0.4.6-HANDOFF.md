# Nexus v0.4.6 Stable Release Handoff

Status: Stable unsigned release handoff.

v0.4.6 is the current stable version. It was promoted through the standard
beta flow after the v0.4.6-beta.1 beta validation window. The official release
commit and platform assets are published only by the protected tag workflow.

## Release content boundary

- straight-alpha Live2D compositing for transparent Electron windows
- narrow Pixi data-URL CSP allowance for the local capability probe
- bounded WebGL context-loss recovery with owned runtime replacement
- localized readable fallback states while retaining diagnostic detail
- three-model visual proof for cold start, switching, transparency, and recovery
- image/atlas-to-pet creation removed from the stable UI, preload, IPC, and
  service surface
- existing Live2D/Sprite package import and Creator Kit authoring retained

## Evidence boundary

The release commit must pass `verify:release`, Live2D smoke, packaged smoke,
the sustained runtime gate, and `prerelease-check -- v0.4.6`. CI must be green
on macOS, Windows, and Linux before the protected tag workflow publishes
artifacts. No cross-platform physical-device evidence is claimed.

The macOS arm64 build remains ad-hoc signed and not notarized. The Windows x64
installer remains unsigned. Users should use only the official GitHub Release
and verify the published platform checksum.

## Promotion record

The v0.4.6 stable promotion updates the package version, release spotlight,
README stable entries, release notes, changelog, roadmap, and release audit
anchors from v0.4.5. The v0.4.6-beta.1 notes and handoff remain as historical
candidate records.
