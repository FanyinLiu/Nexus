<p align="center"><img src="public/banner.png" alt="Nexus" width="720" /></p>

<h1 align="center">Nexus</h1>

<p align="center"><b>A desktop AI companion that remembers, dreams, and lives on your screen.</b></p>

<p align="center">
  <a href="https://github.com/FanyinLiu/Nexus/releases/latest"><img src="https://img.shields.io/github/v/release/FanyinLiu/Nexus?style=flat-square&color=blue&label=release" alt="Release"></a>
  <a href="https://github.com/FanyinLiu/Nexus/blob/main/LICENSE"><img src="https://img.shields.io/github/license/FanyinLiu/Nexus?style=flat-square" alt="License"></a>
  <a href="https://github.com/FanyinLiu/Nexus/stargazers"><img src="https://img.shields.io/github/stars/FanyinLiu/Nexus?style=flat-square&logo=github" alt="Stars"></a>
  <a href="https://github.com/FanyinLiu/Nexus"><img src="https://img.shields.io/github/last-commit/FanyinLiu/Nexus?style=flat-square" alt="Last Commit"></a>
  <a href="https://github.com/FanyinLiu/Nexus/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/FanyinLiu/Nexus/ci.yml?branch=main&style=flat-square&label=ci" alt="CI"></a>
</p>

<p align="center">
  <b>English</b> · <a href="docs/README.zh-CN.md">简体中文</a> · <a href="docs/README.zh-TW.md">繁體中文</a> · <a href="docs/README.ja.md">日本語</a>
</p>

<p align="center">
  <a href="https://github.com/FanyinLiu/Nexus/releases/latest/download/Nexus-Setup-0.2.5.exe"><img src="https://img.shields.io/badge/Windows-Download-0078D4?style=for-the-badge&logo=windows&logoColor=white" alt="Windows"></a>
  <a href="https://github.com/FanyinLiu/Nexus/releases/latest"><img src="https://img.shields.io/badge/macOS-Download-000000?style=for-the-badge&logo=apple&logoColor=white" alt="macOS"></a>
  <a href="https://github.com/FanyinLiu/Nexus/releases/latest"><img src="https://img.shields.io/badge/Linux-Download-FCC624?style=for-the-badge&logo=linux&logoColor=black" alt="Linux"></a>
</p>

> Nexus is under active development. Some features are stable, others are still being polished. Feedback and issue reports are welcome.

---

## Introduction

Nexus is a cross-platform desktop AI companion powered by LLMs. It pairs a Live2D character with **continuous voice conversation**, **long-term memory**, **desktop awareness**, **autonomous behavior**, and **MCP-style tool calling** — designed to feel less like a chatbot and more like someone who actually gets to know you.

The project is built as a local-first Electron app. Every voice frame, every memory entry, and every tool call runs on your own machine; the LLM calls themselves are the only thing that leaves your computer, and you pick the provider. You can mix and match 18+ chat providers, swap STT / TTS engines, even run fully offline with a local model + local ASR + local TTS.

The design goal is persistence of relationship, not just chat. A nightly **dream cycle** clusters your conversations into *narrative threads* that feed back into the system prompt, so the companion's sense of "who you are" compounds over time instead of resetting every session.

## News

- **2025.04.19** — **Autonomy Engine V2** is now default-on. The hand-written rule tree is replaced by a single LLM decision call gated by the tick loop, consuming a layered context snapshot and filtered through a persona guardrail. See [What's new in v0.2.5](#whats-new-in-v025--autonomy-engine-v2) below for architecture and migration notes.
- **2025.04.16** — v0.2.4 released. Big voice/TTS reliability pass (tool-call TTS, markdown stripping, empty-stream detection, first-audio watchdog), Anthropic prompt caching wired on the system + tools prefix, wake-word gaps tightened, 20+ bug fixes. [Changelog →](https://github.com/FanyinLiu/Nexus/releases/tag/v0.2.4)
- **2025.04.15** — Wake-word + VAD rewrite (Plan C): main-process Silero VAD + sherpa-onnx-node, single mic stream. Fixes the "only fires once" wake bug.
- **2025.04.14** — TTS intermittency fixes: retry / per-segment events / sender teardown.
- **2025.04.12** — Speech-interrupt architecture: echo-cancelled mic + TTS-aware dynamic threshold. Echo leak no longer wakes the companion mid-sentence.
- **2025.04.10** — Hybrid memory landed: three-tier hot / warm / cold + BM25 + local vector search.
- **2025.04.01** — v0.1 opened. First playable build.

## Highlights

- 🎙️ **Always-on wake word.** Say the name and start talking — no button. sherpa-onnx keyword spotter running alongside main-process Silero VAD over one shared mic stream. 30 ms ACK gap, 500 ms cooldown.

- 🗣️ **Continuous voice chat.** Multi-engine STT / TTS with automatic failover, sentence-immediate streaming TTS (first audio at the first comma), 6-second first-audio watchdog, echo-cancelled self-interrupt so the pet never wakes itself up while talking.

- 🧠 **Memory that dreams.** Three-tier hot / warm / cold with hybrid BM25 + vector search. A nightly dream cycle clusters conversations into *narrative threads* so the companion's sense of you compounds over time instead of resetting each session.

- 🤖 **Autonomous inner life (V2).** Single LLM decision call per tick, fed a layered snapshot (emotion · relationship · rhythm · desktop · recent chat) and filtered through a per-persona guardrail. No more formulaic template output — it writes in its own voice, and can also choose to stay silent. See [What's new in v0.2.5](#whats-new-in-v025--autonomy-engine-v2).

- 🔧 **Built-in tools.** Web search, weather, reminders. Works with native function calling **and** a prompt-mode fallback for models that don't support `tools`.

- 🔄 **Provider failover.** Chain multiple LLM / STT / TTS providers. When one goes down, Nexus switches to the next without tearing the conversation down.

- 🖥️ **Desktop awareness.** Foreground window title, clipboard, and (optionally) screen OCR. Context triggers let it react to what you're actually doing.

- 🔔 **Notification bridge.** Local webhook server + RSS polling — push external notifications into the companion conversation.

- 💬 **Phone reachable.** Discord and Telegram gateways with per-chat routing. Talk to your companion from your phone, have it respond in its own voice.

- 🌐 **Multilingual UI.** Simplified Chinese, Traditional Chinese, English, Japanese, Korean.

- 💰 **Cost-aware.** Built-in budget metering + Anthropic prompt caching on the system + tools prefix (30-50% input token reduction on long sessions).

## What's new in v0.2.5 — Autonomy Engine V2

> **TL;DR** — The old rule-based decision tree (~900 lines of templates) has
> been replaced by a single LLM call per tick, wrapped in a per-persona
> guardrail. Proactive speech now sounds like the persona instead of like a
> template. Feature flag was flipped on by default in this release.

### Why we rewrote it

The v1 autonomy pipeline was three pieces of hand-written logic bolted
together:

- `proactiveEngine.ts` — a decision tree over hard-coded templates
- `innerMonologue.ts` — a separate LLM call for "what is the pet thinking?"
- `intentPredictor.ts` — another LLM call for "what will the user say next?"

Emotion, relationship, and rhythm were all tracked faithfully — but they
barely flowed into the words that came out, because the output layer was a
template picker, not a writer. Users reported the proactive lines felt
"childish" and "formulaic" regardless of persona. That's what V2 fixes.

### What V2 actually does

```
tick (eligible?) → contextGatherer → decisionEngine → personaGuardrail → delivery
      │                 │                  │                │              │
      └─ legacy gates   └─ pure signal    └─ one LLM       └─ forbidden   └─ speak via
         (awake, VAD,      aggregator        call that        phrase +       the same
          quiet hours,     (no IO, no        returns          density        streaming
          cost limit)      React)            {speak, text,    checks, LLM    TTS path as
                                             silence_reason}  judge option   manual chat
```

Key shifts from V1:

| | V1 | V2 |
|---|---|---|
| Decision surface | Rule tree picks from templates | Single LLM call writes the line |
| Context | Scattered reads inside the tree | One pure `contextGatherer` snapshot |
| Persona voice | Prompt glue, no enforcement | Multi-file persona + guardrail layer |
| Silence | "No rule fired" | First-class `silence_reason` output |
| Cost | 2–3 LLM calls (monologue + intent + speak) | 1 LLM call, reuses primary or dedicated model |
| Testability | React-entangled | Pure modules, tested in plain Node |

### Persona files

Per-persona config is now file-based instead of stuffed into a JSON field.
Look at `src/features/autonomy/v2/personas/xinghui/` for the reference
layout:

```
soul.md       — first-person backstory, voice, values
style.json    — tone knobs (temperature hints, emoji policy, register)
examples.md   — few-shot exemplars the decision prompt reads
voice.json    — TTS voice id / provider overrides for this persona
tools.json    — which tools the persona is allowed to call
memory.md     — long-term facts the persona "remembers"
```

The guardrail reads `style.json`'s forbidden phrases + density caps and
can optionally re-prompt an LLM judge if the output feels off-voice.
Strictness is user-tunable (`autonomyPersonaStrictnessV2`: `loose | med | strict`).

### Tuning

Settings → **Autonomy**:

- **Enable V2** (`autonomyEngineV2`) — on by default in this release. Toggle
  off to fall back to the V1 tree (still shipped during the migration).
- **Activity level** (`autonomyLevelV2`) — `off | low | med | high`. Controls
  both tick density and how often the LLM is allowed to pick `speak`.
- **Model** (`autonomyModelV2`) — leave empty to share the primary chat
  provider, or pin a cheaper / faster model for the decision call.
- **Strictness** (`autonomyPersonaStrictnessV2`) — `loose | med | strict`
  for the guardrail.

### What still lives on V1

Emotion model, relationship tracker, rhythm learner, focus awareness, dream
cycle, goal tracker — all unchanged and feeding into V2's context snapshot.
The V1 decision path (`proactiveEngine.ts` + `innerMonologue.ts` +
`intentPredictor.ts`) stays in the tree until it has been side-by-side
validated; Phase 6 of the migration deletes it.

See `src/features/autonomy/README.md` for the internal layering rules and
`src/features/autonomy/v2/` for the source.

## Install

### Pre-built installer (recommended)

Grab the latest installer from the [releases page](https://github.com/FanyinLiu/Nexus/releases/latest):

| Platform | Asset |
|---|---|
| Windows | `Nexus-Setup-0.2.5.exe` (NSIS, unsigned — click *More info → Run anyway* on first launch) |
| macOS | `.dmg` or `.zip` (unsigned — see macOS steps below) |
| Linux | `.AppImage` / `.deb` / `.tar.gz` (AppImage: `chmod +x` then run) |

**macOS first launch (unsigned build)**

1. Open the `.dmg` and drag `Nexus.app` into `/Applications`.
2. Remove Gatekeeper's quarantine flag — open Terminal and run:
   ```bash
   xattr -dr com.apple.quarantine /Applications/Nexus.app
   ```
   (Or: right-click Nexus.app → Open → confirm in the dialog.)
3. Launch Nexus. On first run a **"安装本地语音模型"** wizard appears — click **一键下载**
   to pull ~280 MB of sherpa-onnx + VAD models into
   `~/Library/Application Support/Nexus/sherpa-models`. The wizard can be
   dismissed and reopened later from Settings.
4. Python-based options (OmniVoice TTS / GLM-ASR) are detected automatically.
   If you haven't installed Python + `requirements.txt`, they're silently
   skipped — the core chat + SenseVoice STT + Edge TTS stack still works.

After the wizard, a 4-step onboarding guide walks you through: persona, main
chat model, voice stack, companion preferences. You can skip any step and
adjust in settings later.

### Build from source

**Requirements**: Node.js 22+, npm 10+. (macOS: Xcode Command Line Tools for native modules.)

```bash
git clone https://github.com/FanyinLiu/Nexus.git
cd Nexus

# Windows:
setup.bat

# macOS / Linux:
bash scripts/setup.sh

# Dev mode with hot reload
npm run electron:dev

# Production installers
npm run package:win      # → release/Nexus-Setup-<version>.exe
npm run package:mac      # → release/Nexus-<version>.dmg (universal build via electron-builder --arm64 --x64)
npm run package:linux    # → release/Nexus-<version>.AppImage / .deb
```

Production installers end up in `release/`. Signing is off by default (unsigned macOS builds require right-click → Open on first launch to bypass Gatekeeper). Wire in your Apple Developer ID / Windows signing cert via the usual `electron-builder` env vars (`CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`).

**macOS permissions.** On first launch, Nexus will prompt for:
- **Microphone** — required for voice conversation / wake word / STT.
- **Screen Recording** — required for desktop context / OCR. Approve in *System Settings → Privacy & Security → Screen Recording*, then restart Nexus.
- **Automation** — optional; used by Now Playing (Music / Spotify) and foreground-app detection. If denied, the relevant features silently fall back to empty state.

**macOS packaging notes.** The mac `.dmg` ships **without** bundled sherpa models (Windows / Linux installers still bundle them). The in-app setup wizard downloads them to `~/Library/Application Support/Nexus/sherpa-models` on first launch. This keeps the `.dmg` ~250 MB instead of ~550 MB and survives app upgrades (downloaded models persist across updates since they live in userData, not inside the `.app` bundle).

## Configure

After first launch, open **Settings**:

- **Chat** — pick a provider, paste your API key, choose a model. Supports chained failover (primary + N fallbacks).
- **Voice input** — choose STT engine (local SenseVoice or sherpa runs fully offline; cloud options include Zhipu GLM-ASR, Volcengine, OpenAI Whisper, ElevenLabs, Tencent). Set wake word + VAD sensitivity here.
- **Voice output** — pick a TTS (Edge TTS is free and fast; MiniMax / Volcengine / DashScope for natural voices; OmniVoice for on-device). Streaming enabled by default.
- **Memory** — dream cycle cadence, recall depth, embedding model.
- **Autonomy** — emotion / relationship / rhythm tuning, proactive greeting thresholds.
- **Integrations** — Telegram / Discord bot tokens, notification webhook port.

## Supported providers

| Category | Providers |
|----------|-----------|
| **Chat (18+)** | OpenAI · Anthropic · Gemini · DeepSeek · Kimi · Qwen · GLM · Grok · MiniMax · SiliconFlow · OpenRouter · Together · Mistral · Qianfan · Z.ai · BytePlus · NVIDIA · Venice · Ollama · Custom |
| **STT** | GLM-ASR-Nano · Paraformer · SenseVoice · Zhipu GLM-ASR · Volcengine · OpenAI Whisper · ElevenLabs Scribe · Tencent ASR · Custom |
| **TTS** | Edge TTS · MiniMax · Volcengine · DashScope Qwen3-TTS · OmniVoice · OpenAI TTS · ElevenLabs · Custom |
| **Web search** | DuckDuckGo · Bing · Brave · Tavily · Exa · Firecrawl · Gemini Grounding · Perplexity |

## Architecture

| Layer | Technology |
|---|---|
| Runtime | Electron 41 |
| Renderer | React 19 · TypeScript 5.9 · Vite 8 |
| Character | PixiJS 6 · pixi-live2d-display |
| Voice (client) | WebAudio · sherpa-onnx-node · Silero VAD · Web Speech API fallback |
| Voice (server) | Local OmniVoice / GLM-ASR-Nano sidecars over HTTP |
| Local ML | onnxruntime · @huggingface/transformers |
| Storage | localStorage · vault-encrypted API keys · SQLite-style JSON memory store |
| Packaging | electron-builder · electron-updater |

Higher-level layout:

```
src/
├── app/            # Top-level views, controllers, overlays
├── features/       # Voice, chat, autonomy, tools, memory, agent
├── hooks/          # React hooks (voice / chat / reminders)
├── components/     # Reusable UI
├── lib/            # Storage, runtime bridges, plain helpers
└── i18n/           # Locale bundles
electron/
├── main.js         # Entry
├── ipc/            # Typed IPC handlers
├── services/       # TTS / STT / tools / key-vault
└── sherpa*.js      # On-device voice engines
```

## Roadmap

- [ ] **Phase 2-6**: Pipecat-style frame pipeline replacing the monolithic streaming TTS controller. Phase 1 (scaffolding) shipped in v0.2.4.
- [ ] Chat pane per-session bucketing (history preserved in archive, pane opens fresh each launch).
- [ ] First-party Claude Agent SDK integration for plan-mode / native function calling.
- [ ] Auto-update infrastructure via electron-updater + signed binaries.
- [ ] Mobile companion app (voice-only remote for the desktop instance).

## Contributing

Contributions welcome — bug fixes, new providers, UI tweaks, translations, Live2D models, or new autonomous behaviors.

- Open issues for **bugs and proposals** before you start on big features.
- Small PRs preferred. Include repro steps for bug fixes.
- Run `npm run verify:release` (lint + tests + build) before pushing.

## Star history

<a href="https://star-history.com/#FanyinLiu/Nexus&Date">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=FanyinLiu/Nexus&type=Date&theme=dark" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=FanyinLiu/Nexus&type=Date" />
   <img alt="Star History Chart" src="https://api.star-history.com/svg?repos=FanyinLiu/Nexus&type=Date" />
 </picture>
</a>

## License

Released under the [MIT License](LICENSE).
