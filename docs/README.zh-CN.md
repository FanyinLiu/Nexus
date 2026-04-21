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
  <a href="../README.md">English</a> · <b>简体中文</b> · <a href="README.zh-TW.md">繁體中文</a> · <a href="README.ja.md">日本語</a> · <a href="README.ko.md">한국어</a>
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

- 🤖 **自主内在生活（V2）** — 每个 tick 一次 LLM 决策调用，输入是分层快照（情绪 · 关系 · 节律 · 桌面 · 最近对话），输出过一层人格护栏。不再是模板化发言——它用自己的声音说话，也可以选择不说话；v0.2.7 开始还可以主动派后台研究子代理帮你查东西。

- 🧰 **子代理派发（v0.2.7）** — 伙伴可以在后台跑一个受限的研究循环（Web 搜索 / MCP 工具），把结果总结后织进下一句回复。容量和日预算可控；默认关闭，`设置` 里打开。详见 [本次更新说明](#本次更新--v027)。

- 🔧 **工具调用 (MCP)** — 网页搜索、天气查询、提醒任务及任何 MCP 兼容工具。支持原生函数调用，同时为不支持 `tools` 的模型提供提示词模式回退。

- 🔄 **提供商故障转移** — 可串联多个 LLM / STT / TTS 提供商。当某个提供商宕机时，Nexus 自动切换到下一个，对话不中断。

- 🖥️ **桌面感知** — 读取剪贴板、前台窗口标题，以及（可选的）屏幕 OCR。上下文触发器让它能对你正在做的事情作出反应。

- 🔔 **通知桥接** — 本地 Webhook 服务器 + RSS 轮询。将外部通知推送到伙伴的对话中。

- 💬 **多平台** — Discord 和 Telegram 网关，支持按聊天路由。在手机上也能和伙伴对话。

- 🌐 **多语言** — 界面支持简体中文、繁体中文、英语、日语和韩语。

---

## 本次更新 — v0.2.7

> 子代理派发是头条；语音打断升级成"随时都能打断"（包括打字触发的 TTS）；修复了一个让语音消息在聊天面板里看不见的渲染风暴 Bug。
>
> 这一块**每次发版都会替换成新版本的说明**，老的内容去 [Releases](https://github.com/FanyinLiu/Nexus/releases) 翻。

### 🧰 子代理派发 — 头条

> **一句话版本** — 伙伴现在可以在后台跑一个受限的研究子代理（Web 搜索 / MCP 工具），把结果织进下一句回复。两种入口：自主引擎可以用 `spawn` 替代 `speak`；主聊天 LLM 也能通过 `spawn_subagent` 工具在回答过程中调用。状态会用一条浮在消息列表上方的条显示；完成后总结会被主 LLM 编进最终回复里。默认关闭，用户自行开启。

开启方式：

```
设置 → Subagents → Enable
  maxConcurrent:    1–3（硬上限 3）
  perTaskBudgetUsd: 每个任务的软上限
  dailyBudgetUsd:   当日所有任务累计软上限
  modelOverride:    可选 —— 把研究指向更便宜的模型
```

三级模型回退：`subagentSettings.modelOverride → autonomyModelV2 → settings.model`。所以可以把研究路径指向一个小的快模型（Haiku / Flash / 便宜的 OpenRouter 入口），主对话继续用你原本的配置。

决策引擎集成：自主 prompt 每次 tick 都会看到实时的 `subagentAvailability`（开关 + 当前占用 + 今日剩余预算），只有门开着的时候才会把 `spawn` 动作暴露给 LLM。LLM 选择 `spawn` 时，orchestrator 可以选择先走一遍短句播报（"让我查一下"）通过正常 TTS 路径，**同时**派发研究 —— 没有串行等待。

聊天工具集成：开启子代理时，`spawn_subagent` 会被加入主 LLM 的工具列表。该工具调用会阻塞一个研究回合（通常 10-30 秒）后返回摘要，主 LLM 把它织进最终回复。用户全程能看到实时状态条，等待不是静默的。

UI：`SubagentTaskStrip` 以玻璃拟态的薄片形式显示在消息列表顶部，带一个脉冲指示点显示"排队中 / 正在处理"。完成的任务不在这里显示 —— 它们的总结会作为普通对话气泡出现。失败任务会保留 60 秒以便看清原因。

源码位置：`src/features/autonomy/subagents/`（`subagentRuntime.ts` 状态机、`subagentDispatcher.ts` LLM 循环、`spawnSubagentTool.ts` + `dispatcherRegistry.ts` 桥接 chat、`src/components/SubagentTaskStrip.tsx` UI）。六个单元测试覆盖 runtime 状态机（admit / budget / concurrency / onChange）。

### 🎙️ 随时都能打断

之前：语音打断 monitor 只在当前回合来自连续语音会话时启动。打字触发的 TTS 播报不可打断 —— 这不合理，你既然能对伙伴说话，就应该能在它说话时插入。

- 只要开了 `voiceInterruptionEnabled`，**任何** TTS 播放期间 monitor 都会启动，不再局限于语音来源的回合。
- 当唤醒词 listener 已在运行时，monitor 现在通过 `subscribeMicFrames` **复用**它的麦克风帧，不再开第二路 `getUserMedia`。macOS 偶尔会把两路默认输入串行化产生间歇性静音 —— KWS 开着时默认走复用路径。
- 打断成功后，非唤醒词模式会强制重启 VAD 捕获你的继续发言，不用重新唤醒。唤醒词 + 常驻 KWS 模式保持原行为（让 KWS 自己重新接管 —— 强制开第二路 VAD 会和 listener 抢麦）。

### 🐛 渲染风暴 + 跨窗口同步

头条 Bug 其实藏得很深，分两层。

**渲染风暴**：父组件每次 render 都会给 `useChat` / `useMemory` / `usePetBehavior` / `useVoice` 的消费者递一个新的字面量对象。下游 memo（`chatWithAutonomy` / `petView` / `overlays` / `panelView`）每次 render 都失效，连锁触发子组件的 useEffect 回写 state —— 经典"Maximum update depth exceeded"循环。肉眼可见的症状：对话完成那一刻日志疯狂刷屏；第二句 STT 卡住是因为 renderer 被饿死，VAD 的 `speech_end` 回调进不了 microtask 队列。修复：每个 hook 返回值都包 useMemo；`useVoice` 里明确把 `lifecycle.*` / `bindings.*` / `testEntries.*` 从 deps 里剥离（这些 factory 每次 render 重建，但内部都走稳定 refs，旧引用调用起来也能拿到最新实现）。

**跨窗口同步**：pet 窗口和聊天面板是两个独立的 Electron renderer，各有独立的 React state。它们通过 localStorage 的 `storage` 事件在 `CHAT_STORAGE_KEY`（`nexus:chat`）上同步对话。但 `useChat` 的保存 effect 只调了 `upsertChatSession`，这个函数写的是 `CHAT_SESSIONS_STORAGE_KEY`（`nexus:chat-sessions`）—— `nexus:chat` 从来没人写。结果：pet 窗口里发生的语音回合（setMessages 都在 pet 里）永远不会被面板窗口看到。修复：`useChat` 保存 effect 里同时调 `saveChatMessages(messages)`，真的去写面板监听的那个 key。

### 🔧 启动期修复

- **Silero VAD 现在真的能跑了**。`browserVad.ts` 把 `onnxWASMBasePath` 指向 `public/vendor/ort/`，但这个目录**从来不存在** —— `setup-vendor.mjs` 只复制 Live2D 相关资源。没有 ORT runtime，vad-web 回退到 CJS `require()`，Vite 的 ESM 环境下直接失败，整条 Silero 路径降级到 legacy 录音兜底。现在 `setup-vendor.mjs` 在 postinstall 里把 vad-web 需要的四个 wasm + mjs bundle 从 `node_modules` 复制过来。
- **`mcp:sync-servers` 处理器现在急加载**。这个处理器之前是 deferred 加载（app-ready 之后 1.5 秒），但 `useMcpServerSync` 在首次 render 就调用，竞争到还没注册 → "No handler registered"。`sherpaIpc` / `notificationIpc` 之前就因为同样问题被挪出过 deferred 列表；`mcpIpc` 这次一起挪进 eager 路径。

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

## 开发路线

### 待升级

- [ ] **屏幕感知主动对话** — 定期读取屏幕上下文（前台应用、可见文本），主动发起与你正在做的事相关的���话，而不仅仅是被动回应。
- [ ] **决策 / 角色扮演 / Agent 三层分离** — 将意图分类（快速）、角色扮演（保持人设纯净）和后台 Agent 任务分开。角色扮演层永远看不到工具元数据；Agent 结果由角色以自己的声音"转述"。
- [ ] **角色日记与自主时间线** — 伙伴每天自动生成第一人称日记，记录当天发生了什么；可选发布"动态"到可浏览的���间线，营造独立生活的感觉。
- [ ] **日程表与活动状态** — 伙伴遵循日常作息（工作 / 吃饭 / 睡觉 / 通勤），影响可用性、语气和精力。深夜对话和早晨对话感觉不同。
- [ ] **Mini 模式 / 停靠隐藏** — 把角色拖到屏幕边缘，自动隐藏并在悬停时探头。"一直在，但不打扰。"
- [ ] **摄像头感知** — 使用 MediaPipe 面部网格检测疲劳信号（打哈欠、闭眼、皱眉），注入伙伴的上下文，让它能主动关心你的状态。

### 进行中

- [ ] Pipecat 风格帧管线替换单体流式 TTS 控制器（Phase 2-6；Phase 1 已在 v0.2.4 发布）。
- [ ] 通过 electron-updater + 签名二进制实现自动更新。
- [ ] 移动端伴侣应用（桌面实例的纯语音遥控器）。

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
