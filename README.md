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
  <b>English</b> · <a href="docs/README.zh-CN.md">简体中文</a> · <a href="docs/README.zh-TW.md">繁體中文</a> · <a href="docs/README.ja.md">日本語</a> · <a href="docs/README.ko.md">한국어</a>
</p>

<p align="center">
  <a href="https://github.com/FanyinLiu/Nexus/releases/latest/download/Nexus-Setup-0.2.9.exe"><img src="https://img.shields.io/badge/Windows-Download-0078D4?style=for-the-badge&logo=windows&logoColor=white" alt="Windows"></a>
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

- **2026.04.22** — **v0.2.9 released.** Emotional memory, 5-level relationship evolution (stranger → intimate), absence-aware reunions, cross-session memory persistence, weather & scene system overhaul (14 weather states, AI-generated scenes, continuous sunlight), Character Card v2/v3 import, VTube Studio WebSocket bridge, full 5-locale i18n, pet system enhancements (inline expressions, tap reactions, idle fidgets, drag-resize). [Changelog →](https://github.com/FanyinLiu/Nexus/releases/tag/v0.2.9)
- **2026.04.19** — **v0.2.7 released.** Subagent dispatcher lands — the companion can now spawn a background research helper from autonomy ticks or chat tool calls, surfaced in the chat panel as a live status strip. Barge-in monitor hardened: any TTS reply (voice *or* typed-text) is interruptible, and the wake-word listener's mic is reused to avoid macOS contention. Fixes a render-storm bug that made long STT utterances stall the second turn, and the matching cross-window sync bug that made voice messages invisible to an open chat panel. [Changelog →](https://github.com/FanyinLiu/Nexus/releases/tag/v0.2.7)
- **2025.04.19** — v0.2.5 released. Autonomy Engine V2 now default-on (LLM-driven decision + persona guardrail replacing the hand-written rule tree). Chat pane opens fresh each launch with past sessions browsable under Settings → 聊天记录. Voice/TTS reliability pass. New `system-dark` theme preset. [Changelog →](https://github.com/FanyinLiu/Nexus/releases/tag/v0.2.5)
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

- 🤖 **Autonomous inner life (V2).** Single LLM decision call per tick, fed a layered snapshot (emotion · relationship · rhythm · desktop · recent chat) and filtered through a per-persona guardrail. No more formulaic template output — it writes in its own voice, can choose to stay silent, and can dispatch a background research helper when a task would benefit from it.

- 🧰 **Subagent dispatcher.** The companion can fire a bounded research loop behind the scenes — web search or MCP tools — and weave the summary into its next reply. Capacity + daily budget enforced; opt-in via Settings.

- 🔧 **Built-in tools.** Web search, weather, reminders. Works with native function calling **and** a prompt-mode fallback for models that don't support `tools`.

- 🔄 **Provider failover.** Chain multiple LLM / STT / TTS providers. When one goes down, Nexus switches to the next without tearing the conversation down.

- 🖥️ **Desktop awareness.** Foreground window title, clipboard, and (optionally) screen OCR. Context triggers let it react to what you're actually doing.

- 🔔 **Notification bridge.** Local webhook server + RSS polling — push external notifications into the companion conversation.

- 💬 **Phone reachable.** Discord and Telegram gateways with per-chat routing. Talk to your companion from your phone, have it respond in its own voice.

- 🌐 **Multilingual UI.** Simplified Chinese, Traditional Chinese, English, Japanese, Korean.

- 💰 **Cost-aware.** Built-in budget metering + Anthropic prompt caching on the system + tools prefix (30-50% input token reduction on long sessions).

## What's new in v0.2.9

> Emotional memory and relationship evolution are the headline — the
> companion now tracks how your relationship develops over time and
> remembers how each conversation felt. The weather & scene system was
> rebuilt from scratch with 14 weather states and AI-generated scenes.
> Character Card import, VTube Studio bridge, and full 5-locale i18n
> round out the release. This section is refreshed each release — older
> notes live in [Releases](https://github.com/FanyinLiu/Nexus/releases).

### 🧠 Emotional memory & relationship evolution — headline

The companion now carries emotional context across sessions. If you
parted on a warm note, it picks up warmly; if you were tired, it checks
in. Five relationship stages — stranger → acquaintance → friend → close
friend → intimate — shape the companion's tone, language style, and
behavioral boundaries. The progression is implicit, driven by
accumulated interaction, not a visible meter.

Absence awareness: the companion notices when you've been away. Short
gaps get a gentle welcome-back; longer absences trigger genuine curiosity
("where have you been?"). Conversation memories now persist to per-persona
`memory.md` files so nothing is lost between sessions.

### 🌦️ Weather & scene system overhaul

The old weather widget was replaced with a full atmospheric system:

- **14 intensity-graded weather states** with full-scene visual effects —
  sky tints, dense particle layers, glowing rain and snow.
- **Continuous sunlight system** with brightness / saturation / hue
  filters. Real night, fine daytime gradations — not just "day" and
  "night."
- **15 AI-generated anime scene variants** (5 locations × day / dusk /
  night), hand-prompted for visual consistency.
- **14-state pet time preview** with a lock-to-time-of-day setting so
  you can preview how each weather looks.
- **Multi-language weather location parsing** with Nominatim geocoding —
  type your city in any language.

### 📇 Character Card import

Import Character Card v2 / v3 format (PNG-embedded + JSON) — compatible
with cards from chub.ai, characterhub, and other community sources.
Drop a `.png` card file in Settings → Character and the persona is
populated automatically.

### 🎭 VTube Studio bridge

WebSocket bridge for driving external Live2D models via VTube Studio.
Expression and motion sync from the companion's emotional state — so
your VTS model reacts in real time to how the companion feels.

### 🌐 Full i18n

All UI surfaces now carry full translations across 5 locales (EN /
ZH-CN / ZH-TW / JA / KO): settings, chat, onboarding, voice stack,
system prompts, error messages, and data registries. Language switcher
with globe icon + popover in settings.

### 🐾 Pet system enhancements

- **Inline expression overrides**: the companion can write `[expr:name]`
  tags in its reply to trigger specific Live2D expressions mid-sentence.
- **Expanded tap-zone reaction pool** — more varied responses when you
  poke the character.
- **Per-model weighted idle fidgets** — idle animations feel different
  per character, weighted by model metadata.
- **Mouse-drag resize** on the pet character window.
- **13 fine-grained pet mood states** feeding into expression selection.

### 🔧 Other improvements & fixes

- Lorebook semantic hybrid retrieval on top of keyword matching.
- User-configurable regex transforms on LLM replies.
- Local voice model health strip on the onboarding voice step.
- Sherpa models bundled into Mac + Linux installers.
- Fixed cross-window BroadcastChannel sync save loop and message clobbering.
- Fixed runtime-state bridge self-feeding render storm.
- Fixed TTS-timeout render storm.
- Fixed wakeword transient device errors treated as permanent.
- Deleted Autonomy V1 code (Phase 6 cleanup).

## Install

### Pre-built installer (recommended)

Grab the latest installer from the [releases page](https://github.com/FanyinLiu/Nexus/releases/latest):

| Platform | Asset |
|---|---|
| Windows | `Nexus-Setup-0.2.9.exe` (NSIS, unsigned — click *More info → Run anyway* on first launch) |
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

## Recommended model setup

> These recommendations target **English-speaking users**. For other languages see [简体中文](docs/README.zh-CN.md) · [繁體中文](docs/README.zh-TW.md) · [日本語](docs/README.ja.md) · [한국어](docs/README.ko.md).

### Chat model (LLM)

| Use case | Provider | Model | Notes |
|----------|----------|-------|-------|
| **Daily companion (top pick)** | Anthropic | `claude-sonnet-4-6` | Best overall quality, stable tool calling, natural English |
| **Daily companion (budget)** | DeepSeek | `deepseek-chat` | Extremely cheap, good multilingual, great for long conversations |
| **Budget friendly** | OpenAI | `gpt-5.4-mini` | Fast and cheap, solid English, good for high-frequency chat |
| **Free tier** | Google Gemini | `gemini-2.5-flash` | Generous free quota, good for getting started |
| **Deep reasoning** | DeepSeek | `deepseek-reasoner` | For complex reasoning, math, and code |

### Speech-to-text (STT)

| Use case | Provider | Model | Notes |
|----------|----------|-------|-------|
| **Best accuracy** | OpenAI | `whisper-large-v3` | Industry standard, highest English recognition accuracy |
| **Budget friendly** | OpenAI | `gpt-4o-mini-transcribe` | Multilingual, works with existing OpenAI key |
| **High-accuracy cloud** | ElevenLabs Scribe | `scribe_v1` | 99 languages, excellent punctuation and speaker detection |
| **Local streaming** | Paraformer | `paraformer-trilingual` | Real-time transcription while speaking, low latency |
| **Local fast** | SenseVoice | `sensevoice-zh-en` | 15× faster than Whisper, offline |

### Text-to-speech (TTS)

| Use case | Provider | Voice | Notes |
|----------|----------|-------|-------|
| **Free (recommended)** | Edge TTS | Jenny (`en-US-JennyNeural`) | Microsoft free, warm American English female voice, no API key |
| **Free (male)** | Edge TTS | Guy (`en-US-GuyNeural`) | Calm American English male voice, free |
| **Best quality** | ElevenLabs | Custom `voice_id` | World-class speech synthesis, voice cloning supported |
| **Cloud general** | OpenAI TTS | `nova` / `alloy` | Works with existing OpenAI key, `gpt-4o-mini-tts` model |
| **Local offline** | OmniVoice | Built-in voices | Fully offline, local port 8000, runs on RTX 3060 |

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

### Planned

- [ ] **Screen-aware proactive conversation** — periodically read screen context (foreground app, visible text) and initiate conversation about what the user is doing, not just respond when spoken to.
- [ ] **Decision / Roleplay / Agent three-layer separation** — split intent classification (fast) from roleplay (persona-pure) from background agent tasks. Roleplay never sees tool metadata; agent results are "announced" by the character in its own voice.
- [ ] **Character diary & autonomous timeline** — the companion auto-generates a first-person diary entry each day summarizing what happened; optionally posts "moments" to a browsable feed, creating a sense of independent life.
- [ ] **Daily schedule & activity states** — the companion follows routines (work / eat / sleep / commute) that affect availability, tone, and energy. Late-night conversations feel different from morning ones.
- [ ] **Mini mode / dock-edge hide** — drag the pet to the screen edge and it auto-hides with a peek-on-hover animation. "Always present, never intrusive."
- [ ] **Webcam awareness** — use MediaPipe face mesh to detect fatigue signals (yawning, eye closure, frowning) and inject detected state into the companion's context so it can proactively react.

### Ongoing

- [ ] Pipecat-style frame pipeline replacing the monolithic streaming TTS controller (Phase 2-6; Phase 1 shipped in v0.2.4).
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
