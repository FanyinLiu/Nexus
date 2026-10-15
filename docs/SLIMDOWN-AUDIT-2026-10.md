# Slim-down audit — October 2026

Measured on `main` at `6ec98f7513906bb9d2c3cb0c882b97b8768c47e9`
(`nexus@0.4.8-beta.1`). Counts are git-tracked files only
(`node_modules`, `dist`, `release`, and `public/vendor` are ignored).
Line counts are newline counts. “Code” is `.ts`, `.tsx`, `.js`, `.mjs`,
`.cjs`, `.css`, and `.py`. “Text” also includes `.json`, `.md`, and `.html`.

This pass keeps shipped behavior. Portrait Puppet v4, Live2D import, and
the existing one-image procedural portrait puppet stay. The dropped
“one image → desktop pet” generator was never merged; see below.

## Size by area

| Area | Bytes | Text lines | Text files |
| --- | ---: | ---: | ---: |
| `public/` | 17.83 MiB | 57,056 | 56 |
| `src/` | 6.69 MiB | 142,259 | 737 |
| `docs/` | 4.39 MiB | 22,798 | 133 |
| `scripts/` | 2.22 MiB | 32,337 | 97 |
| `tests/` | 2.21 MiB | 63,449 | 337 |
| `electron/` | 1.31 MiB | 40,795 | 171 |
| repo root | 0.50 MiB | 12,682 | 21 |
| `shared/` | 0.08 MiB | 2,237 | 42 |
| other | 0.05 MiB | 39 | 2 |
| **Total** | **35.29 MiB (37,004,678 bytes)** | **373,652** | **1,596 of 1,796 tracked files** |

Code lines: **280,994** across the code extensions above.

`public/` is almost all shipped avatar bytes, not source:

| Path | Size |
| --- | ---: |
| `public/live2d/hiyori` | 4.8 MiB |
| `public/live2d/mao` | 4.2 MiB |
| `public/live2d/haru` | 3.2 MiB |
| `public/pets/codex/spritesheet.webp` | 2.5 MiB |
| `public/pets/qiyi/spritesheet.webp` | 2.1 MiB |
| `public/nexus-1024.png` | 0.6 MiB |
| `public/banner.png` | 0.5 MiB |

`docs/archive/nexus_icons/` was 121 unreferenced concept PNGs (about 3.2 MiB
of git blobs). That directory is removed in the safe-cut PR.

Code lines by subtree (before this PR):

| Subtree | Code lines | Files |
| --- | ---: | ---: |
| `tests/` | 63,419 | 336 |
| `src/features/` | 61,458 | 347 |
| `scripts/` | 32,010 | 95 |
| `src/app/` | 30,972 | 94 |
| `electron/services/` | 21,694 | 85 |
| `src/hooks/` | 15,100 | 76 |
| `src/i18n/` | 14,198 | 90 |
| `src/lib/` | 8,619 | 55 |
| `src/components/` | 6,750 | 33 |
| `electron/ipc/` | 6,686 | 43 |
| `shared/` | 2,237 | 42 |

## Largest source files

Default `source-size:audit` budget is 1,200 lines. These are the largest
code files. CSS files with a raised budget are called out.

| Lines | File | Note |
| ---: | --- | --- |
| 5,985 | `src/app/App.css` | budget 8,400 |
| 5,622 | `src/app/styles/settings-themes.css` | budget 11,000; legacy layer |
| 2,055 | `src/app/styles/settings.css` | budget 7,300; legacy layer |
| 1,397 | `tests/ipc-payload-schema.test.ts` | budget 1,400 |
| 1,165 | `tests/fixtures/settingsSurfaceAuditBaseline.ts` | CSS baseline fixture |
| 1,123 | `tests/storage-settings.test.ts` | |
| 1,113 | `src/components/SettingsDrawer.tsx` | |
| 1,111 | `src/features/pet/portraitPuppetRenderer.ts` | shipped one-image puppet |
| 1,097 | `electron/services/petModelService.js` | |
| 1,088 | `src/vite-env.d.ts` | preload IPC surface |
| 1,066 | `scripts/open-source-ui-reference-audit.mjs` | `verify:pr` gate |
| 1,028 | `electron/chatRuntime.js` | |
| 1,021 | `src/app/styles/settings-product-reference-final.css` | legacy layer |

Splitting these does not shrink the product. It is listed under owner
decisions because several files are frozen by `CSS-2` or sit on the IPC
and settings gates.

## Dependencies

`package.json`: **13** runtime dependencies, **27** devDependencies.
`package-lock.json`: **690** packages. `npm ci` produced a real
`node_modules` directory (not a symlink), **1.4 GiB** on Linux.

Largest install directories (including what a package pulls in beside
itself):

| Install size | Package | Role |
| ---: | --- | --- |
| 513 MiB | `onnxruntime-node` (transitive) | Sherpa native runtime. `package.json` `build.files` already excludes it from the installer |
| 137 MiB | `@huggingface/transformers` | Also excluded from the installer |
| 132 MiB | `onnxruntime-web` | Mostly excluded; a VAD slice is kept |
| 69 MiB | `pixi.js` | Live2D renderer |
| 44 MiB | `tesseract.js-core` (transitive) | OCR. `tesseract.js` itself is excluded from the installer |

`knip --include files,dependencies,unlisted,binaries` reports **no unused
files and no unused direct dependencies**. `onnxruntime-web` is an
intentional `ignoreDependencies` entry because the browser build loads it
by URL. There is no safe dependency deletion in this pass.

## Packaged app

Current GitHub release `v0.4.8-beta.1` (2026-10-15), installer bytes:

| Artifact | Bytes | MiB |
| --- | ---: | ---: |
| `Nexus-Setup-0.4.8-beta.1.exe` | 355,307,944 | 339 |
| `Nexus-Setup-0.4.8-beta.1.deb` | 378,025,000 | 361 |
| `Nexus-Setup-0.4.8-beta.1.AppImage` | 402,200,694 | 384 |
| `Nexus-Setup-0.4.8-beta.1.tar.gz` | 403,115,705 | 384 |
| `Nexus-Setup-0.4.8-beta.1.zip` | 412,770,925 | 394 |
| `Nexus-Setup-0.4.8-beta.1.dmg` | 415,255,196 | 396 |

`scripts/package-size-audit.mjs` caps an unpacked app at **550 MiB**.
A fresh `electron-builder --dir` was not run for this audit: it repeats
the CI packaged smoke, and the safe cuts below are outside the installer
file set (`docs/` is not packaged; the i18n deletion is a few hundred
lines inside `app.asar`). Installer size is unchanged by this PR.

## Dropped image-to-pet route

PRs **#134**, **#135**, **#136**, and **#138** are closed and unmerged
(2026-10-15). Their commits live only on the feature branches
(`feat/v0.5-reject-image`, `feat/v0.5-landmark-gate`,
`feat/v0.5-portrait-draft`, `feat/v0.5-portrait-flow`).

On `main` there is:

- no `electron/services/portraitGenerator/`
- no `shared/portraitModels.js` / `PORTRAIT_MODEL_CATALOG`
- no `portrait-models-v1` string in source, docs, or scripts
- no portrait-generator audit or script

The one-image files that *are* on `main` are the shipped procedural puppet
(`src/features/pet/portraitPuppet.ts`, `electron/services/portraitPuppetPackage.js`,
`PortraitPuppetCanvas`), not the generator. Portrait Puppet v4
(`portraitPuppetV4*`, `scaffold-portrait-puppet-v4.mjs`) and Live2D import
(`shared/live2dModelResources.js`, `electron/services/live2dModelCompatibility.js`)
stay.

Outside the git tree, GitHub release **`portrait-models-v1`** (2026-10-02,
“v0.5 一张图生成宠物用模型文件”) still hosts the ONNX weights the unmerged
pipeline would have downloaded:

| Asset | Bytes |
| --- | ---: |
| `anime_face_yolov3.onnx` | 246,035,424 |
| `isnetis.onnx` | 176,069,933 |
| `anime_face_hrnetv2_flip.onnx` | 39,046,070 |

About **461 MiB** of release assets. Nothing on `main` fetches them.
Deleting that release is an owner action; this PR does not delete tags,
releases, or branches.

`docs/ROADMAP.md` already points v0.5 at adaptive desktop presence
(mouse proximity, typing rhythm, idle, window edges), not image generation.

## Dead code the gates already catch

`npm run knip:check` is in `verify:pr`, so unreachable files and unused
direct dependencies are already empty.

Knip’s unused-export report (tests included) is 20 symbols. Almost all of
them are used inside their own module and only “unused” as exports.
Three had no callers at all and are removed in this PR:

- `syncPetWindowInstances` in `electron/petWindowInstances.js` (the live
  path is `applyPetWindowInstances`)
- `isPortraitPuppetModel` in `src/features/pet/portraitPuppet.ts`
- `ALL_WEATHER_CONDITIONS` in `src/features/panelScene/weatherCondition.ts`
  (the `WeatherCondition` union and `classifyWeatherCondition` stay)

`knip --production` lists a much larger export set. Those symbols are
imported by tests or by the other process. Deleting them would break
tests or IPC. Not a safe cut.

## Duplicated helpers

`normalizeWhitespace` exists in both `src/lib/normalize.ts` and
`electron/textNormalize.js`. That split is required: `ARCH-4` forbids
cross-process imports, and `SRC-4` requires the Electron copy to come
from `electron/textNormalize.js`. Folding them into `shared/` is a
refactor, not a deletion, and the two copies are already the same
collapse-and-trim.

`src/lib/normalize.ts` records that private `clamp` / normalize variants
were left in place when their null-vs-undefined or rounding behavior
differs. Spot checks (`clampScore`, `clampFinite`, `clampEveryMinutes`,
`clampPortraitRigValue`) match that note. Collapsing them would change
edge behavior. Not a safe cut.

## What this PR cuts (safe)

No settings keys, storage keys, IPC channels, or shipped features change.

| Cut | Why it is safe | Size |
| --- | --- | --- |
| `src/i18n/locales/*/integration.ts` (5 files, 50 keys × 5 locales) | Keys appear only inside those files. Settings uses `settings.integrations.*`, which stays. No test, audit, or component reads `integration.*` | 5 files, ~270 lines |
| `settings.history.migration.*` in all 5 `settings-history.ts` modules (96 keys each) | The history screen (`HistorySectionV3`) does not reference them. Memory migration (`settings.memory.migration.*` in `MemoryMigrationAdaptersV3.tsx`) is a different, still-wired UI and is untouched. No test or audit names the history-migration keys | 480 lines |
| `docs/archive/nexus_icons/**` | 121 concept/tray PNGs from retired icon directions. No markdown, script, test, or audit references the directory. Shipped icons remain in `public/nexus-*` | 121 files, 3.21 MiB of deleted git blobs |
| Three uncalled functions listed above | No imports, including tests | ~17 lines |

Combined: **−126 files, −780 lines, −3.21 MiB** of deleted blobs.
Adding this audit brings the tracked file count from 1,796 to **1,671**
(1,796 − 126 + this document). Runtime dependencies stay 13 / 27.
Direct dependency set is unchanged, so the lockfile package count stays 690.

## Needs an owner decision

These are not in the PR.

| Candidate | Risk if removed | Expected savings |
| --- | --- | --- |
| GitHub release `portrait-models-v1` and the four closed branches | The weights are unused by `main`, but deleting a published release and branches is a publish action. v0.5 presence work should not revive the generator without a new decision | ~461 MiB of release assets, 0 bytes in this repo |
| 37 markdown files with no inbound link (old release notes, handoffs, `docs/MILESTONE-5-…`, `docs/V0.4.0_UPGRADE_PLAN.md`, `docs/STATE_CLASSIFICATION.md`, the two remaining `docs/archive/*.md`, `docs/superpowers/…`) | `DOC-5` treats date-stamped docs as historical records. `v04-draft-stack-audit` builds some release-note paths from the current stable version, so a blind delete can fail the gate. A link-only search also misses dynamic paths | ~257 KB |
| `scripts/icon-source/nexus-icon-2048.png` | `docs/GITHUB_UPLOAD_PREP.md` lists it as the intentional icon master | 1.1 MiB |
| One of Mao / Haru / Hiyori, or a bundled pet (`public/pets/codex`, `public/pets/qiyi`) | Shipped avatars. Live2D three-model smoke and pet import cover them | 2–5 MiB each |
| Legacy settings CSS (`settings.css`, `settings-themes.css`, `settings-product-reference-final.css`, `App.css`) | `CSS-2` freezes `*-legacy.css` except `uiV2=0` bug fixes. `settings:css:audit` caps rule counts. Unused-selector pruning needs a coverage run (`settings:css:coverage`) so dynamic class names are not deleted | Potentially thousands of lines; high visual risk |
| Chat / memory migration *implementation* (`chatMigrationPreview.ts`, `chatMigrationDryRun.ts`, `memoryMigrationDryRun.ts`, `localDataChatMigration.js`, `settingsMigrations.ts`) | The history-migration *copy* was unused and is removed above. The modules still back storage migration and settings schema upgrades. Dropping an old settings migration breaks existing installs. `STORE-3` | ~1,900 lines, high data-risk |
| Old About spotlight strings (`about.release_spotlight.bullet.companion_presence` and the other bullets no longer in `CURRENT_RELEASE_SPOTLIGHT`) | `tests/release-spotlight.test.ts` still asserts that copy. Removing it means editing tests, which this task does not do without an owner ask | ~30 keys × 5 locales |
| Further i18n keys that never appear as literals (`settings.console.cost.chart.*`, `settings.console.timeline.*` beyond the keys `ConsoleSectionV3` already calls) | Several prefixes are built dynamically (`settings.memory.migration.status.${status}`, `about.faq.q.${n}`). A literal scan false-flags those. A second pass has to follow each template | A few hundred lines if confirmed |
| Replace `sherpa-onnx-node` / stop installing `onnxruntime-node` | Changes the local speech stack and violates the “no dependency upgrades” rule unless the owner asks | ~513 MiB install weight; installer already excludes it |
| `PROJECT_AUDIT_AND_ROADMAP_2026.md` | Stale (describes v0.3.1) but it is a historical review, not generated junk | ~19 KB |

## Gate notes

`knip` is already clean for files and dependencies, which is why the safe
code deletion is unused copy and unreferenced binaries rather than a
large dead-module drop. `verify:pr` still has to pass after the i18n
key removal because `TranslationKey` is derived from the zh-CN dictionary.

## Follow-up (owner-approved)

The GitHub release `portrait-models-v1` is deleted. The git tag of the same
name is kept. Nothing on `main` downloaded those weights.

Image-to-pet is removed from this tree: Portrait Puppet v1–v4, the sprite-pet
assembler, the creator kit, and `pet:generate-codex-style`. Live2D import
stays. Community sprite import (ZIP, gallery, and `pet.json`) stays, so the
sprite renderer stays. The shipped app does not include a bundled sprite pet.
`npm run pet:audit` remains a dev-only spritesheet check. `sharp` is a
devDependency and is no longer unpacked into the installer.

Built-in models are only the official Live2D samples. Mao, Haru, and Hiyori
ship, and Mao stays the default. Bundled sprite pets Pip (`codex`) and Qiyi
are removed. `main` had no other official Live2D samples.

Settings schema 12, changed in place because it has not shipped, maps a stored
`codex` or `qiyi` selection to `mao`, including character profiles. The
historical v5 step still rewrites `qiyi` to `codex`; schema 12 then rewrites
that to `mao`. Stored `haru` and `hiyori` stay. Other stored ids are left
alone by the migration, including user-imported models.

Portrait packages and assembler-marked sprite packages (description prefix
`Assembled Codex-compatible sprite pet package`) fail closed as
`UNSUPPORTED_FILE` and are not discovered. After a ready discovery, a root
selection or character profile whose id is absent from the library is set to
Mao. An assembled pet whose description was edited off that prefix remains a
playable imported sprite. A community pet whose id is exactly `codex` or
`qiyi` is remapped by schema 12 along with the removed bundled ids.
