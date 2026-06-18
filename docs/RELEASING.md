# Releasing Nexus

Nexus uses a **Beta → Validation → Stable** release flow to avoid shipping
broken builds to installed users. Every feature-bearing release MUST pass
through the beta stage — no direct-to-stable releases.

This doc is the source of truth for every release. The short version:

```
# 1. Make sure main is clean and CI is green.
git checkout main && git pull --ff-only

# 2. Bump the version in package.json + update the docs (see checklist below).

# 3. Verify + commit + push.
npm run verify:release
npm run v04:readiness:status
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

- **Normal users** install `.dmg`, `.exe`, `.AppImage`, or `.deb` from GitHub
  Releases and receive updates through `electron-updater`.
- **npm** is the developer path: `npm install`, `npm run electron:dev`,
  `npm run doctor`, packaging scripts, and release checks.
- There is no npm installer in the current release plan. Keep the
  end-user path focused on desktop installers and automatic updates.

Run `npm run distribution:audit` whenever changing packaging, update metadata,
release workflow, installer docs, or npm scripts. `npm run verify:release`
already includes that audit.

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

- Anything user-facing found during validation → fix on `main` → bump to
  `vX.Y.Z-beta.N+1` (do NOT re-tag the same beta — GitHub will reject re-uploads to the existing release).
- Internal-only fixes (tests, refactors, docs, tooling) do NOT require a
  new beta tag.
- For `v0.3.4+`, stable promotion also requires a complete message-awareness
  evidence audit: local webhook injection plus real macOS Notification Center,
  Telegram, and Discord live checks. Keep raw evidence under ignored
  `artifacts/`; commit only a redacted
  `docs/release-evidence/<tag>-message-awareness.json` if CI must verify the
  stable tag. Run `npm run message:preflight:live` first for a private-safe
  host check; it reports macOS Notification Center readability and the
  Telegram/Discord manual runbook without printing notification bodies,
  senders, tokens, chat IDs, or channel IDs. Record live checks with
  `npm run message:live:record`; pass `macos`, `telegram`, or `discord` after
  `--`. For v0.3.4, run
  `npm run message:status:release` to inspect pending proof fields. A passing
  live check must include a real observation time, operator, concrete note, and
  the scenario proof flags. Run
  `npm run message:merge:release` after the live gate passes, then generate
  the commit-safe evidence with `npm run message:release:redact`. Add
  `-- --output artifacts/v0.3.4/message-awareness-status.json` to
  `npm run message:status:release` when you want to save the private-safe
  live-check runbook before or after manual validation.
- For `v0.4.0+`, also run `npm run v04:readiness:status` during beta
  validation. It combines the P1/P2 stabilization artifacts,
  message-awareness release status, and v0.4 privacy/safety posture into one
  private-safe report. The required stabilization artifacts include companion
  readiness health (`npm run companion:readiness:report -- --sample`) and
  Memory Map derived-view coverage (`npm run memory:map:report -- --sample`),
  so the release gate proves the first-run health surface and memory graph/timeline
  model are present before message live evidence is attached. Generate the
  source-backed privacy/safety artifact with
  `npm run privacy:safety:report -- --output artifacts/v0.3.4/privacy-safety.json --require-ready`
  before treating the aggregate as ready. The v0.4 aggregate
  reads message-awareness evidence from
  `artifacts/v0.4.0/message-awareness-*.json` and writes redacted stable proof
  to `docs/release-evidence/v0.4.0-message-awareness.json`; pass explicit
  evidence-file flags only when intentionally auditing another release line. Use
  `npm run v04:message:status:release` for the v0.4 message-evidence gap
  report; pass `-- --output artifacts/v0.4.0/message-awareness-status.json`
  to persist the current private-safe live-check runbook. The related
  `v04:message:*` scripts prefill the v0.4 evidence paths. Run
  `npm run v04:message:preflight:live` before recording live proof to write
  `artifacts/v0.4.0/message-awareness-live-preflight.json`; this artifact is
  an environment preflight only and is not a substitute for real live
  evidence. Run `npm run v04:message:live:session` after status/preflight/probe
  reports are present to write a private-safe machine checklist at
  `artifacts/v0.4.0/message-awareness-live-session.json` plus an operator packet
  at `artifacts/v0.4.0/message-awareness-live-session.md`; it does not record
  evidence, but it shows the pending live checks, dry-run/preflight record
  commands, and placeholder fields without copying message bodies, senders,
  tokens, chat IDs, or webhook payloads. It also includes a step execution
  summary that separates automation-safe commands from manual or blocked record
  steps. Its `--markdown-output <path>` option can write the same private-safe
  runbook to another handoff location. Its
  `--require-ready-to-record`
  mode also requires the macOS leg to have a non-diagnostic
  `observed-once` probe candidate before treating the macOS record command as
  ready. If a release operator exports runtime gateway diagnostics, run
  `npm run v04:message:bridge:trace -- --input <gateway-status.json>` to
  sanitize them into
  `artifacts/v0.4.0/message-awareness-bridge-trace.json`; then
  `v04:message:live:session` can prefill safe Telegram/Discord fields such as
  observed timestamp, Telegram update offset, outbound kind/time, and Discord
  reconnect time/reason. When validating from the desktop app, Settings ->
  Console -> Context diagnostics also shows a copyable
  `v0.4 safe bridge trace JSON` action after Telegram/Discord trace data is
  available; paste that JSON into the same bridge-trace artifact path before
  rerunning `npm run v04:message:live:session`. It reduces manual command
  editing, but target IDs and outbound error text are reported only as
  present/absent and are never copied into the trace or session report.
  `npm run v04:readiness:status` and
  `npm run v04:completion:audit` include this live-session artifact when it is
  present so the final private-safe audit shows whether macOS is still waiting
  on a real probe candidate and whether Telegram/Discord bridge traces were
  available. The session artifact is still an operator checklist, not proof
  that the live gates passed. For the macOS leg, run
  `npm run v04:message:probe:macos` while
  triggering one real communication-app notification; it checks that the
  adapter sees exactly one fresh notification candidate and that an immediate
  replay poll is empty without printing notification content. Its
  `--send-test-notification` mode is diagnostic only and must not be used as
  release proof. `npm run v04:readiness:status` and
  `npm run v04:completion:audit` read this preflight artifact when present to
  separate host permission/setup blockers from still-needed macOS/Telegram/
  Discord live observations. Commands printed by
  the status report are templates; replace `REPLACE_WITH_*` observed-at,
  operator, and app values with real observation details before recording pass
  evidence. Placeholder values are rejected by the validator. The v0.4
  `npm run v04:message:live:record -- macos ...` wrapper also refuses macOS
  pass evidence unless
  `artifacts/v0.4.0/message-awareness-macos-live-probe.json` contains a
  non-diagnostic `releaseEvidenceCandidate: true` report generated within the
  configured 30-minute freshness window. Add `--dry-run` to a record command to
  preview its mapped validator args without writing evidence; the dry-run JSON
  includes `readyToRecord` and `preflightWarnings` so copied placeholders are
  visible before the real record step. Use `--preflight` instead of `--dry-run`
  when a script should fail non-zero unless `readyToRecord` is true. After the
  real macOS, Telegram, and Discord checks are recorded, run
  `npm run v04:message:finalize`; it refuses to write raw complete or redacted
  release evidence until local webhook evidence and all live proof pass, and it
  refreshes `artifacts/v0.4.0/message-awareness-status.json` either way.
  `npm run v04:completion:audit` prints a requirement-level checklist for the
  v0.4 plan, separating code/evidence gaps from real macOS/Telegram/Discord
  live evidence that must be collected by a release operator. For automation,
  prefer `automationSafeNextCommands` when present, then inspect
  `nextCommandDetails`; do not blindly execute the plain `nextCommands` list.
  Record commands expose `safeToRun` and `executionMode`, and template or
  blocked record commands must stay manual until those fields are safe.
  `npm run v04:release:gate` chains `verify:release`,
  `v04:readiness:status -- --require-ready --verify-release-ran`, and
  `v04:completion:audit -- --require-complete --verify-release-ran`; beta tags
  warn on incomplete v0.4 readiness/completion, while stable tags fail in
  `prerelease-check`. Running `v04:readiness:status` or
  `v04:completion:audit` by itself still prints `verify:release` as a next
  command because those scripts do not run the full release check.

### Stage 3 — Stable

**Tag format**: `vX.Y.Z` (no hyphen)

- `release.yml` creates a normal (non-pre) release.
- electron-updater serves the new `latest.yml` / `latest-mac.yml` /
  `latest-linux.yml` metadata — both stable users AND beta users auto-upgrade on
  next app launch.
- **Never** publish a feature release directly as stable. Skipping the beta
  stage has burned version numbers in the past.

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
4. **Never skip the beta stage.** Even for "small" features.
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
- `--quick` skips slow stages (smoke, coverage, benchmarks). Use when
  iterating; the full check runs before the actual tag push.
- `--skip=B,C` or `--skip B,C` skips specific stages.
- `--only=A` or `--only A` runs only specific stages.

### Stage A — Process / version (7 checks)
1. Tag matches `v\d+\.\d+\.\d+(-\w+\.\d+)?`.
2. `package.json.version === <tag>.slice(1)`.
3. Local tag absent.
4. Remote tag absent on origin.
5. Working tree clean.
6. `HEAD === origin/main` (after fetch).
7. CI on HEAD success.

### Stage B — Code quality (5 checks)
1. `npm run verify:release` (tsc + lint + test + build + distribution audit).
2. `npm run smoke` — Electron actually launches + renderer loads.
3. Coverage ≥ 80% lines (warn).
4. `dist/assets/app-runtime-*.js` ≤ 1700 KB.
5. Benchmarks complete without crash (warn).

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

### Stage E — Docs + compliance (5–8 checks)
1. `docs/RELEASE-NOTES-<tag>.md` exists.
2. README.md mentions tag (stable only).
3. `docs/README.{zh-CN,zh-TW,ja,ko}.md` each mention tag (stable only).
4. No GPL/AGPL/SSPL in production deps (warn — `license-checker`).
5. README mentions "AI" (EU AI Act Aug-2026 transparency duty; warn).

### Stage F — Privacy + governance (2–4 checks)
1. No suspicious telemetry hosts hardcoded in `src/` / `electron/`
   (Sentry, Mixpanel, GA, Datadog, Amplitude, Segment, Logflare).
2. `v0.3.4+` message-awareness release evidence is complete: local webhook,
   macOS Notification Center, Telegram, and Discord gates all pass. Beta tags
   warn; stable tags fail. Evidence can be supplied via
   `NEXUS_MESSAGE_AWARENESS_EVIDENCE_FILE`, committed under
   `docs/release-evidence/<tag>-message-awareness.json`, or kept locally under
   `artifacts/vX.Y.Z/message-awareness-complete.json`. Use
   `npm run message:live:record -- macos ...`, `-- telegram ...`, or
   `-- discord ...` to write each live proof into the ignored live-evidence
   file; `npm run message:preflight:live` can be run before that to confirm
   host-level readiness without copying private notification or chat content.
   Each passing proof must include observation time, operator, concrete
   notes, and the scenario proof flags. Run `npm run message:merge:release` to
   combine it with the local webhook report. `npm run message:status:release`
   can print the current
   private-safe gap report at any point. Then run
   `npm run message:release:redact` after the raw complete report is green and
   commit the generated redacted copy if CI needs repository-visible evidence.
   `npm run message:status:release -- --output artifacts/v0.3.4/message-awareness-status.json`
   can save the current private-safe checklist without copying payload bodies.
3. `v0.4.0+` readiness evidence is complete: `npm run v04:readiness:status`
   must report no blocking checks. This private-safe aggregate verifies the
   required stabilization artifacts, message-awareness release gate, and
   v0.4 privacy/safety posture. Generate the privacy/safety input with
   `npm run privacy:safety:report -- --output artifacts/v0.3.4/privacy-safety.json --require-ready`;
   the aggregate reads that local artifact instead of hardcoding the policy.
   Its default message-awareness inputs are the v0.4 evidence files under
   `artifacts/v0.4.0/`, with the redacted stable copy
   under `docs/release-evidence/v0.4.0-message-awareness.json`. Use the
   `v04:message:*` scripts for v0.4 evidence collection so local smoke, live
   preflight, records, merge, gate, and redaction all target the same files.
   Run `npm run v04:message:preflight:live` before recording pass evidence;
   it is private-safe environment evidence, not proof that the live gates
   passed. For the macOS leg, run `npm run v04:message:probe:macos` during the
   real notification observation window before recording operator evidence; it
   verifies one fresh adapter candidate and no immediate replay without copying
   notification content. `--send-test-notification` is useful only to diagnose
   whether the host can surface local notifications. The readiness and
   completion aggregates include this artifact when
   present so a Full Disk Access or host setup problem shows up as environment
   work instead of being confused with manual live proof. Treat any
   record commands printed by the status/audit reports as templates: replace
   `REPLACE_WITH_*` observed-at, operator, and app placeholders with real
   values before writing pass evidence, because the validator rejects
   placeholder proof. Add
   `--dry-run` to a record command first when you want to confirm the target
   check and evidence file without writing anything; treat any
   `readyToRecord: false` / `preflightWarnings` output as a preflight issue to
   fix before recording pass evidence. Use `--preflight` for automated operator
   runbooks that should stop on those warnings. Prefer
   `npm run v04:message:finalize` after the live checks pass; it chains the
   strict live gate, merge, release gate, redaction, and private-safe status
   output for the v0.4 default paths. Use
   `npm run v04:completion:audit` when reviewing the product plan itself; it
   maps Companion Readiness, Memory Map, Proactive Care v2, Live2D Presence,
   Voice Reliability, Privacy/Safety, and message-awareness live evidence to
   their current artifacts. Beta tags warn; stable tags fail. Use
   `npm run v04:release:gate` before stable promotion so readiness and the
   requirement-level completion audit are checked after the full
   `verify:release` chain; the chained readiness step asserts that
   `verify:release` already ran so readiness and completion next-command lists
   stay focused on remaining evidence gaps.
4. Audit-findings doc still tracks H4 deferral (warn).
5. Stable release notes mention unsigned-build caveats (xattr/SmartScreen)
   (stable only; warn).

A passing check prints `OK` and (when relevant) a metric in dim text.
A failed check prints `FAIL` with a one-line diagnostic; the script
exits 1 after listing every blocker. Warn-only checks print `WARN`
and continue.

---

## `release.yml` workflow

Tag push → `ensure-release` creates (or reuses) a draft release → three platform
builds run in parallel → `publish` flips the draft to published once every
platform succeeds.

- **Pre-release detection**: the `ensure-release` job parses the tag. Any tag
  containing `-` gets `--prerelease` passed to `gh release create`.
- **If a build fails**: the draft stays unpublished. You can fix the root
  cause (sherpa cache miss, etc.) and re-run the failed job through
  `workflow_dispatch` with the same tag.
- **If the publish job fails after the builds succeeded**: rare, but
  `gh release edit <tag> --draft=false` is safe to run manually — the release
  object already exists and is immutable in terms of assets.

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
3. **`publish` failed** → `gh release edit <tag> --draft=false` manually. The
   release object is already there with all its assets.

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
