# Nexus v0.4.6-beta.1 Release Candidate Handoff

Status: closed; published as GitHub pre-release on 2026-08-10 from commit
`44dd91c` through the protected tag workflow.

Current public stable release: v0.4.5. Candidate package version:
`0.4.6-beta.1`.

## Frozen Scope

- straight-alpha Live2D WebGL compositing for transparent Electron windows
- renderer CSP support for Pixi's local data-URL capability probe
- bounded WebGL context-loss recovery with owned runtime replacement
- five-locale readable fallback while retaining diagnostic detail
- durable three-model context-loss and single-canvas regression proof
- release notes, roadmap, changelog, in-app spotlight, and beta handoff alignment

No dependency upgrade, storage migration, sensing expansion, signing change,
telemetry, v0.5 behavior, tag, push, or GitHub Release belongs to this handoff.

## Evidence Ledger

| Gate | State | Evidence |
|---|---|---|
| Focused Live2D/CSP/lifecycle tests | Passed | 21 tests; TypeScript, ESLint, and five-locale audit passed |
| Three-model unit + harness tests | Passed | 37 tests |
| Three-model visual smoke | Passed | 7 screenshots; forced context loss recovered to one canvas |
| `npm run verify:pr` | Passed | Complete PR gate passed twice, including tests, build, architecture, performance, privacy, IPC, and distribution |
| `npm run verify:release` | Passed | PR gate + SQLite smoke + built core-path Electron smoke |
| `npm run package:dir:smoke` | Passed | Packaged app loaded; 497.3 MiB / 550 MiB; forbidden files 0 |
| Packaged sustained runtime | Passed | plateau 0.9517 / 1.4; remount growth 1.0096 / 1.5; 5/5 remounts; 4/4 visibility cycles; errors 0 |
| `prerelease-check -- v0.4.6-beta.1 --skip=A` | Passed | Stages B–F: 23/23, warnings 0; coverage 90.64%; app runtime 83 KB |
| `prerelease-check -- v0.4.6-beta.1 --only=A` | Expected local blocker | 6/7 passed; only clean-worktree check fails before the release changes are committed |
| Cross-platform CI | Passed | Protected prerelease flow completed 30/30 and uploaded 15 release assets |

The temporary visual smoke reports, `dist`, unpacked package, core-path report,
and sustained-runtime report were moved to Trash after the final gate. The
smoke implementation and behavior tests remain as durable regression coverage.

## Known Boundaries

- Browser screenshot evidence does not fully reproduce every native Electron
  transparent-window compositor path.
- macOS remains arm64, ad-hoc signed, and not notarized; updates are manual.
- Windows remains x64 and `NotSigned`; SmartScreen warnings are expected.
- No physical-device coverage is claimed.

## Promotion Lock

The beta tag is immutable and must not be reused or rebuilt. Stable `v0.4.6`
requires a separate multi-day validation window and promotion update; that
window has not closed.
