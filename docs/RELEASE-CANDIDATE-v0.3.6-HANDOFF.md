# Nexus v0.3.6 Release Candidate Handoff

## Status

- Evidence baseline head: `517b822`
- Branch: local working tree
- State: locally validated; ready for merge/release review once unrelated
  working-tree changes are separated.
- Product theme: v0.3 foundation wrap-up for safety, memory, settings, and
  visible desktop-awareness boundaries.

This handoff is for the v0.3.6 close-out. It does not replace
`docs/RELEASING.md`; it records the intended scope and required checks before a
tag is created.

## User-Facing Upgrade

Use this headline for release copy:

> Nexus v0.3.6 closes the foundation line: settings are more readable, memory
> and desktop-awareness controls are easier to inspect, and the next major
> desktop-companion sensing work is kept out of this patch release.

The release remains companion-first. It does not add a Codex-style work agent,
task planner, autonomous executor, always-on screen recorder, or mouse/keyboard
control.

## Evidence Collected

- `npm run verify:release` — passed. This includes forced typecheck, lint,
  2014 tests, production build, storage/heavy/architecture/source-size/
  performance/companion-boundary/message-privacy/`desktop-context-privacy:audit`/
  vault/error-redaction/IPC/distribution audits, and SQLite smoke.
- `npm run package:dir:smoke` — passed. The unpacked macOS arm64 app launched,
  loaded the renderer, and exited cleanly. Expected local smoke warnings remain:
  unsigned/ad-hoc signing, skipped notarization, optional KWS/SenseVoice models
  missing, and Electron/Node deprecation warnings.
- `node scripts/prerelease-check.mjs v0.3.6 --skip=A --quick` — passed with 22
  checks, 0 warnings, and 0 failures. Stage A remains merge/tag-only because it
  checks `HEAD === origin/main`, tag absence, and CI on the final release head.
- Visual check: Settings -> Memory -> Context Awareness status rows show active
  window, clipboard, and OCR status; when scrolled to that section, the rows and
  privacy note fit above the save bar.

## Remaining Required Steps

Do not tag from a dirty or unmerged branch. After the final release branch is
merged:

```bash
git checkout main
git pull --ff-only
npm run prerelease-check -- v0.3.6
git tag v0.3.6
git push origin v0.3.6
gh run watch --repo FanyinLiu/Nexus
```

## Known Residual Risks

- macOS packages remain unsigned until Developer ID signing and notarization
  are configured.
- Windows installer trust still depends on a real signing certificate path;
  unsigned installers may still show SmartScreen warnings.
- The v0.4.0 desktop-companion sensing loop is intentionally not implemented in
  this release; v0.3.6 only exposes and clarifies the current capability
  surface.

## Rollback

- If release alignment fails, revert the version/documentation bump and keep
  the existing v0.3.5 release boundary.
- If Settings readability regresses, revert the focused CSS changes before
  tagging.
- If desktop-awareness status copy causes confusion, keep the privacy boundary
  but remove the new status rows from Memory settings.

## Suggested Next Phase

After v0.3.6 is released, start a dedicated v0.4.0 design slice for desktop
companion awareness:

- Nexus opens, then stays quiet if the user does not interact with it.
- If the user works elsewhere, Nexus forms a coarse activity/time summary.
- Time is expressed roughly: a while, about half an hour, about an hour, two
  hours or more.
- The model receives a sanitized companionship summary, not raw windows,
  screenshots, or clipboard contents.
