# Nexus — Feature Inventory

> Electron + React + TypeScript desktop AI companion with Live2D avatar.

---

## 1. Core Companion

| Feature | Description |
|---|---|
| Live2D Avatar | Desktop pet with idle animation choreography, lip-sync, mood expressions, stage directions in chat |
| Character Profiles | Multiple persona presets — each with name, system prompt, model, voice |
| SOUL.md Persona | File-based identity system (`userData/persona/SOUL.md`), hot-reload, overrides `systemPrompt` |
| Persona MEMORY.md | Companion-side persistent memory file injected alongside SOUL.md |
| i18n | UI in 5 languages: zh-CN, zh-TW, en, ja, ko |
| Themes | Theme registry with CSS variable tokens |

---

## 2. Text Chat

| Feature | Description |
|---|---|
| Multi-provider LLM | 19 providers: OpenAI, Anthropic, Gemini, xAI, DeepSeek, Moonshot, MiniMax, DashScope, SiliconFlow, OpenRouter, Together, Mistral, Qianfan, ZAI, BytePlus, NVIDIA, Venice, Ollama, Custom |
| Streaming | SSE / delta streaming with abort support |
| Failover | Auto-fallback to Ollama when primary provider fails |
| Context Compaction | Token budget → older messages summarized, context window managed |
| Provider Profiles | Per-provider saved configurations (base URL, API key, model) |
| Chat Archive | JSON export/import of full conversation history |

---

## 3. Speech Input (STT)

| Feature | Description |
|---|---|
| Local SenseVoice | Offline ASR via sherpa-onnx OfflineRecognizer (final-only) |
| Local Paraformer | Streaming offline ASR via sherpa-onnx OnlineRecognizer (partial results) |
| Volcengine STT | Cloud speech recognition |
| OpenAI STT | Whisper-based cloud transcription |
| ElevenLabs STT | Cloud speech recognition |
| Tencent Real-Time ASR | WebSocket streaming ASR |
| Custom OpenAI STT | Custom endpoint with OpenAI-compatible STT API |
| Browser VAD | @ricky0123/vad-web voice activity detection |
| Wake Word | Keyword spotting via sherpa-onnx KWS (configurable trigger phrase) |
| Hotword Extraction | Auto-generate hotword lists from chat/memory using CJK n-grams |
| Hotword Correction | Intent-based correction (search, weather, reminder patterns) |
| Audio Normalization | RMS-based normalization with soft limiter |

---

## 4. Speech Output (TTS)

| Feature | Description |
|---|---|
| OpenAI TTS | Cloud speech synthesis |
| MiniMax TTS | Cloud synthesis with voice listing |
| Volcengine TTS | Volcano Engine speech synthesis |
| DashScope TTS | Alibaba Cloud Qwen-TTS |
| ElevenLabs TTS | Cloud synthesis with voice cloning support |
| Edge TTS | Microsoft Edge free TTS |
| OmniVoice TTS | Custom local TTS endpoint |
| Custom OpenAI TTS | Custom endpoint with OpenAI-compatible TTS API |
| Streaming TTS | Smart sentence-boundary text chunking → progressive audio playback |
| Lip Sync | Speech level metering drives Live2D mouth animation |
| Voice Cloning | ElevenLabs IVC voice cloning |

---

## 5. Voice Conversation

| Feature | Description |
|---|---|
| Push-to-talk | Manual voice activation |
| Wake Word Trigger | Always-on keyword spotting → hands-free activation |
| Direct Send | Auto-send transcript on speech end |
| Manual Confirm | User reviews transcript before sending |
| Continuous Mode | Persistent listening loop (listen → transcribe → reply → listen) |
| Interruption | Stop assistant speech mid-sentence on user input |
| OpenAI Realtime API | WebSocket-based real-time audio conversation (low latency) |
| Provider Fallback | Automatic STT/TTS provider failover on error |
| Diagnostics | Smoke tests and health checks for speech providers |

---

## 6. Memory System

| Feature | Description |
|---|---|
| Long-term Memory | Categorized items (profile, preference, goal, habit, feedback, project, reference, manual) with importance levels |
| Daily Memory | Per-day diary entries from conversations with deduplication |
| Hybrid Search | 70% vector cosine + 30% BM25 keyword, 4× over-fetch merge |
| BM25 Keyword Search | Pure-JS BM25 with CJK character-level tokenization |
| Vector Search | Worker-thread cosine similarity; embedding cache; local hash fallback |
| Remote Embeddings | Transformer.js feature extraction (multilingual MiniLM) |
| Hot/Warm Tiering | Hot tier (in-prompt, capped at 3500 chars) + Warm tier (on-demand semantic retrieval) |
| Memory Dream | Idle-time consolidation — merge, deduplicate, distill skill patterns |
| Memory Archive | JSON export/import of full memory state |

---

## 7. Autonomy Engine

| Feature | Description |
|---|---|
| Tick Loop | Configurable interval (default 30s), phase lifecycle: awake → drowsy → sleeping → dreaming |
| Focus Awareness | Tracks desktop focus: active / idle / away / locked with idle thresholds |
| Proactive Engine | Context-aware decisions: welcome-back, reminders, time-of-day greetings, weather briefs |
| Inner Monologue | Periodic lightweight LLM thoughts; urgency threshold controls speech output |
| Context Scheduler | Trigger evaluation on window changes, clipboard, time-of-day |
| Morning Brief | Auto-generated daily summary at wake |
| Notification Bridge | System notification interception → companion awareness |
| Cost Cap | Per-tick spending limits to prevent runaway API usage |

---

## 8. Tools & Intent

| Feature | Description |
|---|---|
| Web Search | 8 providers: Bing, DuckDuckGo, Brave, Tavily, Exa, Firecrawl, Gemini, Perplexity |
| Weather | Built-in weather query tool |
| Open Link | External URL/app launcher |
| Intent Classification | Pattern matching for search/weather/music/open-link intents |
| Query Rewrite | Search query normalization and rewriting |
| Background Search | Silent pre-fetch for anticipated queries |
| Parallel Execution | Concurrent multi-tool runner |
| PreToolUse / PostToolUse Hooks | Middleware for blocking, argument modification, logging, caching |
| Deferred Tool Selection | Keyword-match user query → include only top-12 most relevant tool schemas per request |

---

## 9. MCP (Model Context Protocol)

| Feature | Description |
|---|---|
| Multi-Server Host | Spawn and manage multiple MCP server processes via stdio JSON-RPC |
| Tool Discovery | Auto-discover tools from connected MCP servers |
| Tool Calling | Function-calling integration with OpenAI-compatible API |
| Restart / Reconnect | Auto-restart crashed MCP server processes |
| Integration Inspection | Runtime health check for each MCP server (command resolved, pid, tool count) |

---

## 10. Plugin System

| Feature | Description |
|---|---|
| Plugin Host | Dynamic plugin loading from `userData/plugins/` |
| Plugin Lifecycle | Scan, start, stop, restart, enable, disable |
| SKILL.md Guides | Per-plugin skill documentation loaded into LLM context |
| Approval Workflow | User must approve plugins before first run |
| Capability Routing | Plugin declares capabilities; host routes tool calls accordingly |

---

## 11. Auto Skills

| Feature | Description |
|---|---|
| Skill Generation | After complex tool-call interactions, LLM auto-generates reusable skill markdown |
| Skill Store | Persistent skill documents in `userData/skills/` with BM25 index |
| Skill Retrieval | Relevant skills auto-loaded into prompt context via keyword match |
| Usage Tracking | Skills track use count; least-used evicted when over 200 limit |

---

## 12. Desktop Context

| Feature | Description |
|---|---|
| Active Window | Title of foreground window injected into context |
| Clipboard | Clipboard content monitoring |
| Screen OCR | Screenshot capture → Tesseract.js OCR extraction |
| VLM Analysis | Visual LLM analysis of screenshots (experimental) |

---

## 13. Game Integrations

| Feature | Description |
|---|---|
| Minecraft | RCON connection, command execution, game context extraction |
| Factorio | RCON protocol, factory state commands |
| TCP Probe | Pre-connection endpoint reachability check |
| Permission Modes | Per-game read-only / confirm / auto trust levels |

---

## 14. Messaging Gateways

| Feature | Description |
|---|---|
| Telegram Bot | Long-polling via Bot API getUpdates; bidirectional messaging |
| Discord Bot | WebSocket Gateway (heartbeat, identify, resume, reconnect); REST API for sending |
| Message Forwarding | Incoming messages routed to companion chat as sourced messages |
| Reply Routing | Companion replies sent back to originating chat/channel |
| Channel Filtering | Allowed chat/channel ID lists |
| Permission Modes | Per-gateway read-only / confirm / auto trust levels |

---

## 15. Reminders

| Feature | Description |
|---|---|
| Natural Language Parsing | Time expressions, relative times, cron-like frequencies |
| Scheduling | Persistent reminder task store |
| Autonomy Integration | Reminder triggers detected during autonomy tick |

---

## 16. Security

| Feature | Description |
|---|---|
| Key Vault | Electron safeStorage encryption for API keys and tokens |
| Trusted Sender Validation | IPC handlers verify sender origin |
| Integration Permissions | Graduated trust: read-only / confirm / auto per integration |

---

## 17. Settings & UI

| Feature | Description |
|---|---|
| Settings Drawer | 13 sections: Chat, Model, Speech In, Speech Out, Voice, Clone, Memory, Context, Autonomy, Integrations, History, Window, Console |
| Provider Choice Grid | Visual grid selector for providers (text, STT, TTS) |
| Integration Inspector | Real-time status cards for MCP, Minecraft, Factorio, Telegram, Discord |
| Debug Console | Runtime event log with source filtering |
| Onboarding | First-run setup flow |
| Pet Window | Pin, click-through, drag, system tray menu |

---

## Summary

| Category | Count |
|---|---|
| Text LLM Providers | 19 |
| Speech Input Providers | 7 + browser VAD |
| Speech Output Providers | 8 + voice cloning |
| Web Search Providers | 8 |
| Game Integrations | 2 (Minecraft, Factorio) |
| Messaging Gateways | 2 (Telegram, Discord) |
| UI Languages | 5 (zh-CN, zh-TW, en, ja, ko) |
| Electron Services | 20 |
| IPC Handlers | 15 |
| Feature Modules | 21 |
| React Hooks | 32+ |
| Preload API Methods | 120+ |
| Settings Sections | 13 |
