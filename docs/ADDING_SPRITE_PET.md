# Adding Sprite Pets

Nexus supports a lightweight sprite-pet avatar path alongside Live2D. This is a clean-room implementation of the same class of mechanism used by Codex-style desktop pets: a fixed atlas, a small state machine, and a package manifest.

Do not copy private Codex app code or built-in pet assets into Nexus. Reuse the package shape and behavioral contract with original, licensed, or user-provided art.

## Package Shape

A sprite pet package is a folder containing:

```text
pet.json
spritesheet.png
```

Bundled app pets live under `public/pets/<pet-id>/` during development and are copied to `dist/pets/<pet-id>/` by the Vite build. Nexus scans bundled sprite pet manifests and imported sprite pet manifests with the same parser, so new built-in pets should use this package shape instead of hard-coded one-off asset paths.

Nexus also scans user-created Codex-compatible pets from `${CODEX_HOME:-~/.codex}/pets/<pet-id>/`. This is for custom pets you own or generated yourself; do not point Nexus at private Codex application bundles or copy Codex built-in assets into this app.

`pet.json`:

```json
{
  "id": "my-pet",
  "displayName": "My Pet",
  "description": "One short sentence.",
  "spritesheetPath": "spritesheet.png"
}
```

The spritesheet must be PNG or WebP, transparent where unused, and exactly `1536x1872` pixels:

- `8` columns
- `9` rows
- `192x208` pixels per frame

## Easy Creator Flow

Most users should not have to learn the atlas details first. Start from one character image: in the app, use Settings -> Companion -> Avatar -> `Make pet from image/atlas`. Nexus creates the local package, validates it, and switches the active avatar to the generated Sprite pet. If the selected image already looks like a full Codex `8x9` atlas, Nexus detects that automatically. A valid native `1536x1872` Codex atlas is preserved instead of being reanimated from a single frame; a scaled AI-style atlas is split into rows and cells before packaging.

This produces a ready-to-import package:

- `pet.json`
- `spritesheet.png`
- `my-pet.codex-pet.zip`
- `README.md`

The maker removes a simple solid background, creates the required `8x9` atlas, fills unused cells transparently, applies starter row motion, validates the result with the same parser Nexus uses in the app, and writes a shareable `.codex-pet.zip`. After the app flow finishes, the settings panel shows the generated package with actions to open the folder, reveal the ZIP, or install the pet into `${CODEX_HOME:-$HOME/.codex}/pets/`. It does not add speed lines, glow, stars, floor shadows, checkmarks, detached props, or other decorative effects. Start from art that already looks like a Codex digital pet: compact silhouette, thick dark outline, limited palette, flat shading, and a transparent or clean chroma-key background.

For better motion, generate or draw a source image that is already an `8x9` action sheet and let the maker package it. The settings UI detects this automatically.

The user-facing product flow should be:

1. Pick or generate a character image.
2. Nexus builds a starter pet automatically.
3. Preview the 9 action rows.
4. Import/share the generated folder or `.codex-pet.zip`.

Advanced users can still edit `spritesheet.png` frame by frame, but the ecosystem should treat that as optional polish, not the default path.

## Prompt Creator Kit

When a user wants to design a new pet from a concept instead of importing an existing package, generate a creator kit first:

```bash
npm run pet:create-kit -- \
  --id tiny-copper \
  --display-name "Tiny Copper" \
  --concept "a tiny bronze guardian mascot with a square terminal face"
```

The kit writes:

- `creator-brief.json` - machine-readable Codex pet contract and provenance flags.
- `prompts/base.md` - the base mascot prompt.
- `prompts/rows/*.md` - one prompt per Codex action row.
- `references/animation-rows.md` - the exact `8x9`, `1536x1872`, `192x208` row contract.
- `references/style-samples.md` and `references/style-samples.json` - link-only Codex pet style references for proportions, motion, and package expectations.
- `references/layout-guides/*.svg` - one layout-only guide per action row, with the correct frame count, `192x208` cells, safe padding, and center marks.
- `references/quality-checklist.md` - acceptance checks before import.
- `source-rows/README.md` - the exact row-strip filenames to fill after generation.
- `package-template/pet.json` - the manifest template for the finished package.

This is the user-friendly version of the hatch-pet rules. It does not fake artwork with local scripts, and it does not bundle community artwork. The style samples are links only, so users can study the Codex pet feeling while still generating or drawing original, user-owned, or explicitly licensed art.

In the app, the same flow is available from Settings -> Companion -> Avatar -> `Make your own Codex pet`. Nexus writes the creator kit into the user's Documents folder so it can be opened in an image tool, shared, or zipped with the finished art. After creation, the settings panel can open the whole kit folder or open `source-rows/` directly.

For a faster start, the same settings block also exposes `Generate prompt`. This produces one complete copyable prompt with the Codex-style visual contract, the exact `1536x1872` / `8x9` / `192x208` atlas requirements, and the required `source-rows/<row>-<state>.png` filenames. Use it when the user wants to paste one instruction into Codex or an image workflow before creating a full kit folder.

After `Create kit`, Nexus keeps the generated kit directory as the current kit. The `Check kit` and `Assemble kit` buttons use that current directory first, so a user does not have to pick the same folder again. If no current kit is tracked, Nexus falls back to a folder picker.

`Check kit` also writes QA files once at least one row strip exists:

- `qa/source-rows-contact-sheet.svg` embeds the current row images, overlays the Codex `8x9` grid, labels every action row, and marks dimension or transparency warnings.
- `qa/source-rows-motion-preview.html` plays each row strip with the same frame timing Nexus uses for Codex-compatible pets, so users can check whether the pet actually moves like a Codex pet before assembly.

After generating the nine row strips, save them under the kit's `source-rows/` folder with these names:

```text
0-idle.png
1-running-right.png
2-running-left.png
3-waving.png
4-jumping.png
5-failed.png
6-waiting.png
7-running.png
8-review.png
```

Then assemble the finished Codex-compatible package:

```bash
npm run pet:assemble-kit -- ./output/pet-creator-kits/tiny-copper --force
```

The assembler writes `final-package/pet.json`, `final-package/spritesheet.png`, `final-package/assembly-report.json`, `final-package/visual-audit.json`, and a shareable `<pet-id>.codex-pet.zip` next to `final-package/`, then validates the package with the same parser used by Nexus. It does not invent missing row art. If a row strip is absent, the command fails and tells the user which row still needs to be generated.

The settings UI exposes the same step as `Assemble kit`: pick the creator-kit folder, and Nexus assembles `final-package/`, imports the generated pet into the local pet library, and switches the active avatar.

After creating the kit, the settings UI shows `Open creator kit` and `Open row images folder`. Use the full kit action when the user needs prompts, layout guides, and references; use the row-images action when they are only dropping generated row strips into `source-rows/`.

After assembly, the settings UI shows `Final Codex pet package` with actions to open `final-package/`, reveal the generated `.codex-pet.zip`, or install that exact package into `${CODEX_HOME:-$HOME/.codex}/pets/`. Installation is explicit and non-destructive: if a pet id already exists, Nexus writes a suffixed id instead of overwriting the existing Codex pet.

After `Check kit`, the settings UI also shows the generated QA paths with direct desktop actions:

- `Open QA folder` opens the kit's `qa/` directory so the user can inspect the contact sheet and reports.
- `Open motion preview` opens `qa/source-rows-motion-preview.html`, which plays each row strip with the same frame timing used by the Codex-style runtime.

Import the generated `final-package/` folder, share the generated `.codex-pet.zip`, or use the local import flow with that ZIP.

## Community Gallery Import

Nexus should treat existing Codex pet sites as part of the product ecosystem instead of forcing every user to draw a sheet from scratch. Current useful sources are:

- `https://codex-pet.com/` - large community gallery with detail pages, `npx codex-pet-cli add <pet-id>`, and direct `.codex-pet.zip` downloads. Use this as the primary slug/URL import source.
- `https://codexpets.net/gallery` - checked community gallery with hundreds of packages and stable ZIP download endpoints. Nexus can browse these entries in the same in-app gallery list and import detail pages such as `https://codexpets.net/pets/pixel-coder`.
- `https://codingpets.com/` - downloadable community ZIP gallery with per-pet state previews and `pet.json + spritesheet` package metadata. Nexus can import its ZIP links through the same `Import Codex pet` box.
- `https://codex-pet.org/` - large multilingual Codex pet directory with collection pages, install commands, package downloads, and format guides. Nexus can now browse this source in the in-app gallery and import detail pages such as `https://codex-pet.org/pets/solid-box/` by reading the exposed `pet.json` / `spritesheet.webp` asset links.
- `https://codexpets.org/` - lightweight browser, preview, install, and hatch-pet prompt builder. This is useful for users who need to understand the format before creating a package.
- `https://openpets.dev/` - broader open-source desktop-pet ecosystem for AI coding tools, with a large pet gallery and MCP/tool integrations. Use this as inspiration and a conversion source, not as a guaranteed Codex package source.
- `https://openpets.app/pets` - reviewed-pack gallery plus validator-style tooling. Use it to sanity-check package shape and download known-good ZIPs when a direct ZIP is available.
- `https://www.getyourownpet.com/` - PetForge, a third-party photo-to-Codex-pet generator that outputs files users can install under `~/.codex/pets/`.
- `https://spritesheep.com/` or another pixel/sprite editor - use these for hand-editing the row strips before assembly.

Keep these as user-selected sources. Do not bundle community artwork into Nexus unless the asset's license or owner explicitly allows that distribution.

Shimeji and eSheep are useful background ecosystems because they have many desktop-pet characters and mature authoring ideas, but their package shapes are different from Codex's `8x9` atlas contract. Treat Shimeji/eSheep assets as conversion candidates only when the user owns the art or has a clear license. A direct import should fail unless it has been converted into a valid `pet.json + spritesheet` package.

In the app, open Settings -> Companion -> Avatar -> `Import Codex pet`. Users can:

1. Click a community source link to browse or generate a pet.
2. Paste a `codex-pet.com` slug, a `codex-pet.com` detail page, a `codex-pet.org` detail page, or a `codexpets.net` detail page and import it directly.
3. Paste a Coding Pets or CodexPets.net ZIP download URL and let Nexus download, validate, and import it directly.
4. Use `Browse gallery` to load searchable entries from `codex-pet.com`, `codex-pet.org`, CodexPets.net, and Coding Pets inside Nexus, then click `Import`.
5. Download a `.codex-pet.zip` or compatible ZIP from another site and use the local model import button.

When a Sprite pet is selected, the same Avatar settings page shows `Codex action preview`. This uses the actual Nexus/Codex-compatible runtime and lets users loop `idle`, `waving`, `review`, and every other row before deciding whether the pet feels right.

Nexus can also import an existing Codex-compatible gallery pet from a `codex-pet.com` detail page. This is the fastest way to test Nexus against real community pets instead of a local placeholder:

```bash
npm run pet:import-gallery -- solid-box --force
```

The importer reads the gallery page metadata, downloads the referenced `spritesheet.webp` or `spritesheet.png`, writes a local package under `public/pets/<pet-id>/`, and validates the result with the same package parser used by the app.

You can also pass a detail page URL:

```bash
npm run pet:import-gallery -- https://codex-pet.org/pets/solid-box/ --force
```

Treat downloaded community pets as third-party assets. Use them for local testing, user-selected imports, or explicitly licensed bundles; do not silently ship them as Nexus-owned art.

Many community sites expose downloads as a ZIP package instead of a `codex-pet.com` detail page. Nexus accepts those packages directly as long as the ZIP contains a valid `pet.json` and `spritesheet.webp` or `spritesheet.png`:

```bash
npm run pet:import -- ./downloads/my-codex-pet.zip --id my-pet
```

The ZIP importer rejects path traversal, encrypted archives, Zip64 archives, oversized packages, unsupported compression methods, and packages whose manifest does not validate against the same 8x9 atlas contract.

For a deterministic starter that exercises the creator pipeline, generate the bundled Codex-style mascot sample:

```bash
npm run pet:generate-codex-style -- --force
```

That sample is deterministic clean-room vector art with hand-authored frame motion. It exists as a technical baseline for the creator flow: clean transparent frames, visible row-specific motion, and no private Codex code or assets. It is not a substitute for visual QA against real Codex-feeling community pets.

The generator is parameterized so users can make a related pet without learning the atlas first:

```bash
npm run pet:generate-codex-style -- \
  --id my-pet \
  --display-name "My Pet" \
  --body-color "#62a6ff" \
  --accent-color "#79f2ff" \
  --accessory sprout \
  --output-dir output/pets/my-pet \
  --force
```

This is the preferred ecosystem path for Codex-like pets: choose a compact mascot shape, pick colors and one small attached accessory, generate the 8x9 atlas, then preview and import.

## Codex-Style Model Rules

The local Codex app's built-in pets were inspected as a reference for behavior and proportion, without copying their private assets into Nexus. The important model traits are:

- Use a mascot silhouette, not a shrunken human or anime full-body character.
- Keep proportions round and compact: large head/body mass, tiny arms, tiny legs.
- Use a simple terminal-like or icon-like face that reads at `192x208`.
- Keep detail low. Avoid hair strands, costumes, long limbs, weapons as primary silhouette, gradients, glow effects, motion trails, and detached effects.
- Render as pixel-adjacent art with `image-rendering: pixelated`.
- Animate by changing a small number of clear body/face/arm frames. Codex-style motion is readable but restrained.
- Make accessories small, attached, and secondary. A sword, sprout, or spark should not turn the pet into a full character illustration.
- Preserve the exact `8x9`, `1536x1872`, `192x208` contract so Codex-compatible runtimes can play the pet.

Run the visual audit before accepting generated pets:

```bash
npm run pet:audit -- ./path/to/package --strict
```

The audit checks for chroma-key residue, empty frames, weak adjacent-frame motion, over-large sprites that fill or touch the whole cell, fragmented/detached sprite components, and overly complex palettes. It is not a substitute for opening the pet window, but it catches common failures before a user sees them.

## Animation Rows

Rows are interpreted as:

| Row | State | Frames | Durations (ms) |
| --- | --- | ---: | --- |
| 0 | idle | 6 | 280, 110, 110, 140, 140, 320 |
| 1 | running-right | 8 | 120, 120, 120, 120, 120, 120, 120, 220 |
| 2 | running-left | 8 | 120, 120, 120, 120, 120, 120, 120, 220 |
| 3 | waving | 4 | 140, 140, 140, 280 |
| 4 | jumping | 5 | 140, 140, 140, 140, 280 |
| 5 | failed | 8 | 140, 140, 140, 140, 140, 140, 140, 240 |
| 6 | waiting | 6 | 150, 150, 150, 150, 150, 260 |
| 7 | running | 6 | 120, 120, 120, 120, 120, 220 |
| 8 | review | 6 | 150, 150, 150, 150, 150, 280 |

Nexus maps existing companion signals onto those rows: voice listening uses `waiting`, speaking uses `review`, busy work uses `running`, touch uses `jumping`, worried/error-like moods use `failed`, and drag direction uses the directional running rows.

By default, Nexus follows the Codex-style playback pattern: a non-idle row is a transient action. A new request plays that row three times, then falls back to row `0 idle` with the idle frame durations multiplied by `6`, producing the slow resting loop Codex pets use after an action. A new action should change the `requestKey`; repeating the same state with the same `requestKey` will not restart the action.

Creator/debug previews are the exception. When a state is forced through `spritePetState` or the exported demo controls, the requested row loops continuously so users can inspect every frame while making a pet.

## Portable Runtime

The copyable clean-room runtime is split from the React component:

- `src/features/pet/spriteAtlas.ts` defines the atlas contract, animation rows, frame timings, and state mapping.
- `src/features/pet/spriteRuntime.ts` defines the renderer-agnostic state request and atlas-coordinate helpers.
- `src/features/pet/components/SpritePetCanvas.tsx` is only the Nexus React wrapper.

A non-React app can drive the same pet mode with the pure runtime:

```ts
import {
  SPRITE_PET_INITIAL_CURSOR,
  advanceSpritePetAnimationCursor,
  applySpritePetStateRequest,
  resolveSpritePetRenderFrame,
} from './sprite-pet-runtime'

const atlas = { imagePath: './pets/my-pet/spritesheet.png' }
let cursor = SPRITE_PET_INITIAL_CURSOR
let requestedState = 'waiting' as const
let requestKey = 'voice:listening'

cursor = applySpritePetStateRequest({ current: cursor, requestedState, requestKey })

function tick() {
  const renderFrame = resolveSpritePetRenderFrame(atlas, cursor)
  drawSpriteFrame(renderFrame)
  window.setTimeout(() => {
    cursor = advanceSpritePetAnimationCursor(cursor, requestedState, requestKey)
    tick()
  }, renderFrame.frame.durationMs)
}
```

`resolveSpritePetRenderFrame` returns the active row, column, duration, aspect ratio, `backgroundPosition`, and `backgroundSize`, so the same state machine can be used from CSS, Canvas, WebGL, or a native renderer.

To export the runtime for another app without taking the rest of Nexus:

```bash
npm run pet:export-runtime -- --output-dir ./output/sprite-pet-runtime --force
```

The export writes:

- `sprite-pet-runtime.mjs`, a standalone ESM runtime with no React, Electron, or Nexus imports
- `sprite-pet-runtime.d.ts`, TypeScript declarations for the standalone runtime
- `sprite-pet-contract.json`, the machine-readable atlas and row contract
- `export-manifest.json`, the machine-readable clean-room source policy, included package provenance, and SHA-256 file hashes
- `sprite-pet.css`, a CSS renderer shell for web apps
- `demo.html`, a browser demo that imports the standalone runtime
- `electron-host-example.mjs`, a clean-room transparent always-on-top Electron window shell
- `package.json`, local ESM package metadata for bundlers and TypeScript
- `README.md`, a short integration note

To export the runtime with a validated pet package you own:

```bash
npm run pet:export-runtime -- --package ./path/to/package --output-dir ./output/sprite-pet-runtime --force
```

That copies the package into `pets/<pet-id>/` and makes `demo.html` load it by default. The generated bundle carries the clean-room source policy and does not include Codex private code or built-in assets unless you explicitly pass files you have rights to use.

You can also drop the exported folder into another app as a local package and import it through its package entry:

```ts
import {
  SPRITE_PET_INITIAL_CURSOR,
  resolveSpritePetRenderFrame,
} from '@nexus/sprite-pet-runtime'
import '@nexus/sprite-pet-runtime/style.css'
```

For an Electron desktop pet shell, adapt the generated host example:

```bash
electron ./electron-host-example.mjs
```

It uses a transparent, frameless, always-on-top, taskbar-hidden `BrowserWindow` and loads the generated `demo.html`. The generated CSS marks the pet stage as the Electron drag region and marks demo controls as no-drag, so the frameless window can be moved without breaking button clicks.

## Scaffolding

Start a clean-room package without copying any existing app assets:

```bash
npm run pet:scaffold -- my-pet --display-name "My Pet"
```

The default output is `output/pets/<id>/`. The scaffold includes:

- `pet.json`
- transparent `spritesheet.png` at the required `1536x1872` size
- `layout-guide.svg` with the 8x9 grid and row labels
- `README.md` with the row contract

Edit `spritesheet.png` with original, licensed, or user-provided art, then validate and preview the package before importing it.

## Validating

Before importing a package through the app, validate it from the repo root:

```bash
npm run pet:validate -- ./path/to/pet.json
```

You can also pass the package folder:

```bash
npm run pet:validate -- ./path/to/package
```

The validator uses the same package parser as the Electron import flow, so a package that fails here will also fail in the app picker.

The output includes the compatibility report Nexus enforces: atlas dimensions, row-to-state mapping, per-frame durations, and how many unused cells must stay transparent in each row. Use this report as the audit surface when checking whether original art will behave like a Codex-style sprite pet.

For migration tools or another app, emit the same report as stable JSON:

```bash
npm --silent run pet:validate -- ./path/to/package --json
```

The JSON includes the normalized package metadata, atlas dimensions, row contract, alpha policy, and `privateCodexCodeOrAssetsCopied: false`.

## Previewing

Generate a self-contained contact sheet before importing a package:

```bash
npm run pet:preview -- ./path/to/package
```

The default output is `output/pets/<id>-contact-sheet.svg`. The preview embeds the spritesheet, labels all 9 animation rows, and overlays the 8x9 frame grid so you can check row order and frame alignment without launching the app:

```bash
npm run pet:preview -- ./path/to/package --output ./output/pets/my-pet-contact-sheet.svg --scale 0.5
```

## Runtime State Smoke

In development, force a specific sprite row through the pet window URL:

```text
http://127.0.0.1:5188/?view=pet&spritePetState=review
```

Accepted states are `idle`, `running-right`, `running-left`, `waving`, `jumping`, `failed`, `waiting`, `running`, and `review`. The rendered `.sprite-pet` element also exposes `data-sprite-pet-state`, `data-sprite-pet-row`, `data-sprite-pet-column`, and `data-sprite-pet-frame` so browser smoke tests can prove the active row without image matching.

## Bundling

To add a validated package as a bundled app pet, import it into `public/pets`:

```bash
npm run pet:import -- ./path/to/package --id my-pet
```

The source can be a folder, a `pet.json`, or a downloaded Codex pet ZIP. This copies the package to `public/pets/<id>/`, rewrites `pet.json` to the canonical local form, and validates the copied package. Use `--force` only when intentionally replacing an existing bundled pet:

```bash
npm run pet:import -- ./path/to/package --id my-pet --force
```

## Importing

In Settings -> Companion -> Avatar, click the import button and choose either:

- a Live2D `.model3.json`
- a sprite pet `pet.json`
- a downloaded Codex pet `.zip`

For sprite pets, Nexus validates:

- `pet.json` is an object and has a usable `spritesheetPath`
- `spritesheetPath` stays inside the package folder
- spritesheet extension is `.png` or `.webp`
- spritesheet is at most 20MB
- spritesheet dimensions are exactly `1536x1872`
- PNG spritesheets use non-interlaced 8-bit RGBA and all unused cells are fully transparent
- WebP spritesheets advertise an alpha channel

The app copies valid sprite pets into its local model library, then exposes them in the same Avatar picker as Live2D models.

## Codex Custom Pets

If you already have a custom Codex pet package under:

```text
${CODEX_HOME:-~/.codex}/pets/<pet-id>/pet.json
```

Nexus discovers it automatically on startup and serves the spritesheet through a local read-only route. The package is validated with the same parser as imported pets, including atlas size, path containment, and transparency checks.

To install a validated Nexus package into the Codex custom pets directory:

```bash
npm run pet:install-codex -- ./path/to/package
```

The default target is `${CODEX_HOME:-~/.codex}/pets/<pet-id>/`. Use `--codex-home` for a different Codex home, `--id` to rename the installed package, and `--force` only when intentionally replacing an existing custom pet.
