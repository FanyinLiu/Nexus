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
  <a href="https://github.com/FanyinLiu/Nexus/releases/latest/download/Nexus-Setup-0.2.7.exe"><img src="https://img.shields.io/badge/Windows-Download-0078D4?style=for-the-badge&logo=windows&logoColor=white" alt="Windows"></a>
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

- **2026.04.19** — **v0.2.7 released.** Subagent dispatcher lands — the companion can now spawn a background research helper from autonomy ticks or chat tool calls, surfaced in the chat panel as a live status strip. Barge-in monitor hardened: any TTS reply (voice *or* typed-text) is interruptible, and the wake-word listener's mic is reused to avoid macOS contention. Fixes a render-storm bug that made long STT utterances stall the second turn, and the matching cross-window sync bug that made voice messages invisible to an open chat panel. [What's new in v0.2.7](#whats-new-in-v027) below.
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

- 🤖 **Autonomous inner life (V2).** Single LLM decision call per tick, fed a layered snapshot (emotion · relationship · rhythm · desktop · recent chat) and filtered through a per-persona guardrail. No more formulaic template output — it writes in its own voice, can choose to stay silent, and — as of v0.2.7 — can dispatch a background research helper when a task would actually benefit from it.

- 🧰 **Subagent dispatcher (v0.2.7).** The companion can fire a bounded research loop behind the scenes — web search or MCP tools — and weave the summary into its next reply. Capacity + daily budget enforced; opt-in via Settings. See [What's new in v0.2.7](#whats-new-in-v027).

- 🔧 **Built-in tools.** Web search, weather, reminders. Works with native function calling **and** a prompt-mode fallback for models that don't support `tools`.

- 🔄 **Provider failover.** Chain multiple LLM / STT / TTS providers. When one goes down, Nexus switches to the next without tearing the conversation down.

- 🖥️ **Desktop awareness.** Foreground window title, clipboard, and (optionally) screen OCR. Context triggers let it react to what you're actually doing.

- 🔔 **Notification bridge.** Local webhook server + RSS polling — push external notifications into the companion conversation.

- 💬 **Phone reachable.** Discord and Telegram gateways with per-chat routing. Talk to your companion from your phone, have it respond in its own voice.

- 🌐 **Multilingual UI.** Simplified Chinese, Traditional Chinese, English, Japanese, Korean.

- 💰 **Cost-aware.** Built-in budget metering + Anthropic prompt caching on the system + tools prefix (30-50% input token reduction on long sessions).

## What's new in v0.2.7

> Subagent dispatcher is the headline; barge-in got a hardening pass so
> it actually works on every TTS reply; and a render-storm bug that made
> voice turns invisible to an open chat panel is fixed. This section is
> refreshed each release — older notes live in
> [Releases](https://github.com/FanyinLiu/Nexus/releases).

### 🧰 Subagent dispatcher — headline

> **TL;DR** — The companion can now spawn a bounded background research
> agent when a task would genuinely benefit from it (web lookup,
> doc-reading, fact checks). Two entry points: the autonomy engine can
> choose `spawn` in place of `speak`, or the chat LLM can call the
> `spawn_subagent` tool mid-turn. Status is surfaced as a live chip above
> the chat message list; the summary is woven into the companion's
> reply. Default off — opt-in per-user.

Turning on:

```
Settings → Subagents → Enable
  maxConcurrent:    1–3 (hard cap 3)
  perTaskBudgetUsd: soft cap per task
  dailyBudgetUsd:   soft cap across all tasks today
  modelOverride:    optional — point research at a cheaper tier
```

Three-tier model fallback: `subagentSettings.modelOverride →
autonomyModelV2 → settings.model`. So you can route research through a
small fast model (Haiku / Flash / a cheap OpenRouter entry) while the
main chat stays on whatever you've configured.

Decision engine integration: the autonomy prompt now sees live
`subagentAvailability` (enabled + current capacity + remaining daily
budget) on every tick, and the `spawn` action is only advertised when
the gate is actually open. When the LLM chooses `spawn`, the
orchestrator can optionally speak a short announcement ("let me look
that up") via the usual TTS path, **concurrently** with starting the
research loop — no serial delay before work begins.

Chat-tool integration: when subagents are enabled, `spawn_subagent` is
added to the LLM's tool list. The tool call blocks for the research
turn (usually 10-30s) and returns a summary, which the main LLM weaves
into its reply. Users see the live strip the whole time so the wait
isn't silent.

UI: `SubagentTaskStrip` renders queued / running tasks as a thin
glassmorphism chip above the chat list, with a pulsing indicator dot.
Completed tasks don't appear there — their summaries arrive as normal
chat bubbles. Failed tasks stay visible for 60 s so the reason is
legible.

Source tour: `src/features/autonomy/subagents/`
(`subagentRuntime.ts` state machine, `subagentDispatcher.ts` LLM loop,
`spawnSubagentTool.ts` + `dispatcherRegistry.ts` for the chat bridge,
`src/components/SubagentTaskStrip.tsx` UI). Six unit tests cover the
runtime state machine (admission, budget, concurrency cap, onChange).

### 🎙️ Barge-in anywhere

Before: the speech-interrupt monitor only armed when the current turn
originated from a continuous voice session. Typed-text replies played
uninterruptibly, which felt wrong — if you can speak to the companion,
you should also be able to speak *over* it.

- Monitor arms on every TTS playback once `voiceInterruptionEnabled` is
  on, not only on voice-originated turns.
- When the wake-word listener is already running, the monitor now
  *reuses* its mic frames via `subscribeMicFrames` instead of opening a
  second `getUserMedia`. macOS occasionally serializes two streams on
  the default input and produced sporadic monitor silence; this path
  is now the default whenever KWS is listening.
- After a successful barge-in, non-wake-word modes force a VAD restart
  so your continuation is captured without needing to re-wake. Wake-word
  + always-on KWS modes keep the old behaviour (let KWS reacquire —
  forcing a second VAD would contend with the listener).

### 🐛 Render-storm + cross-window sync

The headline bug was subtle and came in two layers.

**Render storm**: every parent render handed `useChat` / `useMemory` /
`usePetBehavior` / `useVoice` consumers a fresh object literal.
Downstream memos (`chatWithAutonomy`, `petView`, `overlays`,
`panelView`) invalidated on every render, cascading into children
whose effects wrote state back — the classic "Maximum update depth
exceeded" loop. Observed as log spam the moment a chat turn settled;
the second STT utterance would then stall because the renderer was
starved and VAD's `speech_end` callback never drained. Fixed by
memoizing the return bag in each hook and — in `useVoice` — explicitly
excluding `lifecycle.*` / `bindings.*` / `testEntries.*` from the memo
deps (those factories are reconstructed every render but route through
stable refs, so old captures still work).

**Cross-window sync**: the pet window and chat panel are separate
Electron renderers with separate React state. They sync chat through
a `storage` event on `CHAT_STORAGE_KEY` (`nexus:chat`). But `useChat`'s
save effect was only calling `upsertChatSession`, which writes
`CHAT_SESSIONS_STORAGE_KEY` (`nexus:chat-sessions`) — `nexus:chat` was
never written by anyone. Voice turns, which happen inside the pet
window, never became visible to an open chat panel. Now
`saveChatMessages(messages)` is called alongside `upsertChatSession`
so the key the panel listens on actually updates.

### 🔧 Startup fixes

- **Silero VAD now actually runs.** `browserVad.ts` points
  `onnxWASMBasePath` at `public/vendor/ort/`, but that folder never
  existed — `setup-vendor.mjs` only copied Live2D assets. Without the
  ORT runtime, `vad-web` fell back to a CJS `require()` that Vite's
  ESM dev server can't service, and the whole Silero path failed with
  a "legacy recording" fallback. `setup-vendor.mjs` now copies the
  four wasm + mjs bundles vad-web needs from `node_modules` on
  postinstall.
- **`mcp:sync-servers` handler registers eagerly.** The handler was
  deferred-loaded ~1.5 s after app-ready, but `useMcpServerSync` fires
  on first render and raced the registration. `sherpaIpc` /
  `notificationIpc` had the same issue earlier; `mcpIpc` now joins
  them on the eager path.

## Install

### Pre-built installer (recommended)

Grab the latest installer from the [releases page](https://github.com/FanyinLiu/Nexus/releases/latest):

| Platform | Asset |
|---|---|
| Windows | `Nexus-Setup-0.2.7.exe` (NSIS, unsigned — click *More info → Run anyway* on first launch) |
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
