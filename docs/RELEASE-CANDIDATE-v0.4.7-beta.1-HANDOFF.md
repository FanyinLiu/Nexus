# Nexus v0.4.7-beta.1 Release Candidate Handoff

Status: local beta candidate passed implementation, visual, packaged, and
sustained-runtime gates; commit, CI, and protected-tag publication remain.

Current public stable release: v0.4.5. Candidate package version:
`0.4.7-beta.1`. v0.4.6-beta.1 remains a published pre-release whose multi-day
stable-validation window is still open.

## Frozen Scope

- validate imported Cubism Moc, textures, motions, expressions, and supporting
  resources before copy or activation
- reject absolute, parent-traversing, and folder-escaping symlink resources
- classify undeclared motions/expressions as limited interaction rather than a
  false rendering blocker
- provide actionable five-locale repair guidance without exposing private paths
- retain Moc/texture/motion/expression profiles in browser and packaged runtime
  evidence
- align package version, changelog, READMEs, roadmap, in-app spotlight, and
  release notes while keeping v0.4.5 as stable

No dependency upgrade, storage migration, new sensing source, physical-device
control, nearest-speaker routing, v0.5 behavior, or stable promotion belongs to
this handoff.

## Validation Evidence

| Gate | Result | Evidence |
|---|---|---|
| Compatibility behavior fixtures | Passed | complete, limited, missing-resource, unsafe-path cases |
| TypeScript, ESLint, and five-locale audit | Passed | targeted iteration gate clean |
| `npm run verify:release` | Passed | full tests/build/audits + SQLite + Electron core path |
| Three-model visual smoke | Passed | schema 4; 7 screenshots; Mao/Haru/Hiyori resource profiles retained |
| `npm run package:dir:smoke` | Passed | packaged app loaded; 497.3 MiB / 550 MiB; forbidden files 0 |
| Packaged sustained runtime | Passed | plateau 0.9526 / 1.4; remount growth 1.0146 / 1.5; 5/5 remounts; 4/4 visibility cycles; errors 0 |
| Packaged resource diagnostics | Passed | Mao Moc 1, texture 1, motions 8, expressions 8 retained across snapshots |
| Pre-commit `prerelease-check -- v0.4.7-beta.1 --skip=A` | Passed | 23/23, warnings 0; coverage 90.66%; app runtime 83 KB; final full rerun on `main` still required |
| Cross-platform CI | Pending release commit | must be green before tag publication |

Local visual evidence is under
`artifacts/live2d-three-model-smoke/v0.4.7-beta.1-local/`; packaged evidence is
under `output/packaged-sustained-runtime/report.json`. These paths are local QA
artifacts, not release assets or source-controlled product files.

## Known Boundaries

- Third-party Cubism exporters may use model-reference fields outside the
  current Cubism 3/4 validation set; beta feedback should use minimal redacted
  fixtures where possible.
- Models with no declared expressions or motions can render but intentionally
  report limited interaction coverage.
- macOS remains arm64, ad-hoc signed, and not notarized; updates are manual.
- Windows remains x64 and `NotSigned`; SmartScreen warnings are expected.
- No cross-platform physical-device evidence is claimed.

## Publication Lock

Do not create or push `v0.4.7-beta.1` until all of the following are true:

1. the reviewed release changes are committed on the intended release commit;
2. the release commit is merged to `main`, and local HEAD equals `origin/main`;
3. macOS, Windows, and Linux CI are green on that commit;
4. `npm run prerelease-check -- v0.4.7-beta.1` passes without blockers;
5. the protected tag workflow is triggered only once; the tag is never reused.

Stable v0.4.6 or v0.4.7 requires a separate, honest beta-validation window and
promotion update.
