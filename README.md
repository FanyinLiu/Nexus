<p align="center"><img src="public/banner.png" alt="Nexus" width="720" /></p>

<h1 align="center">Nexus</h1>

<p align="center"><b>A local-first desktop AI companion that remembers you across sessions — including how the conversation ended last time.</b></p>

<p align="center">Persistent emotion, multi-day memory, a 5-level relationship that evolves through trust, vulnerability, playfulness, and intellectual depth — wrapped around a Live2D character with continuous voice chat and autonomous behaviour.</p>

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
  <a href="https://github.com/FanyinLiu/Nexus/releases/latest"><img src="https://img.shields.io/badge/Windows-Download-0078D4?style=for-the-badge&logo=windows&logoColor=white" alt="Windows"></a>
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

- **2026.04.26** — **v0.3.1-beta.3** — bug-fix patch. Live2D no longer broken in packaged builds (CSP `unsafe-eval` for pixi); thinking-mode models (DeepSeek-R1, QwQ, Hunyuan-thinking) now work in multi-turn; TTS no longer wedges voiceState on "speaking"; multimodal images preserved across turns; in-app diagnostic surface upgraded. [Notes](docs/RELEASE-NOTES-v0.3.1-beta.3.md).
- **2026.04.26** — v0.3.1-beta.2 — security IPC hardening on top of beta.1. Closes chat baseUrl SSRF (H5), tightens vault enumeration limit (H4 mitigation), pins local-service probe to loopback (H8). [Notes](docs/RELEASE-NOTES-v0.3.1-beta.2.md).
- **2026.04.25** — v0.3.1-beta.1. Pure installer-size fix on top of stable v0.3.0 (1.2 GB → ~250 MB by excluding unused FP32 model + git-LFS residue). [Notes](docs/RELEASE-NOTES-v0.3.1-beta.1.md).
- **2026.04.25** — **v0.3.0 stable released.** The narrative-companion release. Significance-weighted recall + dream-cycle reflections + callback queue + anniversary milestones; relationship type declaration (friend / mentor / quiet companion); "thinking of you" OS notification; idle-motion silent gestures; smooth 2-hour day↔dusk↔night blend with bolder color contrast; Liquid Glass UI re-skin; richer weather precision. [Release notes](docs/RELEASE-NOTES-v0.3.0.md) · [Install](https://github.com/FanyinLiu/Nexus/releases/tag/v0.3.0).
- **2026.04.24** — v0.3.0-beta.1 / beta.2. Beta line for the relationship + memory work that landed in stable v0.3.0. [Notes beta.1](docs/RELEASE-NOTES-v0.3.0-beta.1.md) · [Notes beta.2](docs/RELEASE-NOTES-v0.3.0-beta.2.md).
- **2026.04.22** — v0.2.9 released. Emotional memory + 5-level relationship baseline; weather + scene overhaul; Character Card v2/v3 import; VTube Studio bridge. [Tag](https://github.com/FanyinLiu/Nexus/releases/tag/v0.2.9)

<details>
<summary>Older releases</summary>

- **2026.04.19** — v0.2.7. Subagent dispatcher; barge-in hardening; render-storm fixes. [Notes](https://github.com/FanyinLiu/Nexus/releases/tag/v0.2.7)
- **2025.04.19** — v0.2.5. Autonomy Engine V2 default-on; voice/TTS reliability pass. [Notes](https://github.com/FanyinLiu/Nexus/releases/tag/v0.2.5)
- **2025.04.16** — v0.2.4. Voice/TTS reliability + Anthropic prompt caching + 20+ bug fixes. [Notes](https://github.com/FanyinLiu/Nexus/releases/tag/v0.2.4)
- **2025.04.15** — Wake-word + VAD rewrite (Plan C): main-process Silero VAD + sherpa-onnx-node, single mic stream.
- **2025.04.14** — TTS intermittency fixes: retry / per-segment events / sender teardown.
- **2025.04.12** — Speech-interrupt architecture: echo-cancelled mic + TTS-aware dynamic threshold.
- **2025.04.10** — Hybrid memory landed: three-tier hot / warm / cold + BM25 + local vector search.
- **2025.04.01** — v0.1 opened. First playable build.

</details>

## Highlights

The first three are the heart of the project. The rest is what keeps the companion practical day-to-day.

- 💝 **Emotional memory + relationship arc.** The companion remembers the *feel* of how you parted, notices absences, and her tone shifts across a 5-level progression (stranger → acquaintance → friend → close friend → intimate). Four named sub-dimensions — trust, vulnerability, playfulness, intellectual — grow from different kinds of interaction. New in v0.3.0: pick a *relationship type* (friend / mentor / quiet companion / open-ended) that biases tone.

- 🧠 **Memory that dreams.** Three-tier hot / warm / cold with hybrid BM25 + vector search. A nightly dream cycle clusters conversations into *narrative threads* + generates 1–3 short reflections about you, plus 0–2 callback memories queued for next conversation. The same memory also feels different in different moods (mood-aware recall).

- 🤖 **Autonomous inner life (V2).** Single LLM decision call per tick, fed a layered snapshot (emotion · relationship · rhythm · desktop · recent chat) and filtered through a per-persona guardrail. No formulaic template output — she writes in her own voice, can choose to stay silent, and can dispatch a background research helper when a task would actually benefit from it.

- 🎙️ **Always-on wake word + continuous voice chat.** sherpa-onnx keyword spotter beside a main-process Silero VAD over one shared mic stream. Multi-engine STT/TTS with failover, sentence-immediate streaming TTS (first audio at the first comma), 6-second first-audio watchdog, echo-cancelled self-interrupt so the pet never wakes itself up.

- 🌤️ **Living scene.** 14 intensity-graded weather states, continuous 24h sunlight filter, 15 AI-generated day / dusk / night scene variants. Atmospheric depth, not a static wallpaper.

- 🎭 **Character Card + VTube Studio bridge.** Import Character Card v2/v3 (chub.ai / characterhub compatible). Drive an external Live2D model via the VTube Studio plugin API while keeping Nexus's memory / autonomy stack.

- 🧰 **Subagent dispatcher.** The companion can fire a bounded research loop behind the scenes — web search or MCP tools — and weave the summary into its next reply. Capacity + daily budget enforced, with cancel + per-task progress + history.

- 🔧 **Built-in tools.** Web search, weather, reminders. Works with native function calling **and** a prompt-mode fallback for models that don't support `tools`.

- 🖥️ **Desktop awareness.** Foreground window title, clipboard, and (optionally) screen OCR. Context triggers let her react to what you're actually doing.

- 🔔 **Notification bridge.** Local webhook server + RSS polling — push external notifications into the companion conversation.

- 💬 **Phone reachable.** Discord and Telegram gateways with per-chat routing. Talk to your companion from your phone, have her respond in her own voice.

- 🌐 **Multilingual UI.** Simplified Chinese, Traditional Chinese, English, Japanese, Korean.

- 🔄 **Provider failover.** Chain multiple LLM / STT / TTS providers. When one goes down, Nexus switches without tearing the conversation down.

- 💰 **Cost-aware.** Built-in budget metering + Anthropic prompt caching on the system + tools prefix (30-50% input token reduction on long sessions).

- 🛠️ **Diagnostics built in.** JSONL log export, emotion + relationship timeline charts, 30-day cost history with per-source / per-model breakdown — all in Settings → Console.

## What's new in v0.3.0

> **Stable.** Cumulative changelog from `v0.2.9`: 100+ commits, ~12,000 LOC, +361
> tests. Backward-compatible — pre-v0.3.0 stored state migrates transparently.
> Full notes: [docs/RELEASE-NOTES-v0.3.0.md](docs/RELEASE-NOTES-v0.3.0.md).

| Theme | What landed |
|---|---|
| **🧠 Memory does work** | Significance-weighted recall, dream-cycle reflections (1–3 short observations about you), callback queue (gently surfaces a past memory in the next chat), anniversary milestones at day-30 / 100 / 365. |
| **💝 Relationship has shape** | Mood-aware recall (3 modes), 5-level milestones with first-time fire, four sub-dimensions, richer reunion framing. |
| **🤝 Relationship has type** | Pick *open-ended* / *friend* / *mentor* / *quiet companion* in onboarding or settings — biases tone without overriding `SOUL.md`. |
| **💭 "Thinking of you"** | OS-level notification fires after a long silence, phrased to match your relationship type. Quiet hours 23–08 hard-gated. |
| **🎬 Alive in the corner** | Idle-motion silent gestures (4th autonomy V2 action), dynamic decision cadence, first-impression curious question on early replies. |
| **🌅 Smooth scene** | 2-hour day↔dusk↔night blend windows with smoothstep easing; bolder color contrast — dawn pink, golden hour deep amber, deep night cool desat. |
| **🪟 Liquid Glass UI** | Violet accent re-skin, cleaned-up toolbar, time-aware emoji greeting, panel size + position now persist across launches. |
| **🌤️ Better weather** | Hourly forecast, feels-like + humidity, day-after-tomorrow lookahead. |
| **🧹 Polish** | i18n.ts split (1842 → 588 lines), shared Settings field components, regex compile cache, async-lock dedup, build-size trim (~30–60 MB). |

<details>
<summary>Earlier beta line (folded into this stable)</summary>

The beta line built the foundation that this stable polishes:

- **v0.3.0-beta.1** — Three independent depth axes on the relationship system: mood-aware memory recall (VAD projection + empathy/repair/reinforce modes), one-shot level-up instructions, four sub-dimensions. [Notes](docs/RELEASE-NOTES-v0.3.0-beta.1.md)
- **v0.3.0-beta.2** — Stability + retention pass: significance-weighted recall, dream-cycle reflections, callback queue, anniversary milestones, idle motion, dynamic cadence, Liquid Glass UI, weather precision, tray + dock icons, 7 security fixes. [Notes](docs/RELEASE-NOTES-v0.3.0-beta.2.md)

</details>

| Axis | What it does |
|---|---|
| **💝 Emotional resonance recall** | The same memory feels different in different moods. Three regulatory modes (match / empathy / repair) decide whether to mirror the user's current mood or surface something to help reframe. |
| **🎯 Relationship milestones + reunion** | Crossing the 10 / 30 / 55 / 80 score thresholds fires a one-shot, understated instruction the turn you cross it. Reunions reference your last topic + how the conversation ended. |
| **🌳 Four sub-dimensions** | The flat 0–100 score now decomposes into trust / vulnerability / playfulness / intellectual, each growing from a different kind of interaction and feeding specific prompt guidance. |

<details>
<summary>Full breakdown of v0.3.0-beta.1 changes</summary>

### 💝 Emotional resonance recall

Current mood influences which memories surface. VAD (valence / arousal) projection of the 4D emotion state, with **three regulatory modes**:

- **Reinforce** (default) — match current mood + salience
- **Empathy** (triggered by "陪陪我" / "listen to me" + elevated concern) — match on tone *and* emotional weight, surface moments where she was genuinely there
- **Repair** (triggered by "算了 换个话题" / "move on" or sustained severe distress) — surface distant, positive memories to help reframe

A priming ring buffer (last-3 recall centroids) prevents whiplash between unrelated moods. Intensity gating means neutral-mood turns skip the feature entirely.

### 🎯 Relationship milestones + richer reunion

Crossing the 10 / 30 / 55 / 80 score thresholds fires a **one-shot, understated instruction** the turn you cross it — telling the model to *perform* the shift (use a name, tease gently, be quietly vulnerable) rather than *announce* it. No badges, no pop-ups.

Reunions now use absence duration + last-session emotion + stored topic: a 2-day gap at friend+ gets a "weave it back in naturally" directive; a 10-day gap at close_friend+ with high prior concern prompts a gentle "did it get better?" check-in.

### 🌳 Four sub-dimensions under the flat score

The existing 0–100 score is now a blend of four named dimensions, each growing from a different kind of interaction:

| Dimension | Grows from |
|---|---|
| **Trust** | Bringing problems to her, accepting her help |
| **Vulnerability** | Sharing feelings, personal history, expressed sadness (first-person only) |
| **Playfulness** | Jokes, laughter, playful teasing |
| **Intellectual** | Deep questions, debate, mutual teaching |

Diminishing returns prevent runaway growth. A slow daily drift toward a low baseline means dimensions erode gently with prolonged absence. Each dimension, when notably high or low, feeds **specific** prompt guidance — high `trust` tells the companion to honor that reliance, low `playfulness` tells her not to force humor.

### 🔩 Under the hood

- **Electron 36 → 41** (Node 24 ABI, macOS 12 minimum).
- **93 new tests** lift the suite from 486 to 665. Five previously untested modules now covered — plugin message bus, encryption, MCP + plugin host, window manager geometry, minecraft gateway.
- **Main-process audit** from a five-agent review: CSP script-src tightened (`unsafe-eval` removed), vault file written with 0o600, child-process PID null-guard, timer-leak cleanup across `mcpHost` / `realtimeVoice` / `windowManager.panelBlur`.
- Shared `driftToward()` + `classifyByPatterns()` helpers in `src/lib/common.ts` deduplicate decay-math and regex-classification kernels across emotion + relationship code paths.
- O(n²) overlap-search in `chatRuntime.trimRepeatedStreamingDelta` now capped at 200 chars; `useChat` signature hash replaces per-turn `JSON.stringify(messages)`; `SpeechOutputSection` extracts a shared `TuningSlider` component (-100 lines of render duplication).

</details>

---

<details>
<summary>What's new in v0.2.9</summary>

The headline of v0.2.9 was the **emotional memory + 5-level relationship baseline** that v0.3.0-beta.1 now extends.

- **Emotional memory + relationship arc** — companion remembers the *feel* of how you parted; 5-level progression (stranger → acquaintance → friend → close friend → intimate); per-persona `memory.md` files survive switches.
- **Weather + scene overhaul** — 14 intensity-graded weather states, continuous 24h sunlight filter, 15 AI-generated day/dusk/night scene variants.
- **Character Card v2/v3 import + VTube Studio bridge** — chub.ai / characterhub compatible; drive external Live2D models via the VTS plugin API.
- **Pet polish** — inline `[expr:name]` mid-sentence expression tags; 13 fine-grained mood states; per-model weighted idle fidgets; mouse-drag resize.
- **Render / sync fixes** — cross-window save loop, runtime-state self-feed render storm, TTS-timeout cascade, wake-word transient errors all fixed.
- **Internal** — Autonomy V1 deleted; CI caches sherpa models + electron-builder; sherpa bundled into Mac/Linux installers.

Full notes on the [v0.2.9 release page](https://github.com/FanyinLiu/Nexus/releases/tag/v0.2.9).

</details>

## Install

### Pre-built installer (recommended)

Grab the latest installer from the [releases page](https://github.com/FanyinLiu/Nexus/releases/latest):

| Platform | Asset |
|---|---|
| Windows | `Nexus-Setup-<version>.exe` (NSIS, unsigned — click *More info → Run anyway* on first launch) |
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

## Community

Nexus is a solo-maintained project, which means issues and PRs move faster when the triage channel matches the question:

- 🐛 **Found a bug?** → [Bug Report](https://github.com/FanyinLiu/Nexus/issues/new?template=bug_report.yml)
- 💡 **Small, well-scoped feature idea?** → [Feature Request](https://github.com/FanyinLiu/Nexus/issues/new?template=feature_request.yml)
- 🧠 **Bigger or open-ended idea?** → [Ideas Discussion](https://github.com/FanyinLiu/Nexus/discussions/categories/ideas) first, so others can weigh in before it becomes a tracked task
- ❓ **Stuck on setup or usage?** → [Q&A](https://github.com/FanyinLiu/Nexus/discussions/categories/q-a)
- 🎨 **Want to show how you use Nexus?** → [Show and tell](https://github.com/FanyinLiu/Nexus/discussions/categories/show-and-tell)
- 💬 **Just want to chat?** → [General](https://github.com/FanyinLiu/Nexus/discussions/categories/general)
- 📣 **Release notes and roadmap updates** → [Announcements](https://github.com/FanyinLiu/Nexus/discussions/categories/announcements)

## Contributing

Contributions welcome — bug fixes, new providers, UI tweaks, translations, Live2D models, or new autonomous behaviors. Even a one-sentence issue or a typo-fix PR moves things forward.

Quick start:

- Read the full [**Contributing Guide**](CONTRIBUTING.md) for development setup, project layout, code style, and PR workflow.
- Use the [issue templates](https://github.com/FanyinLiu/Nexus/issues/new/choose) for bugs and feature requests — they keep reports consistent enough to triage quickly.
- Run `npm run verify:release` (lint + tests + build) before pushing — this is exactly what CI runs.
- Follow [Conventional Commits](https://www.conventionalcommits.org/) for messages: `feat:`, `fix:`, `docs:`, `refactor:`, etc.
- One logical concern per PR. Split unrelated fixes into separate PRs.

All participation is governed by the [Code of Conduct](CODE_OF_CONDUCT.md) — short version: **be kind, assume good faith, focus on the work**.

### Security issues

If you find a security vulnerability, please **do not** open a public issue. Open a [private security advisory](https://github.com/FanyinLiu/Nexus/security/advisories/new) instead.

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
