<p align="center"><img src="../public/banner.png" alt="Nexus" width="720" /></p>

<h1 align="center">Nexus</h1>

<p align="center"><b>本地优先的桌面 AI 伙伴，具备记忆、语音、Live2D 和长期关系状态。</b></p>

<p align="center">Nexus 关注的是连续性：伙伴会记住真正重要的事，感知关系如何变化，通过桌宠形态陪在桌面上，也能帮你处理一些轻量后台任务。模型请求由你选择的 provider 承担；记忆、语音编排、工具和安全状态都留在本机。</p>

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

> **当前版本：** v0.3.1 稳定版（2026-04-28）。Nexus 现在已经可日常使用，但仍是快速迭代中的个人项目；打包、本地语音模型和 provider 配置上可能还有锋利边缘。

---

## 阅读路径

| 你想做什么 | 去哪里 |
|---|---|
| 安装应用 | [下载最新版本](https://github.com/FanyinLiu/Nexus/releases/latest) |
| 理解产品 | [为什么是 Nexus](#为什么是-nexus) · [功能特性](#功能特性) |
| 从源码运行 | [快速开始](#快速开始) |
| 配置模型 | [推荐模型配置](#推荐模型配置) · [支持的提供商](#支持的提供商) |
| 查看安全与隐私 | [安全与援助](#安全与援助) |

## 为什么是 Nexus？

大多数 AI 伙伴都在比拼模型能力、语音拟真或互动频率。Nexus 更关心另一个问题：**一个长期陪伴者应该记住什么，又应该怎样让这段历史改变它的存在方式？**

答案不是一个单点功能，而是一组会累积的小仪式：在合适时机被轻轻提起的旧记忆，每周写下真正发生过什么的一封信，带着情绪重量回来的回忆，以及在沉默更合适时选择沉默的伙伴。

围绕这些仪式，Nexus 提供 5 语言界面、18+ LLM provider、多引擎 STT/TTS 与故障转移、Live2D、VTube Studio 桥接、MCP 工具、本地 Webhook/RSS 通知，以及加固过的 Electron IPC 边界。工程系统是基础；真正的产品，是这些能力在几个月使用后累积出的关系感。

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

## 本次更新 — v0.3.1（稳定版，2026-04-28）

> **情感主线 + 安全审计累积版。** 自 v0.3.0 起 92 个 commit；beta.1 → beta.5 在稳定版前分别关闭了一类问题。完整说明见 [RELEASE-NOTES-v0.3.1.md](RELEASE-NOTES-v0.3.1.md)（英文）。

| 主题 | 落地内容 |
|---|---|
| **🧠 伴侣的语气会自适应** | 14 天长窗口 + 3 天短窗口的情绪基线接进每条回复：低落卡住时少建议多承接；急性下落时节奏放慢；起伏剧烈时不主动带话题；稳定温暖时跟节奏。Russell 1980 + Kuppens 2015 + Trull 2008。 |
| **💔 Gottman 鲁莽 / 修复** | 自动检测批评 / 轻蔑 / 防御 / 筑墙四种 Horsemen；下一轮注入 soft start-up + accept influence 修复姿态。**全程默默改变，不弹任何"我看到你这个状态"的提示**。 |
| **🔒 两个 critical CVE 清零** | `pixi-live2d-display` 误把 `gh-pages` 放进 runtime deps（原型污染）；`npm overrides` 强制升级到无 CVE 版本。 |
| **🛡️ IPC 安全审计 6/7 HIGH 关闭** | H2/H3/H5/H6/H7/H8 + M1/M2/M3/M5 + L3/L4/L6 全部修复，H4 按设计 deferred 到 v1.0。 |
| **🐛 30+ 静态 bug 修复** | 四轮 audit + 并行 agent 静态扫描；template-replace `$&` 漏洞、并发竞态、StrictMode 纯净化、NaN 守卫、async leak、storage 验证。 |
| **🚦 发版前检查扩到 26 项** | `prerelease-check.mjs` 从 8 项扩到 6 stage / 26 check：流程 / 代码质量 / 安全 / 资产 / 文档合规 / 隐私治理。 |
| **🧹 UI 精简** | 信件 / 时光胶囊 / 小事 / 还没收的线 / 心情地图 5 个 settings panel 从抽屉收回（底层 scheduler 仍在跑）。"伴侣的情感适应应该是用户感受到的，不是去配置的"。 |

<details>
<summary>本稳定版包含的 v0.3.1-beta 线</summary>

- **beta.1** — 安装包瘦身（1.2 GB → 250 MB）
- **beta.2** — IPC 安全 hardening（H5 / H8 / H4 缓解）
- **beta.3** — Live2D / thinking-mode / TTS / 多模态 4 个回归修复
- **beta.4** — 审计 + 打磨（compaction race、ja/ko 翻译）
- **beta.5** — 情感主线 M1.4-1.7 + 多日 Arc + yearbook 导出

</details>

---

## 上一稳定版 — v0.3.0

> **稳定版发布。** v0.2.9 → v0.3.0 累计 100+ commit、约 12,000 行变更、
> +361 个单元测试。所有变更都向后兼容，旧数据自动迁移。完整开发者视角说明见
> [RELEASE-NOTES-v0.3.0.md](RELEASE-NOTES-v0.3.0.md)（英文）。

| 主题 | 落地内容 |
|---|---|
| **🧠 记忆开始做事** | 显著性加权召回；dream cycle 生成 1–3 条关于你的反思；callback 队列（下次聊天温柔提一个旧记忆）；30 / 100 / 365 天周年里程碑。 |
| **💝 关系有了形状** | 心情感知召回（3 种模式）；五级里程碑首次跨越触发；四维子分数；重逢 framing 更丰富。 |
| **🤝 关系有了类型** | onboarding 与设置里选择 *开放 / 朋友 / 导师 / 安静的陪伴*，单行偏置 system prompt 而不覆盖 `SOUL.md`。 |
| **💭 "想着你" 通知** | 长时间无聊天时，按你设的关系类型推送系统通知。23–08 点静默不打扰。 |
| **🎬 角落里的存在感** | autonomy V2 第 4 个 action（`idle_motion` 静默手势）；动态 cadence；早期回复中的好奇追问。 |
| **🌅 平滑场景过渡** | 早 5–7 / 16–18 / 19–21 三个 2 小时过渡窗，smoothstep 缓动；色彩对比拉强 —— 黎明粉、金时刻深琥珀、深夜冷淡蓝。 |
| **🪟 Liquid Glass UI** | 紫色 accent 重塑；工具栏整理；时间感知 emoji 招呼；窗口大小 / 位置跨启动持久化。 |
| **🌤️ 天气更精准** | 小时级预报、体感温度 + 湿度、后天预报。 |
| **🧹 工程精简** | i18n.ts 1842 → 588 行；共享 SettingsField 组件；正则编译缓存；async-lock 去重；安装包瘦身约 30–60 MB。 |

<details>
<summary>已折叠到本稳定版的 beta 线</summary>

beta 线奠定了基础，本稳定版做最后打磨：

- **v0.3.0-beta.1** —— 三轴关系系统：心情感知召回（VAD 投影 + 共情 / 修复 / 强化模式）、一次性升级指令、四维子分数。[Notes](RELEASE-NOTES-v0.3.0-beta.1.md)
- **v0.3.0-beta.2** —— 稳定 + 留存批次：显著性记忆、dream-cycle reflection、callback queue、周年里程碑、idle motion、动态 cadence、Liquid Glass UI、天气精度、托盘 + dock 图标、7 项安全修复。[Notes](RELEASE-NOTES-v0.3.0-beta.2.md)

</details>

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
