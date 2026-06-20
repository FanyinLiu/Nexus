# Milestone 2 Slice — Packaged Smoke Release Docs Guard

## Problem

`npm run prerelease-check` already runs an unpacked-app packaged smoke gate in
Stage B, but `docs/RELEASING.md` still described Stage B as five checks and did
not list `npm run package:dir:smoke`. That mismatch can cause a release operator
to miss a required installer-path validation when preparing v0.3.5.

## Technical Design

- Update the `prerelease-check` header comment so Stage B names packaged smoke.
- Update `docs/RELEASING.md` Stage B to six checks and document
  `npm run package:dir:smoke`.
- Keep the `--quick` documentation and console copy explicit that quick mode
  skips packaged smoke as well as renderer smoke, coverage, and benchmarks.
- Extend `npm run distribution:audit` so it fails if the release doc no longer
  lists the packaged smoke gate or its quick-mode skip behavior.

No dependencies, IPC channels, storage writes, migrations, permissions, network
calls, model requests, or automation tools are introduced.

## Impact

- Release operators see the same Stage B gate that the script actually runs.
- Release documentation now reflects that v0.3.5 validates both renderer launch
  smoke and packaged-app launch smoke.
- Quick-mode release checks no longer hide that packaged smoke is skipped.
- Future drift between release docs and packaged smoke coverage becomes a
  distribution audit failure.

## Risks

- The audit assertion can become stale if Stage B is deliberately reorganized.
- Documentation-only wording changes can fail the audit if they remove the
  expected command name.

## Mitigations

- The audit checks the command and the stage count, not a full prose snapshot.
- A deliberate Stage B redesign can update both `docs/RELEASING.md` and
  `scripts/distribution-audit.mjs` in the same release-process slice.

## Rollback

Revert the release-doc wording and remove the distribution audit assertion. No
runtime or data rollback is needed.

## Acceptance

- `docs/RELEASING.md` Stage B lists six checks and includes
  `npm run package:dir:smoke`.
- `docs/RELEASING.md` and `scripts/prerelease-check.mjs` both state that quick
  mode skips packaged smoke.
- `scripts/prerelease-check.mjs` names packaged smoke in the Stage B summary.
- `npm run distribution:audit` enforces the packaged smoke documentation.
- Focused distribution audit, build, lint, full tests, package smoke, and pet
  visual smoke pass.
