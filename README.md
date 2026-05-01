<p align="center"><img src="public/banner.png" alt="Nexus" width="720" /></p>

<h1 align="center">Nexus</h1>

<p align="center"><b>A local-first desktop AI companion with memory, voice, Live2D, and long-running relationship state.</b></p>

<p align="center">Nexus is built around continuity: the companion remembers what mattered, notices how the relationship changes, speaks through a desktop pet, and can help with small background tasks. Model calls use the provider you choose; memory, voice orchestration, tools, and safety state stay on your machine.</p>

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

> **Current release:** v0.3.1 stable (2026-04-28). Nexus is usable today, but still a fast-moving solo project. Packaging, optional local voice models, and provider setup may still need a little manual care.

---

## Quick start

| Need | Go here |
|---|---|
| Install the app | [Download the latest release](https://github.com/FanyinLiu/Nexus/releases/latest) |
| Understand the product | [Why Nexus](#why-nexus) · [Core features](#core-features) |
| Build from source | [Build from source](#build-from-source) |
| Configure providers | [Configure](#configure) · [Supported providers](#supported-providers) |
| Check safety/privacy behavior | [Safety & support](#safety--support) |

## Why Nexus

Most AI companions compete on model quality, voice realism, or engagement loops. Nexus is aimed at a different problem: **what should a long-running companion remember, and how should that history change its presence over time?**

The answer is not one feature. It is a set of small rituals that accumulate: a callback that arrives at the right moment, a weekly letter that names what actually happened, a memory that comes back with the right emotional weight, a companion that can stay silent when silence is better.

Concretely, Nexus is built around seven rituals:

1. **Significance-weighted memory** — not everything is remembered equally; the companion's recall is tilted toward what mattered.
2. **Nightly dream cycle** — overnight, conversations cluster into narrative threads and 1–3 short reflections about you. The next morning's "who you are" is updated, not reset.
3. **Callback queue** — a memory queued from yesterday quietly resurfaces when today's conversation has room for it.
4. **Anniversary callbacks** — day-30 / 100 / 365 milestones; "on this day" matches against past memory dates so a year later, that one thing you said comes back gently.
5. **Morning + evening bracket** — a soft check-in at the start of the day and a callback to it that night. Optional, never pushy.
6. **Sunday letter** — every week, she writes you a short letter naming what the week actually was. Not a digest. A letter.
7. **Background errand** — you can hand her a task during the day; she works on it overnight while you sleep, and delivers the result at the morning bracket.

Around them sit the practical systems: 5-locale UI, 18+ LLM providers, multi-engine STT/TTS with failover, Live2D, VTube Studio bridge, MCP tools, local webhook/RSS notifications, and hardened Electron IPC boundaries. Those systems matter because they keep the companion usable day after day; the product is what the rituals add up to over months of use.

This is also a single-author project, on purpose. The trade-off is real: slower than a funded team, no roadmap pressure, no quarterly OKRs. The upside is that every ritual is hand-shaped — the kind of attention you can't get from a startup that needs to grow 30% MoM. **v0.3.1 just landed the depth bet**: a long-form affect-dynamics layer (your baseline mood, how it moved this month, where you and she synchronized) grounded in published affect science — Russell's circumplex, Kuppens on emotional inertia, Gottman repair — all running silently behind her tone. The current phase is polish, not new ground; v0.4 is not in active development. Read on if that sounds right; otherwise the [release notes](docs/RELEASE-NOTES-v0.3.1.md) are an honest map of what's actually shipped.

## Local-first, by default

Every voice frame, every memory entry, every tool call runs on your own machine. The LLM calls themselves are the only thing that leaves your computer, and you pick the provider. You can mix and match 18+ chat providers, swap STT / TTS engines, even run fully offline with a local model + local ASR + local TTS. Nothing about Nexus assumes you trust a cloud — and there is no cloud account to make.

## News

> **v0.3.1 stable is out.** The release brings affect-dynamics guidance, security hardening, dependency cleanup, and a larger release gate. The next phase is polish and stabilization rather than a new feature push.

| Date | Release | Notes |
|---|---|---|
| 2026-04-28 | **v0.3.1 stable** | Emotion-line guidance, IPC hardening, 30+ static fixes, CVE cleanup. [Release notes](docs/RELEASE-NOTES-v0.3.1.md) · [Install](https://github.com/FanyinLiu/Nexus/releases/tag/v0.3.1) |
| 2026-04-25 | **v0.3.0 stable** | Narrative companion foundation: dream cycle, callback queue, anniversary milestones, relationship type, scene/UI refresh. [Release notes](docs/RELEASE-NOTES-v0.3.0.md) |
| 2026-04-22 | v0.2.9 | Emotional memory baseline, Character Card import, VTube Studio bridge, weather/scene overhaul. [Tag](https://github.com/FanyinLiu/Nexus/releases/tag/v0.2.9) |

<details>
<summary>Recent beta and older release notes</summary>

- **2026.04.27** — v0.3.1-beta.5 — emotion line + narrative artefacts. [Notes](docs/RELEASE-NOTES-v0.3.1-beta.5.md)
- **2026.04.26** — v0.3.1-beta.4 — memory-store race fix, MCP/workspace approvals, ja/ko strings, humanized errors. [Notes](docs/RELEASE-NOTES-v0.3.1-beta.4.md)
- **2026.04.26** — v0.3.1-beta.3 — Live2D packaged-build fix, thinking-mode multi-turn, TTS state fixes. [Notes](docs/RELEASE-NOTES-v0.3.1-beta.3.md)
- **2026.04.26** — v0.3.1-beta.2 — chat baseUrl SSRF fix, vault enumeration mitigation, loopback probe hardening. [Notes](docs/RELEASE-NOTES-v0.3.1-beta.2.md)
- **2026.04.25** — v0.3.1-beta.1 — installer size cut from ~1.2 GB to ~250 MB. [Notes](docs/RELEASE-NOTES-v0.3.1-beta.1.md)
- **2026.04.24** — v0.3.0-beta.1 / beta.2 — beta line for the relationship + memory work. [Notes beta.1](docs/RELEASE-NOTES-v0.3.0-beta.1.md) · [Notes beta.2](docs/RELEASE-NOTES-v0.3.0-beta.2.md)

- **2026.04.19** — v0.2.7. Barge-in hardening; render-storm fixes. [Notes](https://github.com/FanyinLiu/Nexus/releases/tag/v0.2.7)
- **2025.04.19** — v0.2.5. Autonomy Engine V2 default-on; voice/TTS reliability pass. [Notes](https://github.com/FanyinLiu/Nexus/releases/tag/v0.2.5)
- **2025.04.16** — v0.2.4. Voice/TTS reliability + Anthropic prompt caching + 20+ bug fixes. [Notes](https://github.com/FanyinLiu/Nexus/releases/tag/v0.2.4)
- **2025.04.15** — Wake-word + VAD rewrite (Plan C): main-process Silero VAD + sherpa-onnx-node, single mic stream.
- **2025.04.14** — TTS intermittency fixes: retry / per-segment events / sender teardown.
- **2025.04.12** — Speech-interrupt architecture: echo-cancelled mic + TTS-aware dynamic threshold.
- **2025.04.10** — Hybrid memory landed: three-tier hot / warm / cold + BM25 + local vector search.
- **2025.04.01** — v0.1 opened. First playable build.

</details>

## Core features

| Area | What Nexus does |
|---|---|
| **Relationship state** | Tracks five relationship levels plus trust, vulnerability, playfulness, and intellectual rapport. Milestones shape tone without showing gamified pop-ups. |
| **Memory system** | Uses hot/warm/cold memory, hybrid search, significance weighting, nightly reflection, callback queues, anniversaries, and "on this day" recall. |
| **Affect dynamics** | v0.3.1 adds long-window mood baselines and short-window shifts, so replies adapt to stuck-low, volatile, warm-stable, or acute-drop patterns without announcing it. |
| **Voice** | Wake word, VAD, continuous conversation, interrupt handling, multi-engine STT/TTS, streaming TTS, and local/offline voice options. |
| **Desktop pet** | Live2D/Pixi renderer, weather-aware scenes, day/dusk/night transitions, expression tags, idle gestures, and VTube Studio bridge support. |
| **Autonomy** | Bounded proactive ticks, silent idle motion, background errand delivery, reminders, and tool use with approval/budget gates. |
| **Tools & integrations** | Web search, weather, reminders, MCP, local webhook/RSS notifications, Discord, Telegram, and desktop context from foreground window/clipboard/OCR. |
| **Privacy & safety** | Local-first storage, encrypted key vault, hardened Electron IPC, crisis-resource panel, AI disclosure, and no Nexus cloud account. |
| **Operations** | Provider failover, cost metering, JSONL logs, diagnostics panel, release checks, and multilingual UI in zh-CN, zh-TW, en-US, ja, ko. |

## What's new in v0.3.1 (stable, 2026-04-28)

> **Emotion mainline + security audit cumulative release.** 92 commits since v0.3.0; beta.1 → beta.5 each closed one class of issue before the stable tag. Full notes: [docs/RELEASE-NOTES-v0.3.1.md](docs/RELEASE-NOTES-v0.3.1.md).

| Theme | What landed |
|---|---|
| **🧠 Tone now adapts** | A 14-day long-window + 3-day short-window mood baseline feeds every reply: when you're stuck low she gives less advice and more presence; acute drops slow her cadence; high volatility means she stops pushing topics; warm-and-stable means she follows your lead. Russell 1980 + Kuppens 2015 + Trull 2008. |
| **💔 Gottman repair** | Auto-detects the four Horsemen (criticism / contempt / defensiveness / stonewalling) and the next turn injects soft start-up + accept-influence repair posture. **Changes silently — no "I noticed you're feeling…" prompt.** |
| **🔒 Two critical CVEs cleared** | `pixi-live2d-display` accidentally pulled `gh-pages` (prototype pollution) into runtime deps; `npm overrides` forces upgrade to clean versions. |
| **🛡️ IPC audit 6/7 HIGH closed** | H2 / H3 / H5 / H6 / H7 / H8 + M1 / M2 / M3 / M5 + L3 / L4 / L6 all fixed; H4 deferred by design to v1.0. |
| **🐛 30+ static-bug fixes** | Four audit rounds + parallel agent static scans: template-replace `$&` hole, race conditions, StrictMode purity, NaN guards, async leaks, storage validation. |
| **🚦 Release-gate expanded to 26 checks** | `prerelease-check.mjs` from 8 → 26 across 6 stages: process / code quality / security / assets / docs compliance / privacy governance. |
| **🧹 UI prune** | Letters / Time-capsule / Small-things / Loose-threads / Mood-map — five settings panels withdrawn from the drawer (the underlying schedulers still run). The companion's emotional adaptation should be felt, not configured. |

<details>
<summary>v0.3.1-beta line folded into this stable</summary>

- **beta.1** — Installer-size fix (1.2 GB → ~250 MB by excluding unused FP32 model + git-LFS residue). [Notes](docs/RELEASE-NOTES-v0.3.1-beta.1.md)
- **beta.2** — IPC security hardening: chat baseUrl SSRF (H5), vault enumeration mitigation (H4), local-service probe pinned to loopback (H8). [Notes](docs/RELEASE-NOTES-v0.3.1-beta.2.md)
- **beta.3** — Live2D in packaged builds; thinking-mode multi-turn; TTS no longer wedges; multimodal images preserved across turns. [Notes](docs/RELEASE-NOTES-v0.3.1-beta.3.md)
- **beta.4** — Memory-store compaction race fixed; MCP per-tool approval (M2); workspace:set-root approval (M3); ~660 ja/ko strings translated. [Notes](docs/RELEASE-NOTES-v0.3.1-beta.4.md)
- **beta.5** — Emotion mainline M1.4-1.7 + multi-day arcs (M3) + yearbook export. [Notes](docs/RELEASE-NOTES-v0.3.1-beta.5.md)

</details>

---

## Previous stable — v0.3.0

> **Stable.** Cumulative changelog from `v0.2.9`: 100+ commits, ~12,000 LOC, +361 tests. Backward-compatible — pre-v0.3.0 stored state migrates transparently. Full notes: [docs/RELEASE-NOTES-v0.3.0.md](docs/RELEASE-NOTES-v0.3.0.md).

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
<summary>v0.3.0-beta line folded into v0.3.0 stable</summary>

- **v0.3.0-beta.1** — Three independent depth axes on the relationship system: mood-aware memory recall (VAD projection + empathy / repair / reinforce modes), one-shot level-up instructions, four sub-dimensions. [Notes](docs/RELEASE-NOTES-v0.3.0-beta.1.md)
- **v0.3.0-beta.2** — Stability + retention pass: significance-weighted recall, dream-cycle reflections, callback queue, anniversary milestones, idle motion, dynamic cadence, Liquid Glass UI, weather precision, tray + dock icons, 7 security fixes. [Notes](docs/RELEASE-NOTES-v0.3.0-beta.2.md)

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
| Windows | `Nexus-Setup-<version>.exe` (NSIS, unsigned) |
| macOS | `.dmg` or `.zip` (unsigned, universal arm64 + x64) |
| Linux | `.AppImage` / `.deb` / `.tar.gz` |

> **First launch will show a security warning. This is expected.**
> Nexus releases aren't code-signed — there's no Apple Developer
> certificate or Windows EV cert behind them, by design (no
> commercialisation, no recurring infra spend). The warning means
> "this developer hasn't paid for a signature," not "this is
> malware." Source code is on GitHub, every release ships from
> public CI, and SHA-256 + GPG signatures are published alongside
> the Linux artifacts so you can verify the bytes you downloaded.

#### macOS first launch

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

#### Windows first launch

1. Run `Nexus-Setup-<version>.exe`.
2. SmartScreen shows **"Windows protected your PC."**
3. Click **More info** (small text under the warning), then **Run anyway**.
4. Continue the NSIS installer normally; the local-voice wizard runs on first launch the same way as macOS.

#### Linux first launch

- **AppImage**: `chmod +x Nexus-<version>.AppImage` then double-click or run from terminal. No signing warning — Linux distros don't enforce app-level signatures the way macOS / Windows do.
- **.deb**: `sudo dpkg -i Nexus-<version>.deb` (or open in your distro's package manager).
- **Verify the download** (optional): each release ships a `SHA256SUMS` file and a `*.AppImage.asc` / `*.deb.asc` GPG detached signature. Import the public key published on the [release page](https://github.com/FanyinLiu/Nexus/releases/latest) and run `gpg --verify Nexus-<version>.AppImage.asc` to confirm authenticity.

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

- **Chat** — pick a provider, paste your API key, choose a model, and configure provider failover.
- **Voice input** — choose STT engine (local SenseVoice or sherpa runs fully offline; cloud options include Zhipu GLM-ASR, Volcengine, OpenAI Whisper, ElevenLabs, Tencent). Set wake word + VAD sensitivity here.
- **Voice output** — pick a TTS (Edge TTS is free and fast; MiniMax / Volcengine / DashScope for natural voices; OmniVoice for on-device). Streaming enabled by default.
- **Memory & autonomy** — configure recall depth, local embeddings, relationship type, proactive behavior, and background task budgets.
- **Integrations** — Telegram / Discord bot tokens, notification webhook/RSS channels, MCP servers, and desktop context.
- **Diagnostics** — export logs, inspect runtime state, review cost history, and run voice/provider checks.

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

## Future directions

These are promising directions, not active commitments. The current project phase is stabilization, documentation, and packaging polish.

- [ ] **Screen-aware proactive conversation** — periodically read screen context (foreground app, visible text) and initiate conversation about what the user is doing, not just respond when spoken to.
- [ ] **Decision / Roleplay / Agent three-layer separation** — split intent classification (fast) from roleplay (persona-pure) from background agent tasks. Roleplay never sees tool metadata; agent results are "announced" by the character in its own voice.
- [ ] **Character diary & autonomous timeline** — the companion auto-generates a first-person diary entry each day summarizing what happened; optionally posts "moments" to a browsable feed, creating a sense of independent life.
- [ ] **Daily schedule & activity states** — the companion follows routines (work / eat / sleep / commute) that affect availability, tone, and energy. Late-night conversations feel different from morning ones.
- [ ] **Mini mode / dock-edge hide** — drag the pet to the screen edge and it auto-hides with a peek-on-hover animation. "Always present, never intrusive."
- [ ] **Webcam awareness** — use MediaPipe face mesh to detect fatigue signals (yawning, eye closure, frowning) and inject detected state into the companion's context so it can proactively react.

### Ongoing maintenance

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

## Safety & support

Nexus is a companion AI, not a clinical tool. The codebase ships with
a small safety layer that satisfies California **SB 243** (effective
2026-01-01), New York's companion-AI safeguards law, and the applicable
parts of the **EU AI Act** (serious-incident reporting, 2026-08).

**What it does:**

- **Onboarding disclosure** — first-launch step `ai_disclosure` shows a "you're talking with an AI, not a human; this is not clinical support" screen before companion setup. Click-through timestamp persisted to `localStorage` for the audit trail.
- **Periodic in-chat reminder** — after ≥30 user messages AND ≥3 hours of wall-clock time, the chat appends a one-line system bubble reminding the user this is an AI conversation. Both gates so neither short bursts nor long idle periods over-fire.
- **Crisis-utterance detection** — when the user types something matching per-locale crisis patterns (e.g. "I want to kill myself" / "我想死" / "死にたい" / "죽고 싶다"), a non-persona panel slides in over the conversation showing real human helplines:
  - **988** (en-US) Suicide & Crisis Lifeline, 24/7 call/text
  - **12356** + **800-810-1117** (zh-CN) National (2025+) + Beijing 24h lines
  - **1925** (zh-TW) 衛生福利部 安心專線, 24/7
  - **0120-279-338** (ja) よりそいホットライン, 24/7 free
  - **109** (ko) MOHW 自殺予防 unified line (2024+), 24/7
- **Persona reframe** — for the turn that triggered the panel, the companion's reply is reframed via a one-shot system-prompt fragment: stay in character, validate, no jokes, no methods, short reply, gentle nod to the panel.

**What does NOT happen:**

- **No crisis events leave the device.** Detection runs locally, the panel renders locally, no telemetry is transmitted to any server about who said what.
- No age verification, no profile lookup, no third-party data calls.

**Where to verify the code:**

| Surface | File |
|---|---|
| Detection patterns + per-locale negative idioms | `src/features/safety/crisisDetect.ts` |
| Hotline catalogue (each entry has a `sourceUrl`) | `src/features/safety/hotlines.ts` |
| Hotline panel UI | `src/features/safety/CrisisHotlinePanel.tsx` |
| Persona reframe injection | `src/features/safety/crisisGuidance.ts` |
| Onboarding consent + periodic reminder state | `src/features/safety/disclosureState.ts`, `src/features/onboarding/components/guideSteps/AiDisclosureStep.tsx` |
| Tests | `tests/safety-*.test.ts` |

Each hotline number is re-verified against its authoritative source (national health ministry / WHO / IASP) before every release tag. A wrong number routes someone in crisis to a dead line — we treat this as a higher bar than other docs.

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
