<p align="center"><img src="../public/banner.png" alt="Nexus" width="720" /></p>

<h1 align="center">Nexus</h1>

<p align="center"><b>本地优先的桌面 AI 伙伴，具备记忆、语音、Live2D 和长期关系状态。</b></p>

<p align="center">Nexus 关注的是连续性：伙伴会记住真正重要的事，感知关系如何变化，通过桌宠形态陪在桌面上，并在你明确授权时提供轻量帮助。模型请求由你选择的 provider 承担；记忆、语音编排、工具和安全状态都留在本机。</p>

<p align="center">
  <a href="https://github.com/FanyinLiu/Nexus/releases/latest"><img src="https://img.shields.io/github/v/release/FanyinLiu/Nexus?style=flat-square&color=blue&label=release" alt="Release"></a>
  <a href="https://github.com/FanyinLiu/Nexus/blob/main/LICENSE"><img src="https://img.shields.io/github/license/FanyinLiu/Nexus?style=flat-square" alt="License"></a>
  <a href="https://github.com/FanyinLiu/Nexus/stargazers"><img src="https://img.shields.io/github/stars/FanyinLiu/Nexus?style=flat-square&logo=github" alt="Stars"></a>
  <a href="https://github.com/FanyinLiu/Nexus"><img src="https://img.shields.io/github/last-commit/FanyinLiu/Nexus?style=flat-square" alt="Last Commit"></a>
  <a href="https://github.com/FanyinLiu/Nexus/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/FanyinLiu/Nexus/ci.yml?branch=main&style=flat-square&label=ci" alt="CI"></a>
</p>

<p align="center">
  <a href="../README.md">English</a> · <b>简体中文</b> · <a href="README.zh-TW.md">繁體中文</a> · <a href="README.ja.md">日本語</a> · <a href="README.ko.md">한국어</a>
</p>

<p align="center">
  <a href="https://github.com/FanyinLiu/Nexus/releases/latest"><img src="https://img.shields.io/badge/Windows-Download-0078D4?style=for-the-badge&logo=windows&logoColor=white" alt="Windows"></a>
  <a href="https://github.com/FanyinLiu/Nexus/releases/latest"><img src="https://img.shields.io/badge/macOS-Download-000000?style=for-the-badge&logo=apple&logoColor=white" alt="macOS"></a>
  <a href="https://github.com/FanyinLiu/Nexus/releases/latest"><img src="https://img.shields.io/badge/Linux-Download-FCC624?style=for-the-badge&logo=linux&logoColor=black" alt="Linux"></a>
</p>

> **当前代码版本：** v0.4.2。Nexus 继续保持桌面陪伴感知的粗粒度和隐私优先边界，并把温和 check-in 策略、设置视觉系统和发布前审计继续收紧。正式下载页仍以 GitHub Releases 的最新 tag 为准。

> **开发范围提示：** 这份多语言 README 保留的是长期能力清单。当前短期开发以根目录 [README](../README.md) 和 [Nexus 升级整合计划](NEXUS_UPGRADE_INTEGRATION_PLAN.md) 为准：Phase 1 只收敛桌面常驻小窗口、极简头像、Ollama / DeepSeek 文本模型和简单对话。

---

## 本次更新 — v0.4.2

> **主题：Check-In 策略和发布门禁对齐。** 中文说明见 [RELEASE-NOTES-v0.4.2.zh-CN.md](RELEASE-NOTES-v0.4.2.zh-CN.md)，英文完整说明见 [RELEASE-NOTES-v0.4.2.md](RELEASE-NOTES-v0.4.2.md)。

0.4.2 让温和 check-in 先形成可压制的本地 in-app 决策，而不是直接发消息、执行工具或创建外部通知。正在聊天、刚 dismiss、重复同类信号、过期回到 Nexus 信号都会保持安静；时间表达仍然是粗粒度，不把精确计时或原始桌面内容送进模型。

一句话记住 0.4.2：

- **check-in 决策和发出分开，重复调用不会变成反复打扰。**
- **in-app payload 只是本地短 TTL 数据，不调度计时器、不写持久历史、不调用工具。**
- **设置 UI、发布审计和性能预算继续由 `verify:pr` 与预发布门禁保护。**
- **0.5 才做桌宠跟随鼠标、打字反应和窗口互动。**

## 上次更新 — v0.4.1

> **主题：陪伴 UI、设置和可靠性加固。** 中文说明见 [RELEASE-NOTES-v0.4.1.zh-CN.md](RELEASE-NOTES-v0.4.1.zh-CN.md)，英文完整说明见 [RELEASE-NOTES-v0.4.1.md](RELEASE-NOTES-v0.4.1.md)。

0.4.1 把主对话面板、设置页和 Image4 伙伴场域整理到更清晰的源码结构里，同时新增 UI、隐私、安全和性能审计。设置抽屉继续懒加载，陪伴时间语言继续保持粗粒度，不把精确计时、原始截图、完整剪贴板或私人消息送进模型。

一句话记住 0.4.1：

- **主对话面板、设置页和 Image4 伙伴场域更接近统一视觉系统。**
- **设置抽屉样式保持懒加载，打开设置不再把大段 CSS 塞进 JS 热路径。**
- **时间说法仍然是“一会儿 / 半小时左右 / 一小时左右”，不是精确到分秒。**
- **新增多组 source-only 审计，上传前已跑完整 `verify:pr`。**
- **0.5 才做桌宠跟随鼠标、打字反应和窗口互动。**

## 更早更新 — v0.4.0

> **主题：桌面陪伴感知地基。** 中文说明见 [RELEASE-NOTES-v0.4.0.zh-CN.md](RELEASE-NOTES-v0.4.0.zh-CN.md)，英文完整说明见 [RELEASE-NOTES-v0.4.0.md](RELEASE-NOTES-v0.4.0.md)。

0.4.0 正式开始“打开 Nexus 后，它能安静理解时间流逝”的桌面陪伴感知。它会优先保持安静，只形成短期、粗粒度、可暂停和可清理的陪伴摘要；进入模型的是脱敏摘要，不是原始截图、完整剪贴板、私人消息或精确计时。

一句话记住 0.4.0：

- **Nexus 打开时可以形成短期、粗粒度、可暂停的陪伴摘要。**
- **时间语言保持“一会儿 / 半小时左右 / 一小时左右”，不精确到分秒。**
- **原始截图、完整剪贴板、私人消息和精确计时不会进入模型边界。**
- **0.5 才进入桌宠跟随鼠标、打字反应和窗口互动。**

## 旧版本记录

README 只保留当前代码版本 v0.4.2 和上一稳定入口 v0.4.1 的重点；更早历史版本统一放在 [CHANGELOG](../CHANGELOG.md) 和 [GitHub Releases](https://github.com/FanyinLiu/Nexus/releases)，不在 README 顶部继续滚动维护旧版本号。

---

## 阅读路径

| 你想做什么 | 去哪里 |
|---|---|
| 安装应用 | [下载最新版本](https://github.com/FanyinLiu/Nexus/releases/latest) |
| 理解产品 | [为什么是 Nexus](#为什么是-nexus) · [功能特性](#功能特性) |
| 从源码运行 | [快速开始](#快速开始) |
| 配置模型 | [推荐模型配置](#推荐模型配置) · [支持的提供商](#支持的提供商) |
| 查看安全与隐私 | [安全与援助](#安全与援助) |
| 参与社区内容 | [社区](#社区) · [Community Guide](COMMUNITY.md) |
| 理解 0.4 方向 | [v0.4 Desktop Companion Awareness](V0.4_DESKTOP_COMPANION_AWARENESS.md) |
| 查看 0.4 最新稳定版 | [v0.4.2 Release Notes](RELEASE-NOTES-v0.4.2.md) · [v0.4 Release Hardening](RELEASE-CANDIDATE-v0.4-HARDENING.md) |

## 为什么是 Nexus？

大多数 AI 伙伴都在比拼模型能力、语音拟真或互动频率。Nexus 更关心另一个问题：**一个长期陪伴者应该记住什么，又应该怎样让这段历史改变它的存在方式？**

答案不是一个单点功能，而是一组会累积的小仪式：在合适时机被轻轻提起的旧记忆，每周写下真正发生过什么的一封信，带着情绪重量回来的回忆，以及在沉默更合适时选择沉默的伙伴。

围绕这些仪式，Nexus 提供 5 语言界面、18+ LLM provider、多引擎 STT/TTS 与故障转移、Live2D、VTube Studio 桥接、MCP 工具、本地 Webhook/RSS 通知，以及加固过的 Electron IPC 边界。工程系统是基础；真正的产品，是这些能力在几个月使用后累积出的关系感。

---

## 功能特性

- 🎙️ **常驻唤醒词** — 说出唤醒词即可开始对话，无需按键。基于 sherpa-onnx 关键词检测，主进程 Silero VAD 共享单路麦克风流。

- 🗣️ **连续语音对话** — 多引擎 STT / TTS，回声消除自动打断（说话时不会被自己的声音唤醒），句级流式 TTS（第一个逗号就开始播报）。

- 🧠 **会做梦的记忆** — 热 / 温 / 冷三级记忆架构，BM25 + 向量混合检索。每晚执行*梦境循环*，将对话聚类成*叙事线索*，让伙伴逐渐建立对你的完整认知。

- 💝 **情感记忆 + 关系弧线** — 伙伴会记住每次告别时的*情绪基调*，而不仅仅记住说了什么。5 级关系进化（陌生人 → 认识 → 朋友 → 密友 → 亲密）影响语气、用词和行为边界。记忆持久化到每个人格的 `memory.md` 文件，切换人格不再丢失关系上下文。

- 🎭 **角色卡 + VTube Studio 桥接** — 导入 Character Card v2/v3 格式（兼容 chub.ai / characterhub）。通过 VTube Studio WebSocket 插件 API 驱动外部 Live2D 模型，同时保留 Nexus 的记忆 / 自主行为堆栈。

- 🌤️ **活的场景** — 14 级天气状态、24 小时连续日光滤镜、15 张 AI 生成的 日/黄昏/夜 场景变体。有氛围深度，不是静态壁纸。

- 🤖 **自主内在生活（V2）** — 每个 tick 一次 LLM 决策调用，输入是分层快照（情绪 · 关系 · 节律 · 桌面 · 最近对话），输出过一层人格护栏。不再是模板化发言——它用自己的声音说话，也可以选择不说话。

- 🔧 **工具调用 (MCP)** — 网页搜索、天气查询、提醒任务及任何 MCP 兼容工具。支持原生函数调用，同时为不支持 `tools` 的模型提供提示词模式回退。

- 🔄 **提供商故障转移** — 可串联多个 LLM / STT / TTS 提供商。当某个提供商宕机时，Nexus 自动切换到下一个，对话不中断。

- 🖥️ **桌面感知** — 读取剪贴板、前台窗口标题，以及（可选的）屏幕 OCR。上下文触发器让它能对你正在做的事情作出反应。

- 🔔 **通知桥接** — 本地 Webhook 服务器 + RSS 轮询。将外部通知推送到伙伴的对话中。

- 💬 **多平台** — Discord 和 Telegram 网关，支持按聊天路由。在手机上也能和伙伴对话。

- 🌐 **多语言** — 界面支持简体中文、繁体中文、英语、日语和韩语。

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
| **日常陪伴（首选）** | DeepSeek | `deepseek-v4-flash` | 中文能力强、价格极低，适合长时间陪伴对话 |
| **日常陪伴（备选）** | DashScope Qwen | `qwen-plus` | 阿里通义千问，中文自然，长上下文支持好 |
| **深度推理** | DeepSeek | `deepseek-v4-pro` | 需要复杂推理、数学、代码时使用 |
| **最强综合** | OpenAI | `gpt-5.4` | 综合能力强，工具调用稳定 |
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

## 下载与安装

### 预编译安装包（推荐）

从 [release 页面](https://github.com/FanyinLiu/Nexus/releases/latest) 下载最新安装包：

| 平台 | 文件 |
|---|---|
| Windows | `Nexus-Setup-<版本号>.exe`（NSIS，未签名） |
| macOS | `.dmg` 或 `.zip`（未签名，arm64 + x64 universal） |
| Linux | `.AppImage` / `.deb` / `.tar.gz` |

> **首次启动会看到安全警告，这是正常的。**
> Nexus 的 release 不做代码签名——既没有 Apple Developer 证书，
> 也没有 Windows EV 证书，是有意为之（个人项目，不收费，
> 不承担经常性基础设施开销）。警告的意思是"这个开发者没付
> 签名费"，不是"这是病毒"。源码在 GitHub 公开，每个版本
> 都从公开 CI 构建出来，Linux 安装包还附带 SHA-256 和
> GPG 分离签名，可以独立校验。

#### 未签名安装提示

- **下载来源**：只从 [GitHub Releases](https://github.com/FanyinLiu/Nexus/releases/latest) 下载。不要从镜像或转载压缩包安装；如果你不确定文件来源，删除后重新从 GitHub Releases 下载。
- **macOS / Gatekeeper**：如果系统拦截首次启动，按下面的 macOS 步骤右键打开，或运行 `xattr -dr com.apple.quarantine /Applications/Nexus.app`。
- **Windows / SmartScreen**：如果看到 "Windows 已保护你的电脑"，点击 **"详细信息"**，再点击 **"仍要运行"**。

#### macOS 首次启动

1. 双击 `.dmg`，把 `Nexus.app` 拖到 `/应用程序`。
2. 移除 Gatekeeper 的隔离属性——打开"终端"运行：
   ```bash
   xattr -dr com.apple.quarantine /Applications/Nexus.app
   ```
   （或者：右键点击 Nexus.app → 打开 → 在弹窗中确认。）
3. 启动 Nexus。首次运行会出现 **"安装本地语音模型"** 向导，点
   **一键下载** 把 ~280 MB 的 sherpa-onnx + VAD 模型下载到
   `~/Library/Application Support/Nexus/sherpa-models`。向导可以
   关掉，之后从设置里重新打开。
4. 基于 Python 的选项（OmniVoice TTS / GLM-ASR）会自动检测。
   如果没装 Python + `requirements.txt`，会被静默跳过——核心
   聊天 + SenseVoice STT + Edge TTS 链路依然能用。

#### Windows 首次启动

1. 运行 `Nexus-Setup-<版本号>.exe`。
2. SmartScreen 会显示 **"Windows 已保护你的电脑"**。
3. 点击警告下方的小字 **"详细信息"**，然后点 **"仍要运行"**。
4. 按 NSIS 安装向导继续；首次启动同样会出现本地语音模型向导。

#### Linux 首次启动

- **AppImage**：`chmod +x Nexus-<版本号>.AppImage` 然后双击或在终端运行。Linux 发行版不像 macOS / Windows 那样强制应用级签名，没有警告。
- **.deb**：`sudo dpkg -i Nexus-<版本号>.deb`（或用发行版的包管理器打开）。
- **校验下载**（可选）：每个 release 都附带 `SHA256SUMS` 文件和 `*.AppImage.asc` / `*.deb.asc` GPG 分离签名。从 [release 页面](https://github.com/FanyinLiu/Nexus/releases/latest) 导入公钥，运行 `gpg --verify Nexus-<版本号>.AppImage.asc` 即可确认完整性。

---

## 快速开始

> 这一节是给开发者从源码运行的。普通用户请看上面的"下载与安装"。

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
- [ ] **意图 / 角色 / 授权辅助三层分离** — 将轻量意图判断、角色表达和用户确认后的辅助动作分开。角色层永远看不到工具元数据；辅助结果由伙伴以自己的声音"转述"。
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

社区文档会贯穿所有版本，不只属于某一次发布。0.3 收安全、记忆和设置地基；0.4 会进入桌面陪伴感知；0.5 会进入桌宠桌面行为。社区可以持续贡献文档、人格模板、桌宠包、模型配置菜谱、翻译和 beta 验证报告，让项目变大但不失控。长期入口见 [Community Guide](COMMUNITY.md)，0.4 方向见 [v0.4 Desktop Companion Awareness](V0.4_DESKTOP_COMPANION_AWARENESS.md)，0.4 最新稳定版说明见 [v0.4.2 Release Notes](RELEASE-NOTES-v0.4.2.md)，发布前加固清单见 [v0.4 Release Hardening](RELEASE-CANDIDATE-v0.4-HARDENING.md)。

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

## 安全与援助

Nexus 是 AI 伴侣，不是临床工具。仓库自带一个小型安全层，满足美国加州 **SB 243**（2026-01-01 生效）、纽约州陪伴 AI 法案、以及 **EU AI Act** 严重事件上报条款（2026-08）的要求。

**这一层做什么：**

- **首次启动同意页**——onboarding 第 0 步是只读的"你在和 AI 聊天，不是真人，这不是临床咨询"提示，确认后才进入伴侣设置。点击时间戳记到 `localStorage` 留作审计。
- **聊天中定期提醒**——满足"自上次提醒已发 ≥30 条用户消息 **且** 已过 ≥3 小时墙钟时间"两个条件后，会在聊天里追加一条系统气泡，提醒用户当前在和 AI 对话。双闸确保短时密集和长时低频都不会过度触发。
- **危机话语检测**——当用户输入匹配各 locale 危机模式（"我想死"、"I want to kill myself"、"死にたい" 等）时，一个独立的非角色面板会浮出，列出真人援助热线：
  - **12356** + **800-810-1117**（zh-CN）国家统一线（2025+）+ 北京 24h 热线
  - **988**（en-US）美国自杀与危机生命线，24/7 通话或短信
  - **1925**（zh-TW）卫生福利部 安心专线，24/7
  - **0120-279-338**（ja）よりそいホットライン，24/7 免费
  - **109**（ko）保健福祉部统一自杀预防线（2024+），24/7
- **角色降调**——触发面板的那一轮回复，会通过一段一次性 system prompt 让伴侣留在角色但切换到验证情绪、不开玩笑、不讨论手段、回复简短、温和提到面板的状态。

**这一层不做什么：**

- **危机事件不会上传到任何服务器。** 检测在本地跑，面板在本地渲染，没有任何"谁说了什么"的遥测被传输。
- 不做年龄验证，不做用户画像，不调用任何第三方数据接口。

**代码可以在哪里独立检查：**

| 模块 | 文件 |
|---|---|
| 检测模式 + 各 locale 反义词典 | `src/features/safety/crisisDetect.ts` |
| 热线目录（每条带 `sourceUrl`） | `src/features/safety/hotlines.ts` |
| 热线面板 UI | `src/features/safety/CrisisHotlinePanel.tsx` |
| 角色降调注入 | `src/features/safety/crisisGuidance.ts` |
| 同意 + 定期提醒持久化 | `src/features/safety/disclosureState.ts` 等 |
| 测试 | `tests/safety-*.test.ts` |

每次发版前会对所有热线号码逐条向权威源（国家卫健委 / WHO / IASP / 各部委）重新核验。号码错了等于把求助的人导到空号——这条比其他文档严苛。

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
