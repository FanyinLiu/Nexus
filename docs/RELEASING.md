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
3. **Never skip the beta stage.** Even for "small" features.
4. **Never bypass `prerelease-check`.** The script is load-bearing — it
   catches the mistakes the release workflow can't recover from.
5. **Before every push**, run `npm run verify:release`. CI runs the same
   four steps (tsc → lint → test → build). Missing any step locally means
   discovering the failure in CI, which wastes ~5 minutes per round-trip.

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

### Stage B — Code quality (5 checks)
1. `npm run verify:release` (tsc + lint + test + build).
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
   release) → investigate via `gh release view <tag>`. If the release is
   legitimate and the job was spurious, nothing to do. If the release is a
   mistake, you may need to burn this tag and use the next suffix.
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
