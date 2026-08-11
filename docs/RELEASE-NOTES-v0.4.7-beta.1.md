# Nexus v0.4.7-beta.1 — Avatar Compatibility and Diagnostics

**Status: Beta release candidate; not a public stable release.** v0.4.5 remains
the current stable version. v0.4.6-beta.1 remains historical validation
evidence and has not been promoted to stable because its multi-day validation
window is still open.

v0.4.7-beta.1 makes imported Live2D models safer to activate and easier to
repair. It validates the Cubism model and its local resources before copying or
switching, distinguishes hard rendering blockers from optional interaction
limits, and retains resource evidence in the existing three-model smoke report.

## What Changed

### Validation before activation

- Imported `.model3.json` files must declare a Moc core and at least one
  texture, and every declared Moc, texture, motion, expression, physics, pose,
  user-data, or display-info file must exist.
- Absolute paths, parent-directory traversal, and symlinks escaping the model
  folder are rejected before the model can become active.
- Invalid models are not copied into the local model library and do not replace
  the current companion.

### Compatibility without false blockers

- A missing Moc, texture, or declared resource blocks activation because the
  runtime cannot load the package safely.
- A model that declares no motions or expressions may still render. Nexus
  imports it with a clear limited-interaction warning instead of rejecting a
  usable avatar.

### Actionable, private diagnostics

- Five localized messages identify whether the gap is the model definition,
  Moc, textures, motions, expressions, supporting resources, or an unsafe path.
- Repair guidance tells the user to keep resources referenced by
  `.model3.json` inside the same model folder and retry.
- Renderer and audit boundaries receive resource categories and counts, never
  private local file paths or model contents.

### Durable switch evidence

- The Mao, Haru, and Hiyori smoke report schema moves to version 4.
- Every cold start and same-page switch records Moc declaration plus texture,
  motion, and expression counts. The gate pins the expected profile for all
  three packaged models while retaining the existing first-frame, screenshot,
  context-loss, and single-canvas checks.
- Packaged sustained-runtime CDP snapshots expose the same resource markers for
  release evidence.

## Beta Validation Boundary

The candidate is ready for release review only after:

- `npm run verify:release`
- `npm run live2d:three-model:smoke`
- `npm run package:dir:smoke`
- `npm run runtime:packaged-sustained`
- `npm run prerelease-check -- v0.4.7-beta.1`
- CI succeeds on macOS, Windows, and Linux for the release commit

The beta still needs real imported-model feedback after publication. Automated
fixtures prove the blocker/limited/ready classifications and privacy boundary;
they do not claim compatibility with every third-party Cubism exporter.

## Known Issues

- Third-party Cubism exporters may use resource fields outside the currently
  validated Cubism 3/4 model-reference set; report a minimal redacted fixture
  instead of a private model package when possible.
- Models without declared expressions or motions can render but cannot provide
  those interactions until the package is repaired.
- v0.4.6 has not completed stable validation; this newer beta does not waive or
  retroactively close that window.

## macOS unsigned auto-update limitation

The macOS arm64 beta is ad-hoc signed, not Apple Developer ID signed or
notarized. Gatekeeper may require right-click → Open or
`xattr -dr com.apple.quarantine /Applications/Nexus.app`. The app opens the
official release page; users manually download and replace the app.

## Windows unsigned installer limitation

The Windows x64 installer is `NotSigned`. SmartScreen may show an
unknown-publisher warning. Bypassing that warning is not a security guarantee;
use only the official GitHub Release and verify its published SHA-256 checksum.

Linux x64 remains part of the protected release workflow with AppImage, deb,
tar.gz, update metadata, and `SHA256SUMS-linux.txt` closure.

## Scope Boundary

- No dependency upgrades, storage migration, or new persisted data.
- No new desktop sensing, telemetry, or outbound service.
- No v0.5 movement, mouse/typing reactions, physical-device wake, or
  nearest-speaker routing.
- v0.4.5 remains the stable update target until a separately validated stable
  promotion is prepared.
