# Nexus v0.4.6-beta.1 — Avatar Runtime Reliability

**Status: Published GitHub pre-release on 2026-08-10; not a public stable
release.** v0.4.5 remains the current stable version. The protected tag
workflow published `v0.4.6-beta.1` from commit `44dd91c`; its real-use
validation window remains open.

v0.4.6-beta.1 is a focused Live2D reliability slice. It fixes transparent
window compositing, makes graphics-context loss recoverable, and strengthens
the existing three-model visual gate without adding new sensing or changing
the companion policy.

## What Changed

### Transparent Live2D compositing

- Pixi now initializes the Live2D canvas with straight alpha
  (`premultipliedAlpha: false`). This prevents white fringe pixels when
  Electron composites the transparent companion window on macOS.
- The renderer CSP now permits `data:` only in `connect-src`, which is required
  by Pixi's local ImageBitmap capability probe. Script, image, frame, and remote
  connection policy remain unchanged.

### Bounded WebGL recovery

- A lost WebGL context now rebuilds the owned Pixi application, canvas, and
  Live2D model automatically.
- Recovery is bounded to two consecutive restart attempts. A successful first
  frame resets the budget; repeated failure stops retrying and keeps a readable
  fallback instead of entering a restart loop.
- Context-loss listeners are detached before runtime destruction, preserving
  the existing single-owner and idempotent teardown contract.

### Graceful fallback

- Live2D boot and graphics failures no longer expose raw technical errors as
  the visible UI. Five localized status messages keep the companion window
  understandable and usable; the technical detail remains available through
  the existing debug state for diagnostics.

### Durable visual proof

- The existing Mao, Haru, and Hiyori smoke now forces a real
  `WEBGL_lose_context` event during the same-page sequence.
- The gate verifies that the old canvas, Pixi app, and model are replaced, that
  the old canvas is detached, and that exactly one recovered canvas remains.
- The smoke still checks three cold starts, the Mao → Haru → Hiyori → Mao
  switch sequence, first-frame timing, browser failures, screenshot diversity,
  and transparent/opaque edge backgrounds across seven screenshots.

## Beta Validation Boundary

The candidate is ready for release review only after:

- `npm run verify:release`
- `npm run live2d:three-model:smoke`
- `npm run package:dir:smoke`
- `npm run runtime:packaged-sustained`
- `npm run prerelease-check -- v0.4.6-beta.1`
- CI succeeds on macOS, Windows, and Linux for the release commit

Local browser smoke proves Pixi lifecycle and screenshot behavior in Chromium;
it does not claim physical-device coverage or a complete proof of every OS
window compositor. The packaged Electron gates remain required.

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

- No dependency upgrades.
- No storage migration or new persisted data.
- No new desktop sensing, telemetry, or outbound service.
- No v0.5 locomotion, mouse/typing reactions, or physical-device control.
- v0.4.5 remains the stable update target until beta validation closes and a
  separate stable promotion is prepared.
