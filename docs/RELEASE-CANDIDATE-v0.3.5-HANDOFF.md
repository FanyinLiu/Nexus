# Nexus v0.3.5 Release Candidate Handoff

## Status

- PR: [#105 — v0.3.5 companion presence and visible memory](https://github.com/FanyinLiu/Nexus/pull/105)
- Evidence baseline head: `48e6b78`
- Branch: `codex/m6-presence-state-contract`
- State: ready for review and mergeable at the evidence baseline, with GitHub
  CI green on Windows, macOS, and Ubuntu.
- Product theme: visible memory plus readable desktop companion presence.

This handoff is for the final merge/tag step. It does not replace
`docs/RELEASING.md`; it records the current v0.3.5 evidence and remaining
release risks in one place.

After any handoff-only commit is pushed, verify the latest PR head and latest
GitHub CI before merging. Do not tag until the merged `main` head passes the
full pre-release check.

## User-Facing Upgrade

Use this headline for release copy:

> Nexus v0.3.5 makes the companion easier to read and remember: memory is
> visible, and the desktop avatar now shows whether it is idle, thinking,
> listening, speaking, waiting, offline, or in trouble.

The release remains companion-first. It does not add a Codex-style work agent,
task planner, autonomous executor, or new automation surface.

## Evidence Already Collected

- `npm test` — 1966 passed.
- `npm run build` — passed.
- `npm run lint` — passed.
- `npx tsc -b --pretty false` — passed.
- `npm run i18n:audit` — 2242 keys, 0 missing, 0 extra, 0 duplicate across
  zh-CN, zh-TW, en-US, ja, and ko.
- `npm run distribution:audit` — passed, including the packaged smoke
  release-doc and quick-mode guard.
- `npm run release:trust:audit` — 7 OK, 2 expected warnings for unsigned
  macOS/Windows release posture.
- `npm run package:dir:smoke` — passed; it builds, packages an unpacked local
  app, launches packaged Nexus, and exits after renderer load.
- `npm run pet:presence-smoke` — passed; it writes
  `output/presence-smoke/pet-presence-smoke.png` and JSON evidence.
- `node --experimental-strip-types --test tests/release-spotlight.test.ts` —
  5 passed, including README/release-note/changelog theme alignment and this
  handoff guard.
- `node scripts/prerelease-check.mjs v0.3.5 --only=B --quick` — passed.
- `node scripts/prerelease-check.mjs v0.3.5 --skip=A --quick` — passed stages
  B-F with 22 blocker checks, 0 warnings, and 0 failures.
- GitHub CI on baseline PR head `48e6b78` — Windows, macOS, and Ubuntu all
  passed.

## Remaining Required Steps

Do not tag from the PR branch. After the PR is merged:

```bash
git checkout main
git pull --ff-only
npm run prerelease-check -- v0.3.5
git tag v0.3.5
git push origin v0.3.5
gh run watch --repo FanyinLiu/Nexus
```

Stage A of `prerelease-check` intentionally must run only after merge because
it verifies `HEAD === origin/main`, local tag absence, remote tag absence, and
CI on the exact release head.

## Known Residual Risks

- macOS packages are still unsigned until Developer ID signing and notarization
  are configured. The current runtime uses the documented manual-download
  update posture for unsigned macOS builds.
- Windows installer trust still depends on a real signing certificate path;
  unsigned installers may show SmartScreen warnings.
- `node:sqlite` may emit an ExperimentalWarning in this Electron/Node line.
- Optional KWS/SenseVoice/Python-side models may be missing in local smoke
  environments. The packaged smoke evidence shows the app still launches.

## Rollback

- If merge fails, keep PR #105 open and fix the failing check on the same
  branch.
- If `npm run prerelease-check -- v0.3.5` fails after merge, do not tag. Fix
  on `main`, rerun CI, and rerun the prerelease check.
- If the release workflow fails after the tag creates a draft, fix the cause
  and rerun the failed workflow job for the same tag while the release remains
  draft.
- If a public release is broken after publication, do not replace assets in
  place. Publish a higher version tag with the fix.

## Suggested Next Phase

After v0.3.5 is merged and released, continue with one companion-first slice:

- Live2D optional rendering path polish, or
- voice MVP reliability and resource budgeting, or
- white-box long-term memory management.

Do not start by expanding tool automation or multi-agent behavior; those remain
later v1.0 milestones after memory, permissions, and desktop presence are more
stable.
