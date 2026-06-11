# Nexus × OpenClaw × Hermes Agent 对比调研

> 调研日期：2026-06-11。两路并行调研（OpenClaw 官方 docs/GitHub/安全报告；Hermes 消歧+官方 docs/GitHub API 实测），来源 URL 见各节。
> 结论先行：**它们不是竞品，是邻居**——基础设施层高度同构（验证了 Nexus 的方向），体验层正好相反（Nexus 的护城河它们都没碰）。

## 0. 一句话定位

| 项目 | 本质 | 体量（2026-06-11 实测） |
|---|---|---|
| OpenClaw（P. Steinberger → OpenAI；项目归独立基金会，MIT） | 无头 daemon："住在你聊天软件里的 24/7 数字雇员"；20+ 渠道网关 + agent 运行时（内嵌 Pi SDK，多 harness 可换） | 378k stars / 79k forks / Discord 17.6 万 |
| Hermes Agent（Nous Research，MIT） | 无头 Python 运行时："会自己写操作手册的助理"——干完活自我复盘生成 SKILL.md | 190k stars / 33k forks / v0.16.0 (06-06) |
| Nexus | Electron 桌面 GUI 本体：情绪/关系/梦境/形象第一方核心，聊天桥是配角 | — |

## 1. 同构点（独立收敛，验证方向）

1. **人格文件都叫 SOUL.md**（三家撞名）；OpenClaw 是多文件 bootstrap（SOUL/IDENTITY/USER/AGENTS/TOOLS/MEMORY/HEARTBEAT，与 Klein 的 per-persona 多文件偏好一致）；Hermes 的 SOUL.md 占 system prompt 第 1 槽位。
2. **OpenClaw 官方有 Dreaming**：夜间 cron 三阶段 Light→REM→Deep，Deep 阶段六维打分晋升进 MEMORY.md + 叙事 Dream Diary——与 Nexus 做梦固化几乎同一概念，但默认关、定位为记忆机制而非人格表达。
3. **记忆形态**：MEMORY.md 长期 + daily notes + 混合检索（向量+关键词）↔ Nexus 分类长期记忆 + 每日日记 + 混合检索。Hermes 反向：**有界记忆**（agent 记忆 2,200 字符 / 用户画像 1,375 字符硬上限，强制取舍）——与 Nexus hot-tier 3500 字符上限异曲同工。
4. **单用户假设 + 回复确定性回源**：OpenClaw DM 全并入主 session、"模型无权选渠道"靠 lastRoute 回源 ↔ Nexus 的"inbound 注入唯一伴侣对话 + 回复路由回原渠道"（独立收敛于同一设计）。
5. **语音双向**：OpenClaw STT fallback 链（本地 sherpa-onnx/whisper → 云兜底）+ 14 TTS provider + Telegram/WhatsApp 原生 Opus 语音条 ↔ Nexus 的本地+云语音栈 + 语音条回信。
6. **主动行为**：OpenClaw heartbeat（默认 30min，读 HEARTBEAT.md 清单）+ 内置 cron ↔ Nexus 自主引擎 tick。

## 2. 根本差异（= Nexus 的护城河确认）

- **形态相反**：两家都是 headless daemon，GUI 是配角；Nexus 桌面 GUI 是本体。
- **情感维度空白**：OpenClaw 官方无情绪引擎/关系状态/形象层——全是社区第三方在补（"AI 女友" Clawra 60 万+观看、Pixel Lobster 桌面像素龙虾、emotion skills）；商业陪伴服务 Claw Friend 卖的正是 Nexus 第一方就有的东西。Hermes 的人格只是"沟通风格配置"（13 个 /personality 预设含 kawaii/catgirl），无情绪演化、无形象、无实时语音对话。
- **能力面取向**：OpenClaw 给 agent 完整 shell/文件系统（"actually does things"——也正是它安全风波的根源）；Hermes 自我改进技能回路；Nexus 以对话陪伴为中心。
- 结论与 2026-06-07 竞品审计一致：**陪伴×主动性×桌面感知的组合仍无人同时具备，别追广度。**

## 3. 可借鉴清单（按价值排序）

1. **OpenClaw 安全事故当体检表**（最紧迫，全套先例）：
   - 默认无鉴权 + 绑 0.0.0.0 → 公网暴露 4 万+ 实例（SecurityScorecard/Bitsight 测绘）
   - **ClawJacked**（Oasis Security）：恶意网页 JS 暴破 localhost 网关 WS（rate limiter 豁免 localhost）→ 注册可信设备 → 整机接管。**对 Nexus webhook(127.0.0.1:47830) 直接相关：本机 ≠ 可信，浏览器里任何网页都能打 localhost**——复核 Bearer 常数时间比对 + 限速不豁免 localhost
   - Vidar infostealer 专偷 gateway token + SOUL.md/记忆文件（Nexus 密钥在 vault ✅，但 SOUL.md/记忆明文是同类目标）
   - 事后加固基线：loopback 默认 + 强制 token + 配置目录 700/600
2. **配对码完整参数**（Phase 2 照抄）：6 位一次性码、1h 过期、每渠道最多 3 个待批、桌面端批准落数字 ID allowlist；dmPolicy 四模式（pairing 默认/allowlist/open 须显式 `*`/disabled）。
3. **语音回信 `inbound` 模式**："收到语音才回语音，收到文字回文字"——比纯开关更有对话直觉；Nexus 桥已识别 voice media 类型，小增量。
4. **HEARTBEAT_OK 静默剥离**：主动检查回合 agent 没事回哨兵词、被系统吞掉——自主引擎"无事不发声"的机制化做法。
5. **identityLinks 跨渠道并人**：会话分渠道、身份显式合并、记忆全局——与升级计划里 Chatwoot 模型一致，OpenClaw 是落地参照。
6. **Piper 本地 TTS**（Hermes 用）：CPU 跑、44 语言、免 key——给 Nexus 补"零配置免费"档，语音回信不产生按字符计费。
7. **渠道协议参考**：两家都接了钉钉/企微/飞书/QQ，后续接国内渠道时是现成 adapter 参考实现；OpenClaw 的声明式 channel plugin SDK（security/pairing/threading/outbound 各自声明 + 共享归一管线）是 Phase 2 ChannelAdapter 的进阶参照。
8. **不学**：headless 化、shell/文件系统全权、20+ 渠道广度。

## 4. 主要来源

- OpenClaw: https://docs.openclaw.ai/ (concepts/soul, /dreaming, /session, /memory; gateway/security, /heartbeat; plugins/sdk-channel-plugins; tools/skills, /tts) ・ https://github.com/openclaw/openclaw ・ https://www.oasis.security/blog/openclaw-vulnerability (ClawJacked) ・ https://www.infosecurity-magazine.com/news/researchers-40000-exposed-openclaw/ ・ https://thehackernews.com/2026/02/infostealer-steals-openclaw-ai-agent.html ・ https://steipete.me/posts/2026/openclaw ・ https://lexfridman.com/peter-steinberger-transcript/
- Hermes: https://github.com/NousResearch/hermes-agent ・ https://hermes-agent.nousresearch.com/docs/user-guide/features/personality ・ …/tts ・ https://trilogyai.substack.com/p/technical-deep-dive-hermes-vs-openclaw ・ https://composio.dev/content/openclaw-vs-hermes-agent
- 存疑标注：OpenClaw 贡献者数/周增速为单一第三方统计；CVE 细节未逐项 NVD 核验；"内嵌 Pi SDK"措辞来自第三方深文（官方仅致谢 pi-mono）。
