# Nexus v0.3.2

> **Stable release candidate.** `v0.3.2` is a desktop-distribution and companion-reliability release. It adds the clean-room Codex-compatible sprite-pet path, messaging-notification announcements, a refreshed model-provider catalog, MiniMax Token Plan support, safer API-key handling, and a broad set of packaging, IPC, safety, and settings-sync fixes.

## What changes for users

### Codex-compatible sprite pets

Nexus can now run lightweight `8x9` sprite pets alongside the existing avatar path. A package is a validated `pet.json` plus a `1536x1872` spritesheet with `192x208` cells, row-to-action metadata, frame timing, and transparent unused cells.

The app discovers bundled sprite pets and user-created Codex-compatible packages under `${CODEX_HOME:-~/.codex}/pets/`. Selecting one switches the companion view to the sprite runtime and exposes preview controls for idle, waving, review, and other action rows before committing to a pet.

### Community pet import and creator workflow

Settings includes a Codex pet import surface for user-selected third-party packages. Users can paste a supported gallery page, slug, direct ZIP URL, or community download URL, then Nexus downloads, validates, copies, and activates the package locally.

The creator workflow is available through UI and CLI:

- Make a sprite pet from an image or existing atlas.
- Generate a creator prompt for an original Codex-style pet.
- Create a creator kit with row prompts, contact sheets, style references, and QA previews.
- Assemble completed row art into a validated package.
- Export a clean-room reusable runtime bundle.
- Install a validated package into the local Codex custom-pets directory without overwriting an existing id unless explicitly forced.

The creator path is provenance-aware. It preserves user-owned or licensed art, writes validation reports, and records that no private Codex code or built-in assets were copied.

### Communication message announcements

Nexus can now announce incoming communication messages through the local message webhook path. The release includes adapters for macOS notification watching, macOS Shortcuts, Windows PowerShell, and Hammerspoon, plus Telegram/Discord announcement wiring in the renderer.

The feature is gated by settings so users can decide whether Nexus announces only that a message arrived or includes a preview. Webhook payloads are bounded and validated before they enter the companion pipeline.

### Model providers refreshed

The text-model provider catalog has been refreshed against provider documentation and current endpoint behavior:

- OpenAI, Anthropic, Gemini, DeepSeek, Moonshot/Kimi, MiniMax, DashScope/ModelStudio, SiliconFlow, Together, Mistral, Qianfan, Z.ai, Doubao/BytePlus, NVIDIA NIM, Venice, OpenRouter, xAI, Ollama, and custom OpenAI-compatible paths were reviewed.
- China/global endpoints are split where the provider uses different hosts, including Moonshot, MiniMax, DashScope, SiliconFlow, Doubao/BytePlus, and Kimi Anthropic-compatible paths.
- MiniMax Token Plan now exposes `MiniMax-M3`, with separate China and Global presets.
- Stale or shut-down model IDs were removed from the default lists where they were known to cause failed requests.
- The model-context heuristics were updated for new flagship and long-context families.

### Safer API-key handling

Nexus now rejects pasted model API keys that cannot be sent in HTTP headers. This catches common mistakes such as Chinese notes, plan descriptions, model names, spaces, and line breaks before they become low-level `ByteString` or fetch failures.

The same rule is applied to the primary text key, stored provider profiles, and additional failover rotation keys.

### Chat, TTS, and voice stability

- Streaming chat now handles empty provider deltas and terminal frames more consistently.
- TTS stream cleanup is more defensive, reducing stuck playback and late-controller races.
- Wake-word and voice startup paths have additional lifecycle hardening.
- MiniMax and other provider credentials are normalized before network calls.

### Settings and reminder sync

Settings changes now propagate across app windows more reliably, and reminder task updates are synchronized so multiple windows do not drift out of date.

### Safety and onboarding polish

This release carries forward the safety/disclosure work that landed after `v0.3.1`:

- Crisis-utterance detection and hotline panel wiring.
- Persona-reframe crisis guidance in the chat path.
- AI-disclosure onboarding and periodic reminders.
- Five-locale safety/support README updates.
- Companion wake-up checklist before first launch.

### UI and packaging polish

The settings surface, onboarding bars, detail layouts, day-theme contrast, responsive wrapping, and model flow were polished for a cleaner desktop experience.

Linux packaging was fixed so Sharp native libraries are unpacked from `app.asar`; this matters for packaged Ubuntu builds. The release workflow also produces Linux `.deb`, `.AppImage`, `.tar.gz`, `SHA256SUMS`, and optional detached signatures when a GPG key is configured.

## Security and reliability

- Remote pet downloads use the shared network guard with timeout, DNS/private-network checks, and streaming byte limits.
- ZIP package extraction bounds deflated output with `maxOutputLength`.
- Renderer navigation, external links, workspace symlink writes, local-service probes, and webhook auth received additional hardening.
- Plugin restart re-checks the same enabled, approved, and trusted-command policy as plugin start.
- Production and full dependency audit paths were brought back to zero known vulnerabilities.
- The sprite package parser, gallery catalog parser, importer, creator kit, visual audit, runtime export, Codex install path, model catalog, provider URL inference, API-key normalization, and communication webhook all have focused unit coverage.

## Developer notes

New or updated npm scripts:

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

The release workflow creates a draft release, runs the tag-safe pre-release gate, builds Windows/macOS/Linux artifacts in parallel, uploads the assets, and publishes only after every platform job succeeds.

## Validation before publishing

Do not publish `v0.3.2` from a dirty worktree or from the feature branch directly. The current release gate expects:

- `package.json.version === 0.3.2`
- local and remote tag `v0.3.2` do not already exist
- working tree clean
- `HEAD === origin/main`
- CI green for the tagged commit
- `npm run verify:release`
- `npm run prerelease-check -- v0.3.2` for the full stable gate

Useful local checks before opening the release PR:

- `npm test`
- `npm run build`
- `npm run lint`
- `npm run i18n:audit`
- `git diff --check`

## Download

After publication:

**https://github.com/FanyinLiu/Nexus/releases/tag/v0.3.2**

Expected assets:

- Windows: `Nexus-Setup-0.3.2.exe`
- macOS Apple Silicon: `Nexus-Setup-0.3.2.dmg`, `Nexus-Setup-0.3.2.zip`
- Linux/Ubuntu: `Nexus-Setup-0.3.2.deb`, `Nexus-Setup-0.3.2.AppImage`, `Nexus-Setup-0.3.2.tar.gz`, `SHA256SUMS`

## Auto-update

- Stable users on `v0.3.1` will auto-upgrade on next launch after the stable release is published.
- Beta users also upgrade by normal semver comparison.

## Unsigned build

This stable is still unsigned:

- **macOS**: run `xattr -dr com.apple.quarantine /Applications/Nexus.app` after install if Gatekeeper blocks launch.
- **Windows**: SmartScreen -> "More info" -> "Run anyway".

Apple Developer ID notarization and Windows code signing are still separate release-infrastructure work.

## Known issues

- Community gallery websites are external and can change their HTML or package URLs. Nexus validates imported packages, but a source outage or markup change can still make a gallery entry temporarily unavailable.
- Sprite pets use the Codex/Nexus `8x9` atlas contract. Shimeji, eSheep, or other desktop-pet formats must be converted before import.
- macOS release artifacts are Apple Silicon only in the GitHub workflow. Intel macOS requires a dedicated x64 runner because cross-building can package the wrong native dependencies.
- Builds remain unsigned, so first launch can require a manual trust step on macOS and Windows.
