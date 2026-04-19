<p align="center"><img src="../public/banner.png" alt="Nexus" width="720" /></p>

<h1 align="center">Nexus</h1>

<h3 align="center">一个住在你桌面上的 AI 伙伴——会记忆、会做梦、会陪伴。</h3>

<p align="center">
  <a href="https://github.com/FanyinLiu/Nexus/releases/latest"><img src="https://img.shields.io/github/v/release/FanyinLiu/Nexus?style=flat-square&color=blue" alt="Release"></a>
  <a href="https://github.com/FanyinLiu/Nexus/blob/main/LICENSE"><img src="https://img.shields.io/github/license/FanyinLiu/Nexus?style=flat-square" alt="License"></a>
  <a href="https://github.com/FanyinLiu/Nexus/stargazers"><img src="https://img.shields.io/github/stars/FanyinLiu/Nexus?style=flat-square" alt="Stars"></a>
  <a href="https://github.com/FanyinLiu/Nexus"><img src="https://img.shields.io/github/last-commit/FanyinLiu/Nexus?style=flat-square" alt="Last Commit"></a>
</p>

<p align="center">
  <a href="../README.md">English</a> · <b>简体中文</b> · <a href="README.zh-TW.md">繁體中文</a> · <a href="README.ja.md">日本語</a>
</p>

---

> **注意**：Nexus 正在积极开发中。部分功能已经稳定，部分仍在打磨。欢迎反馈和贡献！

## Nexus 是什么？

Nexus 是一个跨平台的桌面 AI 伙伴，基于大语言模型驱动。它将 Live2D 角色与语音对话、长期记忆、桌面感知、自主行为和工具调用相结合——设计目标不是做一个聊天机器人，而是一个真正了解你的伙伴。

使用 Electron + React + TypeScript 构建，支持 Windows、macOS 和 Linux。内置 18+ LLM 提供商，可完全离线运行或使用云端模型。


---

## 功能特性

- 🎙️ **常驻唤醒词** — 说出唤醒词即可开始对话，无需按键。基于 sherpa-onnx 关键词检测，主进程 Silero VAD 共享单路麦克风流。

- 🗣️ **连续语音对话** — 多引擎 STT / TTS，回声消除自动打断（说话时不会被自己的声音唤醒），句级流式 TTS（第一个逗号就开始播报）。

- 🧠 **会做梦的记忆** — 热 / 温 / 冷三级记忆架构，BM25 + 向量混合检索。每晚执行*梦境循环*，将对话聚类成*叙事线索*，让伙伴逐渐建立对你的完整认知。

- 🤖 **自主内在生活（V2）** — 每个 tick 一次 LLM 决策调用，输入是分层快照（情绪 · 关系 · 节律 · 桌面 · 最近对话），输出过一层人格护栏。不再是模板化发言——它用自己的声音说话，也可以选择不说话。详见 [本次更新说明](#本次更新--v025-自洽引擎-v2)。

- 🔧 **工具调用 (MCP)** — 网页搜索、天气查询、提醒任务及任何 MCP 兼容工具。支持原生函数调用，同时为不支持 `tools` 的模型提供提示词模式回退。

- 🔄 **提供商故障转移** — 可串联多个 LLM / STT / TTS 提供商。当某个提供商宕机时，Nexus 自动切换到下一个，对话不中断。

- 🖥️ **桌面感知** — 读取剪贴板、前台窗口标题，以及（可选的）屏幕 OCR。上下文触发器让它能对你正在做的事情作出反应。

- 🔔 **通知桥接** — 本地 Webhook 服务器 + RSS 轮询。将外部通知推送到伙伴的对话中。

- 💬 **多平台** — Discord 和 Telegram 网关，支持按聊天路由。在手机上也能和伙伴对话。

- 🌐 **多语言** — 界面支持简体中文、繁体中文、英语、日语和韩语。

---

## 本次更新 — v0.2.5 自洽引擎 V2

> **一句话版本** — 旧的规则决策树（约 900 行模板）换成了每 tick 一次的 LLM 调用，外层套人格护栏。主动发言现在听起来像角色本人，而不是模板。本次发版默认开启。
>
> 这一块**每次发版都会替换成新版本的说明**，老的内容去 [Releases](https://github.com/FanyinLiu/Nexus/releases) 翻。

### 为什么重写

v1 自主行为由三块硬写逻辑拼起来：

- `proactiveEngine.ts` — 规则树 + 模板选择
- `innerMonologue.ts` — 独立 LLM 调用生成"伙伴在想什么"
- `intentPredictor.ts` — 另一次 LLM 调用预测"用户下一句会说什么"

情绪 / 关系 / 节律数据都采集得好好的，但最后一层是模板选择器不是写作器，所以影响不到输出文字。用户反馈主动发言"幼稚"、"套路化"——v2 修的就是这个。

### V2 做了什么

```
tick（可触发？）→ contextGatherer → decisionEngine → personaGuardrail → 输出
      │                │                 │                 │              │
      └─ 沿用原有门槛  └─ 纯信号聚合     └─ 一次 LLM 调用  └─ 禁用词 +   └─ 走和
         （清醒、VAD、   （无 IO、       返回 {speak,         密度检查 +    手动对话
          静音时段、     无 React）      text,                可选 LLM 裁   同一条
          费用上限）                    silence_reason}     判             流式 TTS 通路
```

V1 → V2 关键变化：

| | V1 | V2 |
|---|---|---|
| 决策面 | 规则树挑模板 | 一次 LLM 写完整句话 |
| 上下文 | 决策过程中零散读取 | 一个纯 `contextGatherer` 快照 |
| 人格发声 | 靠 prompt 粘合、无强制 | 多文件人格 + 护栏层 |
| 不发言 | "没有规则触发" | 一等公民 `silence_reason` |
| 成本 | 2-3 次 LLM 调用（独白 + 预测 + 发言） | 1 次 LLM 调用，复用主模型或单独配 |
| 可测性 | 和 React 纠缠 | 纯模块，Node 里直接跑 |

### 人格文件

每个人格的配置改成多文件布局，不再塞进一个 JSON 字段。参考布局看 `src/features/autonomy/v2/personas/xinghui/`：

```
soul.md       — 第一人称背景、语气、价值观
style.json    — 语气旋钮（温度倾向、表情包策略、语体）
examples.md   — 决策 prompt 读取的 few-shot 示例
voice.json    — 该人格的 TTS 音色 / 提供商覆写
tools.json    — 该人格被允许调用的工具
memory.md     — 该人格"记得"的长期事实
```

护栏会读 `style.json` 里的禁用词和密度上限，必要时再让 LLM 裁判员复核语气偏移。严格度可调（`autonomyPersonaStrictnessV2`：`loose | med | strict`）。

### 调优

设置 → **自主行为**：

- **启用 V2**（`autonomyEngineV2`）— 本版默认开。关掉即回落到 V1 规则树（迁移期两条路并存）。
- **活跃度**（`autonomyLevelV2`）— `off | low | med | high`，同时控制 tick 密度和允许"开口"的频率。
- **决策模型**（`autonomyModelV2`）— 留空则复用主对话模型；也可以单独指向一个便宜或更快的模型。
- **护栏严格度**（`autonomyPersonaStrictnessV2`）— `loose | med | strict`。

### 仍在用 V1 的部分

情绪模型、关系追踪、节律学习、焦点感知、梦境循环、目标追踪 —— 都没动，继续往 V2 的上下文快照里喂数据。V1 的决策三件套（`proactiveEngine.ts` / `innerMonologue.ts` / `intentPredictor.ts`）会保留到 Phase 6 完成两条路并跑验证后再删。

内部分层规则看 `src/features/autonomy/README.md`，源码在 `src/features/autonomy/v2/`。

---

## 支持的提供商

| 类别 | 提供商 |
|------|--------|
| **LLM (18+)** | OpenAI · Anthropic · Gemini · DeepSeek · Kimi · Qwen · GLM · Grok · MiniMax · SiliconFlow · OpenRouter · Together · Mistral · Qianfan · Z.ai · BytePlus · NVIDIA · Venice · Ollama · Custom |
| **STT** | GLM-ASR-Nano · Paraformer · SenseVoice · Zhipu GLM-ASR · Volcengine · OpenAI Whisper · ElevenLabs Scribe · Tencent ASR · Custom |
| **TTS** | Edge TTS · MiniMax · Volcengine · DashScope Qwen3-TTS · OmniVoice · OpenAI TTS · ElevenLabs · Custom |
| **网页搜索** | DuckDuckGo · Bing · Brave · Tavily · Exa · Firecrawl · Gemini Grounding · Perplexity |

---

## 推荐模型配置

> 此推荐针对**简体中文用户**。其他语言请查看 [English](../README.md) · [繁體中文](README.zh-TW.md) · [日本語](README.ja.md)。

### 对话模型（LLM）

| 场景 | 推荐提供商 | 推荐模型 | 说明 |
|------|-----------|---------|------|
| **日常陪伴（首选）** | DeepSeek | `deepseek-chat` | 中文能力强、价格极低，适合长时间陪伴对话 |
| **日常陪伴（备选）** | DashScope Qwen | `qwen-plus` | 阿里通义千问，中文自然，长上下文支持好 |
| **深度推理** | DeepSeek | `deepseek-reasoner` | 需要复杂推理、数学、代码时使用 |
| **最强综合** | Anthropic | `claude-sonnet-4-6` | 综合能力最强，工具调用稳定 |
| **高性价比（海外）** | OpenAI | `gpt-5.4-mini` | 速度快、便宜，适合高频对话 |
| **免费体验** | Google Gemini | `gemini-2.5-flash` | 免费额度大，适合入门体验 |

### 语音输入（STT）

| 场景 | 推荐提供商 | 推荐模型 | 说明 |
|------|-----------|---------|------|
| **本地高精度** | GLM-ASR-Nano | `glm-asr-nano` | 中文识别准确率高，RTX 3060 可流畅运行，完全离线 |
| **本地流式** | Paraformer | `paraformer-trilingual` | 边说边出字，延迟低，中英粤三语，适合连续对话 |
| **本地备选** | SenseVoice | `sensevoice-zh-en` | 比 Whisper 快 15 倍，中英双语离线识别 |
| **云端首选** | 智谱 GLM-ASR | `glm-asr-2512` | 中文最佳，支持热词纠正 |
| **云端备选** | 火山引擎 | `bigmodel` | 字节跳动大模型语音识别，中文优秀 |
| **云端备选** | 腾讯云 ASR | `16k_zh` | 实时流式识别，延迟低 |

### 语音输出（TTS）

| 场景 | 推荐提供商 | 推荐音色 | 说明 |
|------|-----------|---------|------|
| **免费首选** | Edge TTS | 晓晓 (`zh-CN-XiaoxiaoNeural`) | 微软免费，音质好，无需 API Key |
| **本地离线** | OmniVoice | 内置音色 | 完全离线，本地端口 8000，RTX 3060 可运行 |
| **最自然** | MiniMax | 少女音色 (`female-shaonv`) | 情感表现力强，适合陪伴角色 |
| **中文指令化** | DashScope Qwen-TTS | `Cherry` | 阿里 Qwen3-TTS，支持方言和指令化播报 |
| **高性价比** | 火山引擎 | 灿灿 (`BV700_streaming`) | 自然度高，价格低 |

---

## 快速开始

**前置要求**：Node.js 22+ · npm 10+

```bash
git clone https://github.com/FanyinLiu/Nexus.git
cd Nexus
npm install
npm run electron:dev
```

构建和打包：

```bash
npm run build
npm run package:win     # 或 package:mac / package:linux
```

---

## 技术栈

| 层级 | 技术 |
|------|------|
| 运行时 | Electron 36 |
| 前端 | React 19 · TypeScript · Vite 8 |
| 角色渲染 | PixiJS · pixi-live2d-display |
| 本地 ML | sherpa-onnx-node · onnxruntime-web · @huggingface/transformers |
| 打包 | electron-builder |

---

## 参与贡献

欢迎各种形式的贡献！无论是修复 Bug、新增功能、翻译还是文档——请随时提交 PR 或在 Issues 中发起讨论。

---

## Star 趋势

<a href="https://star-history.com/#FanyinLiu/Nexus&Date">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=FanyinLiu/Nexus&type=Date&theme=dark" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=FanyinLiu/Nexus&type=Date" />
   <img alt="Star History Chart" src="https://api.star-history.com/svg?repos=FanyinLiu/Nexus&type=Date" />
 </picture>
</a>

---

## 许可证

[MIT](../LICENSE)
