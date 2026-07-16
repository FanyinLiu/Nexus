# Releasing Nexus

Nexus uses a **Beta → Validation → Stable** release flow to avoid shipping
broken builds to installed users. Every feature-bearing release MUST pass
through the beta stage unless an explicit, version-scoped maintainer exception
is recorded below.

### v0.4.3 maintainer exception — 2026-07-16

For v0.4.3 only, the maintainer explicitly accepted a direct stable promotion
after reviewing the complete automated release gate, local staging checks, and
the protected cross-platform artifact contract. The normal multi-day beta
window was waived; no multi-day conversation evidence or cross-platform
physical-device validation is claimed. The earlier local DMG/ZIP outputs are
superseded and are not releasable. Final v0.4.3 binaries must be rebuilt from
the merged release commit by `.github/workflows/release.yml`, pass the clean
remote asset/checksum closure gate, and only then become public. This exception
does not change the default policy for v0.4.4 or later releases.

This doc is the source of truth for every release. The short version:

```
# 1. Make sure main is clean and CI is green.
git checkout main && git pull --ff-only

# 2. Bump the version in package.json + update the docs (see checklist below).

# 3. Verify + commit + push.
npm run verify:release
git commit -am "chore(release): bump to vX.Y.Z-beta.N"
git push

# 4. Wait for CI to go green on the bump commit.

# 5. Run the pre-release gate and create the tag.
npm run prerelease-check -- vX.Y.Z-beta.N
git tag vX.Y.Z-beta.N
git push origin vX.Y.Z-beta.N

# 6. Watch the release workflow finish.
gh run watch --repo FanyinLiu/Nexus
```

## Distribution posture

Nexus is distributed as a desktop app, not as an npm-installed end-user app.

- **Normal users** install platform artifacts from the official
  [GitHub Releases](https://github.com/FanyinLiu/Nexus/releases) page. It is
  the only official binary source; mirrors and re-hosted archives are not part
  of the release contract.
- **v0.4.3 platform scope** is macOS arm64, Windows x64, and Linux x64. Do not
  describe the macOS asset as x64 or universal.
- **Updates are platform-specific.** Windows and Linux may consume published
  update metadata; unsigned macOS builds only check for a version and open the
  official release page for a manual download.
- **npm** is the developer path: `npm install`, `npm run electron:dev`,
  `npm run doctor`, packaging scripts, and release checks.
- There is no npm installer in the current release plan. Keep the end-user path
  focused on desktop installers and the platform-specific update behavior above.

Run `npm run distribution:audit` whenever changing packaging, update metadata,
release workflow, installer docs, or npm scripts. `npm run verify:release`
already includes that audit.

Run the focused release trust gate when changing signing, update behavior,
installer trust docs, or release workflow secrets:

```bash
npm run release:trust:audit
```

`npm run distribution:audit` also runs this gate.

To inspect optional future signing readiness without changing the supported
unsigned release posture, run:

```bash
npm run release:signing:readiness
```

This report is non-blocking. It is expected to warn until Apple Developer ID
signing and a Windows signing provider are configured; those warnings do not
block an explicitly unsigned v0.4.3 beta or stable release.

Only when intentionally preparing a future signed beta, run the signed-profile
hard gate:

```bash
npm run release:signing:gate
```

Platform-specific gates are also available while bringing up one signing path
at a time:

```bash
npm run release:signing:gate:mac
npm run release:signing:gate:windows
```

These gates are opt-in and are not part of the unsigned v0.4.3 release
decision. They verify that signed configuration and secret wiring are present;
actual certificate values remain GitHub Actions secrets and are never stored
in this repository.

## Signing and Update Trust

Current v0.4.3 release posture:

- **macOS arm64 only.** The app is ad-hoc signed, which checks internal code
  consistency but does not establish Apple Developer ID trust and is not
  notarization. Gatekeeper may require right-click → Open or explicit
  quarantine removal.
- **Windows x64.** The NSIS installer is deliberately `NotSigned`. SmartScreen
  may display an unknown-publisher warning; the release must never imply that
  bypassing the warning is a security endorsement.
- **Platform checksum files.** The release workflow publishes
  `SHA256SUMS-windows.txt`, `SHA256SUMS-macos.txt`, and
  `SHA256SUMS-linux.txt` beside the matching platform assets. Linux users who
  download one package format can run
  `sha256sum --ignore-missing -c SHA256SUMS-linux.txt`. SHA-256 is the current
  integrity path; the current workflow does not generate GPG signature assets.
- **Official source.** Only `https://github.com/FanyinLiu/Nexus/releases` is
  official. Release notes and READMEs must tell users to delete artifacts from
  mirrors or unknown sources and download again from GitHub.

### macOS unsigned auto-update limitation

The macOS arm64 unsigned build may check whether a newer version exists and
open the official GitHub Release page. It must not silently download, replace,
or relaunch the application. Users manually download a new `.dmg` / `.zip`,
handle Gatekeeper again, and replace `/Applications/Nexus.app`.

Ad-hoc signing must never be described as Apple trust, Developer ID signing,
notarization, or a passing `spctl` assessment. A future signed/notarized path
requires a separate beta cycle and explicit signed-profile gates; it is not a
v0.4.3 release prerequisite.

### Windows unsigned installer limitation

The Windows x64 NSIS artifact is `NotSigned`, so it cannot provide verified
publisher identity or stable SmartScreen reputation. Users must verify that the
file came from the official GitHub Release before choosing **More info → Run
anyway**. A future signed path requires separate credentials and validation; it
is not a v0.4.3 release prerequisite.

Rollback and recovery:

- If an explicitly signed future build fails before publication, keep the
  release as a draft, fix the configuration, and rerun the failed workflow job
  with the same tag. Do not silently relabel it as unsigned.
- If a signed artifact is already published and broken, never replace it in
  place. Publish a higher version tag with a fixed artifact.
- If update metadata is wrong, ship a higher version with corrected metadata;
  do not delete or rebuild a public release.
- If an opt-in `release:signing:gate` fails, keep the documented unsigned path.
  For macOS, stay on manual update downloads. For Windows, retain the
  `NotSigned` and SmartScreen caveat. Signing-gate failure does not invalidate
  the intentionally unsigned v0.4.3 artifacts.

For first-run validation evidence, attach a local doctor report from:

```bash
npm run doctor -- --json
```

Use `--skip-network` in offline CI when you only need repository/runtime
shape. The JSON report records check status and repair hints, not API Key
values, chat content, model output, or provider secrets.

For the focused first-run/model-repair gate, run:

```bash
npm run verify:first-run
```

This does not replace `npm run verify:release` or packaged smoke; it is the
fast M1 gate for doctor JSON privacy, model preflight, onboarding repair,
first-conversation timing, startup reports, and locale coverage.

## v0.4 desktop companion awareness gate

When preparing a v0.4 beta or stable release, also use
[Nexus v0.4 Release Hardening Handoff](RELEASE-CANDIDATE-v0.4-HARDENING.md).
This is required for the desktop companion awareness line because it introduces
quiet observation, rough time language, and user-facing transparency. For the
`v0.4.0` stable tag specifically, use
[Nexus v0.4.0 Stable Release Checklist](RELEASE-CANDIDATE-v0.4.0-STABLE.md)
and keep the scope frozen to the Quiet Observation Foundation.

Before tagging a v0.4 release, confirm the v0.4 handoff records:

- `npm run verify:release`
- `npm run package:dir:smoke`
- `npm run desktop-context-privacy:audit`
- `npm run message-privacy:audit`
- `npm run error-redaction:audit`
- `npm run ipc:audit`
- `npm run distribution:audit`

Also confirm the human-facing beta path is ready:

- `docs/RELEASE-NOTES-v0.4.0-beta.1.md` explains that desktop companion
  awareness is beginning.
- The GitHub **Beta Validation Report** template asks about timing, tone,
  interruption feel, privacy boundaries, OS permission friction, and false
  positives.
- Community docs link the v0.4 plan, beta notes, and hardening handoff.

For the `v0.4.0` stable tag, keep `docs/RELEASE-NOTES-v0.4.0.md` and
`docs/RELEASE-NOTES-v0.4.0.zh-CN.md` as pre-tag drafts until the release branch
is frozen. Do not switch README entry points from `v0.4.0-beta.1` to `v0.4.0`
until the final tag is being prepared.

The v0.4 release is not ready if raw screenshots, OCR dumps, full clipboard
contents, private message bodies, private file paths, exact second-level
timers, or hidden activity logs can reach model prompts, logs, localStorage, or
support reports.

---

## Flow

### Stage 1 — Beta

**Tag format**: `vX.Y.Z-beta.N` (the hyphen is the pre-release marker)

- `release.yml` detects the hyphen and passes `--prerelease` to `gh release create`.
- GitHub labels the release **Pre-release**. Its assets are available for manual download, but existing stable users are NOT auto-upgraded — GitHub's "latest release" API excludes pre-releases, and electron-updater consults that API.
- `electron-updater` inside the app still reports "no update" to anyone on stable, and to anyone already on the beta (semver comparison, `allowDowngrade=false`).

### Stage 2 — Validation window

The beta must accumulate real-world use time before stable ships. No fixed
minimum, but **multiple days of actual conversation** is the expectation, not
"it installs and the home screen loads."

The v0.4.3 exception above explicitly waives this duration requirement for that
version only; it does not invent or substitute multi-day evidence.

- Anything user-facing found during validation → fix on `main` → bump to
  `vX.Y.Z-beta.N+1` (do NOT re-tag the same beta — GitHub will reject re-uploads to the existing release).
- Internal-only fixes (tests, refactors, docs, tooling) do NOT require a
  new beta tag.

### Stage 3 — Stable

**Tag format**: `vX.Y.Z` (no hyphen)

- `release.yml` creates a normal (non-pre) release.
- electron-updater serves the new `latest.yml` / `latest-mac.yml` /
  `latest-linux.yml` metadata — both stable users AND beta users auto-upgrade on
  next app launch.
- **Never** publish a feature release directly as stable unless a version-scoped
  maintainer exception is documented before the release commit. The v0.4.3
  exception above is the only current exception.

---

## Hard rules

1. **Never run `gh release create` manually.** All releases MUST come from
   `.github/workflows/release.yml` triggered by a pushed tag. Manual releases
   create non-draft objects which lock the tag permanently (see v0.2.8
   burnout below).
2. **Never reuse a tag.** GitHub rejects re-uploads to an already-published
   release. Always bump the suffix (`beta.1 → beta.2`) if you need another
   attempt.
3. **Never delete and rebuild a published release.** If a release is already
   public, use a new version tag. The workflow is allowed to continue an
   existing draft only.
4. **Never skip the beta stage** unless the source-of-truth exception section
   names the exact version, evidence reviewed, risks accepted, and clean-build
   publication boundary. Do not infer a waiver from urgency or verbal shorthand.
5. **Never bypass `prerelease-check`.** The script is load-bearing — it
   catches the mistakes the release workflow can't recover from.
6. **Before every push**, run `npm run verify:release`. CI runs the same
   core steps plus the distribution audit (tsc → lint → test → build →
   distribution:audit). Missing any step locally means discovering the failure
   in CI, which wastes ~5 minutes per round-trip.

---

## Per-stage file checklist

Work through the matching column when preparing a release.

| File | Beta | Stable |
|---|---|---|
| `package.json` — `version` | bump to `X.Y.Z-beta.N` | bump to `X.Y.Z` |
| `package-lock.json` | `npm install --package-lock-only` to sync | same |
| `docs/RELEASE-NOTES-vX.Y.Z-beta.N.md` | **new** — developer + user notes, English | — |
| `docs/RELEASE-NOTES-vX.Y.Z.md` | — | **new** — cumulative notes vs. last stable |
| `README.md` News section | add news entry at top of list | update entry for the stable |
| `README.md` "What's new in vX.Y.Z" | for beta, "What's new in vX.Y.Z-beta.N" above preserved previous section | for stable, replace the beta block with the stable block |
| `docs/README.zh-CN.md` / `.zh-TW.md` / `.ja.md` / `.ko.md` | short "本次更新 — vX.Y.Z-beta.N" block pointing to English release notes | same structure with stable tag |
| `docs/RELEASE-NOTES-vX.Y.Z-beta.N.md` "Known issues" | list any deferred items | — |
| Previous beta's "Known issues" (if fixed) | update "deferred to next beta" → "fixed in beta.N+1" | "fixed in X.Y.Z" |

---

## `npm run prerelease-check -- <tag>`

Run before every tag push. Organised into 6 stages (A–F); HARD-fails
exit non-zero with a specific diagnostic. Some checks are warn-only
(coverage, license, AI disclosure) — they don't block the tag but
should be reviewed manually.

Flags:
- `--quick` skips only the full-only npm smoke, Live2D three-model smoke,
  packaged smoke, packaged sustained runtime, coverage, and benchmarks.
  `verify:release` and the bundle budget still run. Use when iterating; the
  full check runs before the actual tag push.
- `--skip=B,C` skips specific stages.
- `--only=A` runs only specific stages.

### Stage A — Process / version (7 checks)
1. Tag matches `v\d+\.\d+\.\d+(-\w+\.\d+)?`.
2. `package.json.version === <tag>.slice(1)`.
3. Local tag absent.
4. Remote tag absent on origin.
5. Working tree clean.
6. `HEAD === origin/main` (after fetch).
7. CI on HEAD success.

### Stage B — Code quality (8 checks)
1. `npm run verify:release` (`verify:pr` + SQLite smoke + core path smoke). `verify:pr` runs
   tsc, lint, tests, build, storage/heavy/architecture/source-size audits,
   v0.4 UI route and open-source reference audits, composer/chat/settings/forms/focus/
   streaming/agent-activity surface audits, Image4 color and contract checks,
   performance baseline, v0.4 draft-stack quick audit, companion boundary,
   message privacy, desktop context privacy, vault security, error redaction,
   IPC, and distribution audits.
   - Image4 UI validation is split deliberately: `image4:contract:check` is the
     release-blocking hard contract for the current header / Live2D stage / recap /
     composer structure and retired-element boundary, while
     `image4:contract:report` is a non-blocking drift summary to
     review during visual tuning. Chat/settings/composer and related surface
     changes are also PR-gated through their source-backed surface audits plus
     `docs/DESIGN_REVIEW_CHECKLIST.md` and `docs/OPEN_SOURCE_UI_REFERENCE_AUDIT.md`
     as the human review/reference layer.
2. `npm run smoke` — Electron actually launches + renderer loads. `npm run core-path:smoke`
   goes one step deeper by loading the panel, opening Settings, and reaching
   the model configuration path without real microphone or provider calls.
3. `node scripts/live2d-three-model-smoke.mjs` — start an owned local Vite
   server when no `--url` is supplied, run three-model cold starts and
   same-page switches, and require seven screenshot evidence files. An
   explicit `--url` is an external reachability check and is never closed by
   the smoke harness.
4. `npm run package:dir:smoke` — package an unpacked app and launch it with
   the packaged smoke runner.
5. `npm run runtime:packaged-sustained` — run only after packaged smoke has
   passed, with `PACKAGED_SMOKE_RELEASE_DIR=release-smoke`; this is a hard
   gate.
6. Coverage ≥ 80% lines (warn).
7. `dist/assets/app-runtime-*.js` ≤ 1700 KB.
8. Benchmarks complete without crash (warn).

### Stage C — Security (6 checks)
1. `npm audit --omit=dev`: 0 critical + 0 high.
2. `electron/windowManager.js` enforces `contextIsolation: true`,
   `sandbox: true`, `nodeIntegration: false`, `webSecurity: true`.
3. Electron version ≥ 41.3 (current stable; bump floor with new security minor).
4. `electron-updater` ≥ 6.6.
5. No API-key / token patterns committed (OpenAI, Google, AWS, Slack, GitHub).
6. CSP header injected in `electron/rendererServer.js`.

### Stage D — Asset integrity (3 checks)
1. 5-locale presence (`en-US`/`zh-CN`/`zh-TW`/`ja`/`ko`) in every prose
   module that ships UI strings (heuristic: each locale key referenced
   ≥ 1× per file).
2. `sherpa-models` referenced in `build.{mac,win,linux}.extraResources`.
3. `dist/index.html` + `app-runtime-*.js` + `ort-wasm-simd*.wasm` present.

### Stage E — Docs + compliance (beta: 3 checks; stable: 10 checks)
1. `docs/RELEASE-NOTES-<tag>.md` exists.
2. Stable only: English release notes contain none of the shared hard-gate
   markers `Draft`, `草稿`, `pre-tag`, `尚未打 tag`, `Release candidate`,
   `not a public release`, `no tag`, `发布候选`, `尚未公开发布`, or `不打 tag`.
   This is a hard failure.
3. Stable only: `docs/RELEASE-NOTES-<tag>.zh-CN.md` exists and contains none
   of the same shared markers. This is a hard failure.
4. Stable only: `README.md` links the release notes.
5. Stable only: `docs/README.{zh-CN,zh-TW,ja,ko}.md` each link the release
   notes (4 checks).
6. No GPL/AGPL/SSPL in production deps (warn — `license-checker`).
7. README mentions "AI" (EU AI Act Aug-2026 transparency duty; warn).

### Stage F — Privacy + governance (1–3 checks)
1. No suspicious telemetry hosts hardcoded in `src/` / `electron/`
   (Sentry, Mixpanel, GA, Datadog, Amplitude, Segment, Logflare).
2. Audit-findings doc still tracks H4 deferral (warn).
3. Stable release notes mention unsigned-build caveats (xattr/SmartScreen)
   (stable only; warn).

A passing check prints `OK` and (when relevant) a metric in dim text.
A failed check prints `FAIL` with a one-line diagnostic; the script
exits 1 after listing every blocker. Warn-only checks print `WARN`
and continue.

---

## `release.yml` workflow

Tag push → `resolve-tag` proves the tag commit and `origin/main` ancestry →
`preflight` runs without creating a release → `ensure-release` creates or
reuses a draft → three platform builds run in parallel → `publish` downloads
every remote asset into a clean directory, verifies the exact tag-bound
artifact/checksum closure, and only then flips the draft to published.

- **Pre-release detection**: the `ensure-release` job parses the tag. Any tag
  containing `-` gets `--prerelease` passed to `gh release create`.
- **If a build fails**: the draft stays unpublished. You can fix the root
  cause (sherpa cache miss, etc.) and re-run the failed job through
  `workflow_dispatch` with the same tag.
- **If the publish job fails after the builds succeeded**: keep the release as
  a draft and rerun the Release workflow through `workflow_dispatch` with the
  same tag. Never run `gh release edit <tag> --draft=false` manually: that
  bypasses the clean remote-download, tag/version binding, asset whitelist,
  and checksum-closure gate.

---

## Burned version numbers

| Tag | Reason |
|---|---|
| `v0.2.4` | Unknown — pre-date of formal process |
| `v0.2.6` | Unknown — pre-date of formal process |
| `v0.2.8` | Manual `gh release create` as non-draft locked the tag permanently. GitHub does not allow re-using a tag that once pointed at a published release. |

Once a version number is burned, it can never be used again. This is why we
have the beta stage — a broken beta only burns the beta suffix (`.1`, `.2`),
not the underlying `X.Y.Z`.

---

## Emergency: the release workflow failed

1. **`ensure-release` failed** (usually: tag already belongs to a published
   release) → investigate via `gh release view <tag>`. Do not delete the
   published release. If the release is legitimate, nothing to do; if it was a
   mistake, burn this tag and use the next suffix.
2. **One platform build failed** → `workflow_dispatch` the Release workflow
   with the same tag input. `ensure-release` sees the existing draft and
   appends assets; `--clobber` flag is set so asset name collisions are safe
   to retry.
3. **`publish` failed** → keep the draft unpublished and rerun the Release
   workflow with the same tag through `workflow_dispatch`. The protected
   publish job must redownload and reverify every remote asset. Do not publish
   with `gh release edit` or the web UI, even if the asset list looks complete.

---

## Reference release

`v0.3.0-beta.1` (2026-04-24) is the reference shape for future releases:

- **Phase A** — `ci(release): mark pre-release tags as GitHub pre-releases`
  (`737264f`) — workflow change only, no version bump yet.
- **Phase B** — `chore(release): bump to 0.3.0-beta.1 + refresh release notes`
  (`2c95688`) — version bump, release notes created, all five READMEs updated,
  CI green before tag push.
- **Tag push** — `v0.3.0-beta.1` → `47215b1` → release workflow → final
  `gh release view` returned `isDraft=false, isPrerelease=true` → assets
  present on all three platforms.

Mimic this shape; do not improvise.
