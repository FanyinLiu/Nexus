<p align="center"><img src="public/banner.png" alt="Nexus" width="720" /></p>

<p align="center">
  <a href="https://github.com/FanyinLiu/Nexus/releases/latest"><img src="https://img.shields.io/github/v/release/FanyinLiu/Nexus?style=flat-square&color=blue" alt="Release"></a>
  <a href="https://github.com/FanyinLiu/Nexus/actions"><img src="https://img.shields.io/github/actions/workflow/status/FanyinLiu/Nexus/ci.yml?branch=main&style=flat-square&label=CI" alt="CI"></a>
  <a href="https://github.com/FanyinLiu/Nexus/blob/main/LICENSE"><img src="https://img.shields.io/github/license/FanyinLiu/Nexus?style=flat-square" alt="License"></a>
  <a href="https://github.com/FanyinLiu/Nexus/stargazers"><img src="https://img.shields.io/github/stars/FanyinLiu/Nexus?style=flat-square" alt="Stars"></a>
  <a href="https://github.com/FanyinLiu/Nexus"><img src="https://img.shields.io/github/last-commit/FanyinLiu/Nexus?style=flat-square" alt="Last Commit"></a>
</p>

<p align="center">
  <b>English</b> · <a href="docs/README.zh-CN.md">简体中文</a> · <a href="docs/README.zh-TW.md">繁體中文</a> · <a href="docs/README.ja.md">日本語</a>
</p>

---

## Overview

Nexus is a Windows desktop AI companion featuring Live2D character rendering, continuous voice conversation, long-term memory, desktop awareness, autonomous behavior, and multi-platform integrations. It supports 18+ LLM providers and can run fully local or with cloud models.

---

## Features

| Feature | Description |
|---------|-------------|
| **Pet + Panel dual-view** | Live2D character with expression, motion, and mood sync |
| **Continuous voice chat** | Multi-engine STT / TTS with wake word, VAD, continuous conversation, speech interruption |
| **Long-term memory** | Hybrid BM25 + vector search, auto daily diary, proactive recall, memory decay and archive |
| **Autonomous behavior** | Inner monologue, emotion model, intent prediction, relationship tracking, rhythm learning, skill distillation |
| **Desktop awareness** | Clipboard, foreground window, screenshot OCR, context triggers |
| **Tool calling** | Web search (auto content extraction), weather, reminders, MCP protocol |
| **Multi-platform** | Discord / Telegram gateways, plugin system, skill store |
| **Multilingual** | Simplified Chinese / Traditional Chinese / English / Japanese / Korean |

---

## Supported Providers

<table>
<tr>
<td><b>LLM (18+)</b></td>
<td>OpenAI · Anthropic · Google Gemini · xAI Grok · DeepSeek · Moonshot (Kimi) · Qwen (DashScope) · GLM (ZhiPu) · MiniMax · SiliconFlow · OpenRouter · Together AI · Mistral · Qianfan · Z.ai · BytePlus · NVIDIA · Venice · Ollama · Custom OpenAI-compatible</td>
</tr>
<tr>
<td><b>STT</b></td>
<td>GLM-ASR-Nano · Paraformer · SenseVoice · Zhipu GLM-ASR · Volcengine · OpenAI Whisper · ElevenLabs Scribe · Tencent ASR · Custom OpenAI-compatible</td>
</tr>
<tr>
<td><b>TTS</b></td>
<td>Edge TTS · CosyVoice · MiniMax · Volcengine · DashScope Qwen3-TTS · OmniVoice · OpenAI TTS · ElevenLabs · Custom OpenAI-compatible</td>
</tr>
<tr>
<td><b>Web Search</b></td>
<td>DuckDuckGo · Bing · Brave · Tavily · Exa · Firecrawl · Gemini Grounding · Perplexity</td>
</tr>
</table>

---

## Recommended Models

### Chat Models (LLM)

| Use Case | Provider | Model | Notes |
|----------|----------|-------|-------|
| **Daily companion (CN)** | DeepSeek | `deepseek-chat` | Strong Chinese, very affordable |
| **Daily companion (alt)** | DashScope Qwen | `qwen-plus` | Long context, natural Chinese |
| **Deep reasoning** | DeepSeek | `deepseek-reasoner` | Complex reasoning / math / code |
| **Best overall** | Anthropic | `claude-sonnet-4-6` | Top capability, reliable tool use |
| **Cost-effective** | OpenAI | `gpt-5.4-mini` | Fast and cheap for high-frequency chat |
| **Free tier** | Google Gemini | `gemini-2.5-flash` | Generous free quota |
| **Local** | Ollama | `qwen3:8b` | Runs smoothly on RTX 3060 12GB, fully offline |
| **Local (lightweight)** | Ollama | `qwen3:4b` | 4GB VRAM, faster response |

### STT (Speech-to-Text)

| Use Case | Provider | Model | Notes |
|----------|----------|-------|-------|
| **Local high-accuracy** | GLM-ASR-Nano | `glm-asr-nano` | Best Chinese accuracy, runs on RTX 3060, offline |
| **Local streaming** | Paraformer | `paraformer-trilingual` | Low-latency real-time transcription, CN/EN/Cantonese |
| **Local (alt)** | SenseVoice | `sensevoice-zh-en` | 15x faster than Whisper, CN/EN bilingual offline |
| **Cloud (CN)** | Zhipu GLM-ASR | `glm-asr-2512` | Top Chinese accuracy with hotword support |
| **Cloud (Global)** | OpenAI | `gpt-4o-mini-transcribe` | Multilingual, use your existing OpenAI key |
| **Cloud (Global, premium)** | ElevenLabs Scribe | `scribe_v1` | 99 languages, auto-punctuation, speaker detection |
| **Cloud (CN, alt)** | Volcengine | `bigmodel` | ByteDance large-model speech recognition |
| **Cloud (CN, alt)** | Tencent ASR | `16k_zh` | Real-time streaming, low latency, multi-language |

### TTS (Text-to-Speech)

| Use Case | Provider | Voice | Notes |
|----------|----------|-------|-------|
| **Free default** | Edge TTS | `zh-CN-XiaoxiaoNeural` | Microsoft free voices, no API key needed |
| **Local offline** | CosyVoice | SFT presets | Fully offline on RTX 3060 |
| **Local multilingual** | OmniVoice | `female, young adult` | 646 languages, fully offline, descriptor-based |
| **Most natural (CN)** | MiniMax | `female-shaonv` | Expressive voices for companion characters |
| **Most natural (Global)** | ElevenLabs | custom `voice_id` | World-class synthesis, voice cloning support |
| **Cloud (Global)** | OpenAI TTS | `alloy` | Use your existing OpenAI key, `gpt-4o-mini-tts` model |
| **CN instructable** | DashScope Qwen-TTS | `Cherry` | Alibaba Qwen3-TTS, dialect and instruction support |
| **Cost-effective (CN)** | Volcengine | `BV700_streaming` | High naturalness, low cost |

---

## Hardware Reference

| Component | Model |
|-----------|-------|
| CPU | Intel Core i5-12400F (6C12T) |
| GPU | NVIDIA GeForce RTX 3060 12GB |
| RAM | 32GB DDR4 |
| OS | Windows 11 Pro |

> The RTX 3060 12GB can smoothly run most local models (under 8B parameters), including local STT and TTS. If your GPU has less than 8GB VRAM, cloud-based models are recommended.

---

## Quick Start

**Requirements**: Windows 10/11 · Node.js 22+ · npm 10+

```bash
# 1. Clone the repository
git clone https://github.com/FanyinLiu/Nexus.git
cd Nexus

# 2. Install dependencies
npm install

# 3. Start in development mode
npm run electron:dev

# 4. Build for production
npm run build

# 5. Package Windows installer
npm run package:win
```

---

## Project Structure

```
electron/                Desktop runtime & native bridge
  ipc/                   IPC channels (audio / chat / memory / tts / discord / telegram / plugin / skill …)
  services/              Backend services (TTS · vector store · MCP · plugin host · key vault …)
src/
  app/                   App assembly, controllers, views
  components/            Shared UI components
  features/              Domain modules
    autonomy/            Autonomous behavior (monologue / emotion / goal / intent / relationship / rhythm / skill)
    hearing/             STT engine adapters
    memory/              Semantic memory · vector + BM25 hybrid search · clustering · decay · archive
    chat/                LLM runtime · context compression
    tools/               Tool router · circuit breaker · parallel execution · permissions
    integrations/        External platform integration (Discord / Telegram)
    skills/              Skill distillation & auto-generation
  hooks/                 React orchestration hooks
  i18n/                  Multilingual (zh-CN / zh-TW / en / ja / ko)
  lib/                   Pure utilities & provider registry
  types/                 Type definitions
tests/                   Tests
scripts/                 Local model launch scripts (GLM-ASR · OmniVoice)
```

---

## Architecture

```
                    ┌──────────────────────────────────┐
                    │         Electron Main             │
                    │  IPC · TTS · STT · MCP · Plugins  │
                    │  Discord · Telegram · KeyVault     │
                    └───────────────┬──────────────────┘
                                    │
                    ┌───────────────▼──────────────────┐
                    │         React Frontend            │
                    ├──────────────────────────────────┤
                    │  useAppController                 │
                    │    ├─ useVoice (VoiceBus)         │
                    │    ├─ useChat (runtime)           │
                    │    ├─ useMemory (vector)          │
                    │    └─ useAutonomy (tick engine)   │
                    ├──────────────────────────────────┤
                    │  features/                        │
                    │    ├─ autonomy                    │
                    │    ├─ hearing (STT engines)       │
                    │    ├─ memory (vector + BM25)      │
                    │    ├─ chat (LLM runtime)          │
                    │    ├─ tools (search/weather/MCP)  │
                    │    ├─ integrations (Discord/TG)   │
                    │    └─ skills (distillation)       │
                    └──────────────────────────────────┘
```

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Electron 36 |
| Frontend | React 19 · TypeScript · Vite 8 |
| Character | PixiJS · pixi-live2d-display |
| STT | Sherpa-onnx · SenseVoice · Paraformer · GLM-ASR-Nano · Zhipu ASR · Volcengine · OpenAI Whisper · ElevenLabs Scribe · Tencent ASR |
| TTS | Edge TTS · MiniMax · Volcengine · CosyVoice · OmniVoice · DashScope Qwen3-TTS · OpenAI TTS · ElevenLabs |
| LLM | OpenAI · Anthropic · Gemini · DeepSeek · Kimi · Qwen · GLM · Grok · Ollama + 18 more |
| Web Search | DuckDuckGo · Bing · Brave · Tavily · Exa · Firecrawl · Gemini Grounding · Perplexity |
| Local ML | onnxruntime-web · @huggingface/transformers |
| Packaging | electron-builder |

## Commands

| Command | Description |
|---------|-------------|
| `npm run dev` | Vite dev server |
| `npm run electron:dev` | Electron dev mode |
| `npm run build` | Build frontend |
| `npm test` | Run tests |
| `npm run package:win` | Package Windows installer |

---

## License

[MIT](LICENSE)
