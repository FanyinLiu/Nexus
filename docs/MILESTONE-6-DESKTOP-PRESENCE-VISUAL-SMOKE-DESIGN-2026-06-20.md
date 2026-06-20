# Milestone 6 Slice 4 — Desktop Presence Visual Smoke

## Problem

Slices 1-3 added the companion activity state, micro-motion, and stage-direction
avatar bridge. Unit tests prove the state and parsing contracts, but they do
not prove that the built desktop pet surface actually renders a nonblank avatar
stage with the expected idle presence motion.

For a desktop companion, "it builds" is not enough. A release candidate needs a
repeatable check that the pet window is visibly present after build.

## Technical Design

- Add `scripts/pet-presence-visual-smoke.cjs`.
- Add `npm run pet:presence-smoke`.
- The smoke uses the existing Electron dev dependency and the built Vite output:
  - creates a temporary Electron user-data directory,
  - seeds only a temporary onboarding-completed marker so the pet view starts
    like an existing user profile,
  - loads `dist/index.html?view=pet`,
  - waits for `.pet-window__stage-shell`,
  - fails if the onboarding overlay renders over the pet view,
  - verifies initial companion activity is `idle`,
  - verifies initial motion token is `breathe`,
  - verifies the breathe animation is applied unless the OS prefers reduced
    motion,
  - captures a screenshot,
  - rejects blank or undersized screenshots,
  - writes the screenshot/report under ignored `output/presence-smoke/`.
- No new dependencies, IPC paths, storage migration, or user-data writes are
  introduced.

## Impact

- M6 visual presence changes now have a repeatable local smoke gate.
- The smoke gives release QA a concrete screenshot artifact without committing
  generated images.
- The app is launched against a temporary profile, so existing user settings,
  memories, keys, and chat history are not touched.
- A first-run onboarding overlay is treated as a smoke failure because this
  slice validates the always-on companion surface after setup.

## Risks

- Linux headless environments may not have a display server.
- OS reduced-motion settings can intentionally suppress CSS animations.
- Screenshot pixel checks can be brittle if the UI becomes more transparent.

Mitigations:

- Linux without `DISPLAY`/`WAYLAND_DISPLAY` skips with a clear message.
- Reduced-motion users are allowed to pass without the animation-name check.
- The nonblank check uses conservative size, alpha, and color-bucket thresholds.

## Rollback

Remove `scripts/pet-presence-visual-smoke.cjs`, remove the
`pet:presence-smoke` npm script, and delete this design note plus roadmap/
changelog references. No data rollback is required.

## Acceptance

- `npm run pet:presence-smoke` launches the built pet view through Electron.
- The smoke uses a temporary completed-onboarding profile and fails if the
  onboarding card is visible.
- The smoke confirms `idle` + `breathe` state on the pet stage.
- The smoke writes `output/presence-smoke/pet-presence-smoke.png` and a JSON
  report.
- Existing build, lint, tests, and i18n audit continue to pass.
