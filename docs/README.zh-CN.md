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

- 💝 **情感记忆 + 关系弧线（v0.2.9）** — 伙伴会记住每次告别时的*情绪基调*，而不仅仅记住说了什么。5 级关系进化（陌生人 → 认识 → 朋友 → 密友 → 亲密）影响语气、用词和行为边界。记忆持久化到每个人格的 `memory.md` 文件，切换人格不再丢失关系上下文。

- 🎭 **角色卡 + VTube Studio 桥接（v0.2.9）** — 导入 Character Card v2/v3 格式（兼容 chub.ai / characterhub）。通过 VTube Studio WebSocket 插件 API 驱动外部 Live2D 模型，同时保留 Nexus 的记忆 / 自主行为堆栈。

- 🌤️ **活的场景（v0.2.9）** — 14 级天气状态、24 小时连续日光滤镜、15 张 AI 生成的 日/黄昏/夜 场景变体。有氛围深度，不是静态壁纸。

- 🤖 **自主内在生活（V2）** — 每个 tick 一次 LLM 决策调用，输入是分层快照（情绪 · 关系 · 节律 · 桌面 · 最近对话），输出过一层人格护栏。不再是模板化发言——它用自己的声音说话，也可以选择不说话；v0.2.7 起还可以主动派后台研究子代理帮你查东西。

- 🧰 **子代理派发（v0.2.7）** — 伙伴可以在后台跑一个受限的研究循环（Web 搜索 / MCP 工具），把结果总结后织进下一句回复。容量和日预算可控；默认关闭，`设置` 里打开。

- 🔧 **工具调用 (MCP)** — 网页搜索、天气查询、提醒任务及任何 MCP 兼容工具。支持原生函数调用，同时为不支持 `tools` 的模型提供提示词模式回退。

- 🔄 **提供商故障转移** — 可串联多个 LLM / STT / TTS 提供商。当某个提供商宕机时，Nexus 自动切换到下一个，对话不中断。

- 🖥️ **桌面感知** — 读取剪贴板、前台窗口标题，以及（可选的）屏幕 OCR。上下文触发器让它能对你正在做的事情作出反应。

- 🔔 **通知桥接** — 本地 Webhook 服务器 + RSS 轮询。将外部通知推送到伙伴的对话中。

- 💬 **多平台** — Discord 和 Telegram 网关，支持按聊天路由。在手机上也能和伙伴对话。

- 🌐 **多语言** — 界面支持简体中文、繁体中文、英语、日语和韩语。

---

## 本次更新 — v0.3.0-beta.1

> **预发布版本。** 不会自动推送给 v0.2.9 及以下稳定版用户 —— 需要从
> GitHub Releases 手动下载。下个稳定版 v0.3.0 发布时，beta 用户会
> 自动升级。完整开发者视角说明见
> [RELEASE-NOTES-v0.3.0-beta.1.md](RELEASE-NOTES-v0.3.0-beta.1.md)（英文）。

关系演化 + 情感记忆沿三条独立轴深化：

- **💝 情绪共鸣召回** —— 当前心情影响召回哪些记忆。VAD（valence /
  arousal）投影 + 三种调节模式：匹配（默认）/ 共情（"陪陪我" 触发）/
  修复（"算了 换个话题"、持续严重低落触发）。附带 priming 环形缓冲
  防止情感跳跃。
- **🎯 关系升级仪式 + 重逢增强** —— 第一次跨越 10/30/55/80 分数阈值
  时，触发**一次性**指令让模型"表现出"变化而非"宣告"变化。久别
  重逢时自动引用上次话题 + 情绪，在 close_friend 以上关系且上次
  concern 高时会温柔询问"事情好转了吗"。
- **🌳 关系子维度** —— 单一 score 拆为四个命名维度：trust（信任）/
  vulnerability（脆弱开放）/ playfulness（玩闹默契）/ intellectual
  （思维深度）。每维度从不同类型的对话中生长，有递减增益，长期
  无互动时缓慢衰减。明显偏高 / 偏低时各自注入**具体**提示指令。

**底层改动：** Electron 36 → 41（Node 24 ABI）；93 个新单元测试把
总覆盖从 486 提升到 665；主进程安全加固（CSP 收紧、vault 文件
0o600 权限、子进程 PID 守卫、多处 timer leak 修复）；共享
`driftToward()` / `classifyByPatterns()` 工具去重。

---

## 上一版本 — v0.2.9

> 情感记忆与关系进化是头条 —— 伙伴现在会跟踪你们的关系发展，并记住每次对话的情感。天气与场景系统从零重写，14 种天气状态 + AI 生成场景。角色卡导入、VTube Studio 桥接、全 5 语言 i18n。
>
> 这一块**每次发版都会替换成新版本的说明**，老的内容去 [Releases](https://github.com/FanyinLiu/Nexus/releases) 翻。

### 🧠 情感记忆与关系进化 — 头条

伙伴现在会跨会话携带情感上下文。上次分别时气氛温馨，它就会温暖地接上；你上次很疲惫，它会关心你的状态。五级关系阶段 —— 陌生人 → 熟人 → 朋友 → 密友 → 亲密 —— 影响伙伴的语气、用词风格和行为边界。进化是隐式的，由累积互动驱动，没有可见的进度条。

离线感知：伙伴会注意到你离开了多久。短暂离开会收到温柔的欢迎；长时间不在会引发真正的好奇（"你去哪了？"）。对话记忆现在持久化到每个角色的 `memory.md` 文件，跨会话不丢失。

### 🌦️ 天气与场景系统重写

旧天气挂件被替换为完整的大气系统：

- **14 种强度分级天气状态**，带全场景视觉效果 —— 天空色调、密集粒子层、发光的雨雪。
- **连续日光系统**，亮度 / 饱和度 / 色相滤镜。真正的夜晚、细腻的白天色阶 —— 不只是"白天"和"黑夜"。
- **15 张 AI 生成动漫场景**（5 地点 × 日 / 黄昏 / 夜），手工编写提示词以保证视觉一致性。
- **14 态宠物时间预览**，可锁定到当前时刻查看各天气效果。
- **多语言天气地点解析**，基于 Nominatim 地理编码 —— 用任何语言输入城市名。

### 📇 角色卡导入

支持导入 Character Card v2 / v3 格式（PNG 内嵌 + JSON）—— 兼容 chub.ai、characterhub 等社区的角色卡。在 设置 → 角色 里拖入 `.png` 卡片文件即可自动填充角色信息。

### 🎭 VTube Studio 桥接

通过 WebSocket 驱动 VTube Studio 中的外部 Live2D 模型。伙伴的情感状态实时同步到 VTS 模型的表情和动作。

### 🌐 全面 i18n

所有 UI 界面现在支持 5 种语言（EN / ZH-CN / ZH-TW / JA / KO）的完整翻译：设置、对话、引导、语音栈、系统提示词、错误信息和数据注册表。设置里提供地球图标 + 弹出式语言切换器。

### 🐾 宠物系统增强

- **内联表情覆盖**：伙伴可以在回复中写 `[expr:name]` 标签，在说话过程中触发特定 Live2D 表情。
- **扩展触摸反应池** —— 戳角色时有更多样的反应。
- **按模型加权的待机小动作** —— 不同角色的待机动画各有风格。
- **鼠标拖拽调整**宠物角色窗口大小。
- **13 种精细宠物心情状态**，驱动表情选择。

### 🔧 其他改进和修复

- Lorebook 语义混合检索，在关键词匹配之上增加向量搜索。
- 用户可配置的正则表达式对 LLM 回复做变换。
- 引导语音步骤新增本地语音模型健康状态条。
- Sherpa 模型打包进 Mac + Linux 安装包。
- 修复跨窗口 BroadcastChannel 同步保存循环和消息覆盖。
- 修复运行时状态桥自馈渲染风暴。
- 修复 TTS 超时渲染风暴。
- 修复唤醒词瞬态设备错误被当作永久错误处理。
- 删除 Autonomy V1 代码（Phase 6 清理）。

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
| 运行时 | Electron 41 |
| 前端 | React 19 · TypeScript · Vite 8 |
| 角色渲染 | PixiJS · pixi-live2d-display |
| 本地 ML | sherpa-onnx-node · onnxruntime-web · @huggingface/transformers |
| 打包 | electron-builder |

---

## 开发路线

### 待升级

- [ ] **屏幕感知主动对话** — 定期读取屏幕上下文（前台应用、可见文本），主动发起与你正在做的事相关的对话，而不仅仅是被动回应。
- [ ] **决策 / 角色扮演 / Agent 三层分离** — 将意图分类（快速）、角色扮演（保持人设纯净）和后台 Agent 任务分开。角色扮演层永远看不到工具元数据；Agent 结果由角色以自己的声音"转述"。
- [ ] **角色日记与自主时间线** — 伙伴每天自动生成第一人称日记，记录当天发生了什么；可选发布"动态"到可浏览的时间线，营造独立生活的感觉。
- [ ] **日程表与活动状态** — 伙伴遵循日常作息（工作 / 吃饭 / 睡觉 / 通勤），影响可用性、语气和精力。深夜对话和早晨对话感觉不同。
- [ ] **Mini 模式 / 停靠隐藏** — 把角色拖到屏幕边缘，自动隐藏并在悬停时探头。"一直在，但不打扰。"
- [ ] **摄像头感知** — 使用 MediaPipe 面部网格检测疲劳信号（打哈欠、闭眼、皱眉），注入伙伴的上下文，让它能主动关心你的状态。

### 进行中

- [ ] Pipecat 风格帧管线替换单体流式 TTS 控制器（Phase 2-6；Phase 1 已在 v0.2.4 发布）。
- [ ] 通过 electron-updater + 签名二进制实现自动更新。
- [ ] 移动端伴侣应用（桌面实例的纯语音遥控器）。

---

## 社区

Nexus 目前由个人维护，issue 和 PR 的处理速度取决于分流是否精准：

- 🐛 **发现 Bug？** → [Bug 报告](https://github.com/FanyinLiu/Nexus/issues/new?template=bug_report.yml)
- 💡 **有明确的功能想法？** → [功能请求](https://github.com/FanyinLiu/Nexus/issues/new?template=feature_request.yml)
- 🧠 **更大或开放性的想法？** → 先到 [Ideas 讨论](https://github.com/FanyinLiu/Nexus/discussions/categories/ideas)，让大家一起评估
- ❓ **安装或使用遇到问题？** → [Q&A](https://github.com/FanyinLiu/Nexus/discussions/categories/q-a)
- 🎨 **想分享你的使用方式？** → [Show and tell](https://github.com/FanyinLiu/Nexus/discussions/categories/show-and-tell)
- 💬 **随便聊聊？** → [General](https://github.com/FanyinLiu/Nexus/discussions/categories/general)
- 📣 **版本发布和路线更新** → [Announcements](https://github.com/FanyinLiu/Nexus/discussions/categories/announcements)

---

## 参与贡献

欢迎各种形式的贡献——Bug 修复、新 Provider、UI 调整、翻译、Live2D 模型或新的自主行为。哪怕一句话的 issue 或一个 typo 修复的 PR 也能推动项目前进。

快速入门：

- 阅读完整的 [**贡献指南**](../CONTRIBUTING.md) 了解开发环境、项目结构、代码规范和 PR 流程。
- 使用 [issue 模板](https://github.com/FanyinLiu/Nexus/issues/new/choose) 提交 Bug 和功能请求——统一的格式有助于快速分流。
- 推送前运行 `npm run verify:release`（lint + 测试 + 构建）——这正是 CI 运行的流程。
- 提交信息遵循 [Conventional Commits](https://www.conventionalcommits.org/)：`feat:`、`fix:`、`docs:`、`refactor:` 等。
- 每个 PR 只做一件事。不相关的修复请拆分为单独的 PR。

所有参与受 [行为准则](../CODE_OF_CONDUCT.md) 约束——简而言之：**善待他人，假设善意，专注于工作**。

### 安全问题

如果你发现安全漏洞，请**不要**公开提交 issue。请通过 [私有安全咨询](https://github.com/FanyinLiu/Nexus/security/advisories/new) 报告。

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
