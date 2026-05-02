# How Nexus compares to other open-source Live2D / AI companion projects

Last surveyed: April 2026. Star counts and feature data extracted by reading each project's GitHub README and topic page. Projects ranked by star count.

If a row says "removed", "WIP", or "roadmap", the project once had or is planning to have the feature but does not currently ship it.

## Project pool

| # | Project | Stars | Tech stack | Live2D | VRM | License |
|---|---|---|---|---|---|---|
| 1 | [moeru-ai/airi](https://github.com/moeru-ai/airi) | 37.8k | TS / Vue + Rust (Candle) + Electron + Capacitor | ✓ | ✓ | MIT |
| 2 | [Open-LLM-VTuber](https://github.com/Open-LLM-VTuber/Open-LLM-VTuber) | 6.8k | Python 96% | ✓ | ✗ | MIT |
| 3 | [Ikaros-521/AI-Vtuber](https://github.com/Ikaros-521/AI-Vtuber) | 4.3k | Python 98% | ✓ | + VTube Studio / UE5 | GPL-3.0 |
| 4 | [morettt/my-neuro](https://github.com/morettt/my-neuro) | 1.2k | Python 52% + JS 43% | ✓ | ✗ | MIT |
| 5 | [ardha27/AI-Waifu-Vtuber](https://github.com/ardha27/AI-Waifu-Vtuber) | 1.1k | Python 99% | ✗ (uses VTube Studio) | ✗ | – |
| 6 | [fagenorn/handcrafted-persona-engine](https://github.com/fagenorn/handcrafted-persona-engine) | 1.0k | C# 97% (.NET) | ✓ | ✗ | – |
| 7 | [AkagawaTsurunaki/ZerolanLiveRobot](https://github.com/AkagawaTsurunaki/ZerolanLiveRobot) | 656 | Python + PyQt5 + Live2D-py | ✓ | ✗ | MIT |
| 8 | [jofizcd/Soul-of-Waifu](https://github.com/jofizcd/Soul-of-Waifu) | 592 | Python + PyTorch + Llama.cpp | ✓ | ✓ | GPL-3.0 |
| 9 | [ylxmf2005/LLM-Live2D-Desktop-Assitant](https://github.com/ylxmf2005/LLM-Live2D-Desktop-Assitant) | 159 | Python + Electron | ✓ | ✗ | MIT |
| 10 | [x380kkm/Live2DPet](https://github.com/x380kkm/Live2DPet) | 51 | Electron + TS + PixiJS | ✓ | ✗ | MIT |
| ⭐ | **Nexus (this project)** | – | Electron + TS + React | ✓ | ✗ | MIT |

## Core AI capabilities

| Project | LLM providers | TTS | ASR / voice input | Long-term memory | MCP / tools | Vision / screen |
|---|---|---|---|---|---|---|
| airi | 25+ cloud + local (Candle / WebGPU) | ElevenLabs | browser-side + Discord capture | DuckDB-WASM + Alaya (WIP) | game agents (Minecraft / Factorio) | ✗ |
| Open-LLM-VTuber | 12+ (Ollama / GGUF / cloud full set) | **11 engines** (sherpa-onnx, MeloTTS, GPT-SoVITS, Edge, Bark, CosyVoice, Azure …) | **7 engines** (sherpa, FunASR, Whisper family, Azure …) | **temporarily removed** in v1.x | ✓ MCP servers | ✓ camera + screen recording + screenshot |
| Ikaros AI-Vtuber | 16+ (Tongyi, GLM, Kimi, Doubao, Spark, Bard …) | 16 engines (Edge, VITS-Fast, ElevenLabs, GPT-SoVITS, F5-TTS, MeloTTS …) | SenseVoice | not documented | ✗ (has Stable Diffusion) | ✓ Gemini / GLM-4V |
| my-neuro | mainstream API unification + local fine-tuning | GPT-SoVITS | ✓ | ✓ **MemOS** | ✓ MCP + playwright | ✓ image recognition |
| AI-Waifu-Vtuber | OpenAI only | VoiceVox + Silero | OpenAI Whisper | `conversation.json` | VTube Studio | ✗ |
| persona-engine | OpenAI-compatible (Ollama, Groq, OpenAI) | Kokoro + espeak fallback | Whisper.NET (**dual-model** for interrupt detection) | ✗ | ✗ | ✓ window OCR (experimental) |
| ZerolanLiveRobot | multi-provider HTTP pipeline (ZerolanCore + others) | with emotion synthesis | VAD + microphone | ✓ short-term context + **vector DB long-term** | ✓ browser / screenshot / Minecraft | ✓ OCR + screen understanding |
| Soul of Waifu | CharAI / Mistral / OpenAI / OpenRouter / GGUF | ElevenLabs | Faster-Whisper + Silero VAD | **Vector RAG + auto-summary + Tavern V2 cards** | not documented | roadmap |
| Elaina Desktop | configurable | GPT-SoVITS | **Picovoice wake word** | not documented | computer-use API | ✓ screen + clipboard |
| Live2DPet | OpenAI-compat (Grok / GPT-5 / Gemini) | **VOICEVOX only** | ✗ | visual keyframe memory | ✗ (web search deprecated) | ✓ **core feature**: periodic screenshot |
| **Nexus** | OpenAI-compat + **provider profiles + failover chain** | **streaming sentence-immediate** chunker | ✓ + **echo-cancelled self-interrupt** | ✓ **3-tier hot/warm/cold + dream cycle + narrative threads** | ✓ **native + prompt-mode** | ✓ desktop context (clipboard, foreground window, OCR) |

## Where Nexus leads

1. **Memory architecture depth.** The three-tier hot / warm / cold memory store — in-prompt long-term + daily layers, on-demand semantic vector recall, and an importance-decayed cold archive — combined with a nightly *dream cycle* that weaves experiences into *narrative threads*, is unique among the surveyed projects. airi's Alaya is still WIP; Open-LLM-VTuber temporarily removed long-term memory in v1.x; Soul of Waifu's Vector RAG + Tavern V2 cards is the closest comparable but has no dream cycle / narrative threads.

2. **MCP dual-mode.** Nexus supports both native OpenAI function calling and a prompt-mode fallback (`<tool_call>` markers in plain text) so models without a `tools` API can still drive tools. my-neuro and Open-LLM-VTuber support native MCP only.

3. **TTS streaming granularity.** Sentence-immediate splitting with first-comma early flush gets the first audio chunk playing faster than per-engine integrations that wait for a full sentence. Persona Engine's dual-Whisper interruption is a different solution targeting the ASR side.

4. **Echo-cancelled self-interrupt.** None of the surveyed projects appear to address the "TTS playback feeding back into ASR" failure mode by routing the mic VAD specifically through the echo-cancelled stream. Most rely on raw mic VAD plus a "muted while speaking" gate.

5. **Provider failover chain.** None of the surveyed projects ship a configurable provider failover chain spanning LLM / STT / TTS.

## Where Nexus is behind

1. **TTS engine breadth.** Open-LLM-VTuber supports 11 TTS engines, Ikaros 16. Nexus supports a smaller set. This affects community plug-and-play.

2. **ASR engine breadth.** Open-LLM-VTuber supports 7 ASR engines. Nexus supports fewer.

3. **VRM support.** airi and Soul of Waifu support VRM. Nexus is Live2D-only.

4. **Local LLM inference.** airi is integrating Candle / WebGPU for in-process inference. Nexus is API-only.

5. **Tavern character card V2 compatibility.** Soul of Waifu supports Tavern V2 cards directly. Nexus uses a custom `SOUL.md` format and cannot import community card libraries without conversion.

6. **Wake word.** Elaina Desktop ships Picovoice. Nexus does not currently ship a wake word engine.

7. **Mobile.** Only airi (via Capacitor) is on mobile. Nexus is desktop-only.

8. **Real-time RVC voice cloning.** persona-engine ships ONNX-based RVC. Nexus does not.

## Methodology

Each project's data was extracted from its GitHub README and topic page in April 2026. Star counts are point-in-time. "✓" means the feature is documented in the README. "✗" means it is not mentioned and not present in the changelog. "WIP", "removed", and "roadmap" are direct paraphrases of the project's own documentation.

Projects deliberately excluded from the top 10:

- **Unity-only frameworks** (uezo/ChatdollKit, Navi-Studio/Virtual-Human-for-Chatting) — different ecosystem; not directly comparable to an Electron / Python desktop companion.
- **Memory libraries** (memodb-io/memobase, oceanbase/powermem) — building blocks rather than complete companions.
- **Curated lists** (proj-airi/awesome-ai-vtubers) — meta-projects.
- **Streaming-bot frameworks** primarily targeting YouTube / Twitch broadcast rather than desktop companionship.

If you spot a project that should be on this list, or a fact that needs correcting, open an issue.
