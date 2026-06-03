# Nexus v0.3.2

> **Stable.** This release adds a clean-room Codex-compatible sprite-pet path to Nexus: local sprite packages, community gallery imports, creator-kit tooling, in-app preview controls, and install/export workflows for custom pets. It also closes the current production and development dependency audit, hardens remote pet downloads, and keeps the release gate aligned with desktop distribution.

## What changes for the user

### Codex-compatible sprite pets

Nexus can now run lightweight `8x9` sprite pets alongside the existing avatar path. A package is a validated `pet.json` plus a `1536x1872` spritesheet with `192x208` cells, row-to-action metadata, frame timing, and transparent unused cells.

The app can discover bundled sprite pets and user-created Codex-compatible packages under `${CODEX_HOME:-~/.codex}/pets/`. Selecting one switches the companion view to the sprite runtime and exposes a Codex action preview so users can inspect idle, waving, review, and other action rows before committing to a pet.

### Community pet import

Settings now includes a Codex pet import surface for user-selected third-party packages. Users can paste a supported gallery page, slug, direct ZIP URL, or community download URL, then Nexus downloads, validates, copies, and activates the package locally.

The in-app gallery browser can list supported community sources, filter entries, and import the selected item through the same validation path. Community art remains third-party content: Nexus treats it as user-selected material and does not claim or silently bundle it as Nexus-owned artwork.

### Pet creation workflow

Nexus now includes the same workflow in UI and CLI form:

- Make a sprite pet from an image or existing atlas.
- Generate a creator prompt for an original Codex-style pet.
- Create a creator kit with row prompts, contact sheets, style references, and QA previews.
- Assemble completed row art into a validated package.
- Export a clean-room reusable runtime bundle.
- Install a validated package into the local Codex custom-pets directory without overwriting an existing id unless explicitly forced.

The creator path is intentionally provenance-aware. It preserves user-owned or licensed art, writes validation reports, and records that no private Codex code or built-in assets were copied.

## Security and reliability

- Remote pet downloads now use the shared network request guard with timeout, DNS/private-network checks, and streaming byte limits instead of buffering untrusted responses first.
- ZIP package extraction now bounds deflated output with `maxOutputLength`, preventing oversized compressed entries from allocating beyond their declared package limit.
- Plugin restart now re-checks the same enabled, approved, and trusted-command policy as plugin start.
- Production and full dependency audit both report zero vulnerabilities after dependency and override updates.
- The sprite package parser, gallery catalog parser, importer, creator kit, visual audit, runtime export, and Codex install paths now have focused unit coverage.

## Developer notes

New npm scripts:

- `npm run pet:validate`
- `npm run pet:make`
- `npm run pet:create-kit`
- `npm run pet:assemble-kit`
- `npm run pet:audit`
- `npm run pet:import`
- `npm run pet:import-gallery`
- `npm run pet:preview`
- `npm run pet:scaffold`
- `npm run pet:install-codex`
- `npm run pet:export-runtime`

See [`ADDING_SPRITE_PET.md`](ADDING_SPRITE_PET.md) for package contracts, creator-kit layout, community import rules, CLI examples, and clean-room provenance guidance.

## Validation

Current local validation for this release candidate:

- `npm run lint`
- `npm run i18n:audit`
- `npm test`
- `npm run build`
- `npm run distribution:audit`
- `npm audit`
- `npm run prerelease-check -- v0.3.2 --quick`

The quick pre-release gate still requires a clean worktree and `HEAD === origin/main` before tagging. The full non-quick gate should be run before pushing the release tag so smoke, coverage, and benchmark stages are not skipped.

## Download

**https://github.com/FanyinLiu/Nexus/releases/tag/v0.3.2**

## Auto-update

- Stable users on `v0.3.1` will auto-upgrade on next launch after the stable release is published.
- Beta users also upgrade by normal semver comparison.

## Unsigned build

This stable is still unsigned:

- **macOS**: run `xattr -dr com.apple.quarantine /Applications/Nexus.app` after install if Gatekeeper blocks launch.
- **Windows**: SmartScreen -> "More info" -> "Run anyway".

Code-signing infrastructure remains separate from the sprite-pet work.

## Known issues

- Community gallery websites are external and can change their HTML or package URLs. Nexus validates imported packages, but a source outage or markup change can still make a gallery entry temporarily unavailable.
- Sprite pets use the Codex/Nexus `8x9` atlas contract. Shimeji, eSheep, or other desktop-pet formats must be converted before import.
- `npm run prerelease-check -- v0.3.2 --quick` skips smoke, coverage, and benchmark stages; do not tag from quick-mode results alone.
