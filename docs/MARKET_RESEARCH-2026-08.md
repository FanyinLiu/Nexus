# AI 桌面伴侣/桌宠赛道调研报告（2026-08-03）

调研范围：GitHub 上与 Nexus（本地优先 AI 桌面伙伴：桌宠形象 + 自然对话 + 长期记忆 + 授权辅助）
定位相似的开源项目。数据来自 GitHub API（star/fork/许可证/更新频率）与源码级架构分析
（yoji、ackem、my-neuro 已 clone 检查）。

## 一、赛道格局

AI 桌面伴侣正在升温：头部项目 13.7k star，多个 500+ star 项目保持周级更新。
按定位分两个方向：

| 方向 | 代表项目 | 核心诉求 |
|---|---|---|
| **A. 陪伴/助理向** | yoji、ackem、hermes-desktop、Cyrene-Agent、Mutsumi | 常驻桌面的 AI 伙伴：情绪、记忆、语音、工具扩展 |
| **B. 角色扮演/桌宠向** | Soul-of-Waifu、my-neuro、LingChat、AI-YinMei、ZcChat | Live2D 表现力、角色自定义、Galgame 叙事 |

Nexus 属于 A 方向，且是 A 中"克制陪伴 + 授权辅助"路线的少数派：
多数 A 方向项目是 agent 操作台（hermes-desktop）或高交互话痨式伴侣（yoji/ackem）。

## 二、竞品矩阵

### A 方向（同赛道）

| 项目 | ⭐ | 许可 | 技术栈 | 最近更新 | 定位 |
|---|---|---|---|---|---|
| **hermes-desktop** | 13.7k | MIT | Electron + TS | 2026-07 | Hermes Agent 桌面控制台（agent 面板，非桌宠） |
| **yoji** | 593 | MIT | Electron 39 + React 19 + Vite 7 + LangChain | 2026-07（周更，v1.6.0） | 有情绪的桌面伴侣：隐私优先、语音唤醒、MCP、子 Agent |
| **ackem** | 468 | AGPL-3.0 | Electron 33 + React 18 + Vite 5 + SQLite | 2026-07 | 本地优先陪伴：七系统架构（脑/心/口/神经/扩展/时间） |
| **Cyrene-Agent** | 344 | — | TypeScript | — | 沉浸式聊天 + 个人助理 |
| **Mutsumi** | 172 | — | Tauri 2 + Rust | — | 轻量全局快捷键伴侣 |

### B 方向（表现力参考）

| 项目 | ⭐ | 许可 | 技术栈 | 定位 |
|---|---|---|---|---|
| **handcrafted-persona-engine** | 1.3k | 无 | C# | Live2D + LLM + ASR + TTS + RVC 头像引擎 |
| **my-neuro** | 1.3k | MIT | Python | 类 Neuro-sama 桌宠：Live2D + 双模型 + 记忆服务 |
| **Soul-of-Waifu** | 1.0k | GPL-3.0 | Python | 角色扮演三模式（Soul Memory 认知架构 / 桌游 GM / 桌面伴侣+MCP） |
| **LingChat** | 1.1k | AGPL-3.0 | Rust | Galgame 风格对话 + 情绪表情 + 桌宠 + 日程 |
| **AI-YinMei** | 951 | BSD-2 | Python | Vtuber 桌宠智能体（直播向） |
| **ZcChat** | 555 | GPL-3.0 | C++ | Galgame 效果桌宠 |
| **Loyal-Elephie** | 352 | MIT | Python | 记忆增强 RAG 聊天（本地 LLM） |

## 三、重点竞品架构分析

### 1. yoji（最相似，593 ⭐，周更）

- **规模**：109 个 TS 文件（Nexus 约 973 个，Nexus 复杂度约为其 9 倍）
- **架构**：Electron main 进程内 agent 层（40 文件）：emotion / mcp / skills / tools / task-monitor / children-agent / wechat-connect
- **情绪**：`emotion_model.ts` + `emotion-prompt.ts` + `schema.ts`——"激素情绪系统"（多轴情绪值 + 情绪参与 prompt）
- **记忆**：混合检索 + 向量搜索（`search-memories.ts` 工具），无独立的记忆分层
- **差异化功能**：子 Agent 系统（同步/异步）、微信连接、长任务异步调度、主动聊天（定时 + 情绪联动）
- **借鉴点**：情绪-主动聊天联动、子 Agent 异步任务（Nexus 有 errand 但无"子 Agent"抽象）

### 2. ackem（本地优先，468 ⭐）

- **规模**：861 个文件（与 Nexus 同级）
- **架构**：**七系统架构**——Brain（L0 理解 + L4 记忆检索与衰减）、Heart（L1 关系 + L2 情绪 + L3 表达）、Mouth（prompt 组装）、Neural（向量检索）、Extension（技能/插件/分发）、Time（时间感知、昼夜节律、重逢、反思）、Data Layer（SQLite + Repository + 迁移）
- **记忆**：70 个文件——activeRecall、ageComputer、consolidator（整合）、contradictionDetector（矛盾检测）、episodeExtractor（片段提取）、associationColdStart（关联冷启动）、autoMirrorPolicy——**记忆体系比 Nexus 的 decay/recall 深一个量级**
- **借鉴点**：记忆整合（consolidator）、矛盾检测、关联冷启动——Nexus 的 0.4.6 记忆增强可参考；"Time 系统"（昼夜节律、重逢、反思）与 Nexus 的 dream/letter/arc 高度重合

### 3. my-neuro（1.3k ⭐，桌宠向）

- Python 桌宠：Live2D + ASR/TTS + 双模型 + MEMOS 长期记忆服务（独立服务）
- 部署复杂（Windows bat 脚本 + 百度网盘整合包），工程规范性弱
- **借鉴点**：Live2D 表情与语音联动（Nexus 有 Live2D 基础但情绪表达层较克制）

### 4. hermes-desktop（13.7k ⭐，agent 面板）

- 重点是 **agent 操作面**：22 个斜杠命令、14 个工具集、16 个消息网关、cron 调度器、记忆提供方（Honcho/Mem0 等）可插拔、profile 切换、自动更新
- **不是桌宠**：无形象、无情绪、无语音会话
- **借鉴点**：记忆提供方可插拔设计、profile 切换（Nexus 有 auth-profiles）、slash 命令体验

### 5. Soul-of-Waifu（1.0k ⭐，角色扮演向）

- **Soul Memory 长期认知架构**：认知档案（按硬件规模分层）、长期记忆分层
- 三模式一体：角色扮演 / 桌游 GM / 桌面伴侣 + MCP 助理
- **借鉴点**：记忆分层设计（短期/长期/认知档案）值得参考

## 四、Nexus 相对竞品的优劣势

### 优势（已验证的差异化）

| 维度 | Nexus | 竞品普遍 |
|---|---|---|
| 语音深度 | VAD + 唤醒词 + 流式 TTS 多 provider + 会话状态机 | yoji 有唤醒；多数无 VAD 会话 |
| 安全工程 | IPC schema 拒绝未知字段、错误脱敏、SSRF 防护、全套审计门禁 | 无系统化安全审计 |
| 自主层 | errand / check-in 策略 / proactive / arc / letter / future capsule | ackem 有反思；yoji 有子 Agent |
| 隐私叙事 | 本地优先 + 粗粒度时间语言 + 明确边界 | ackem 类似；多数竞品不透明 |
| 工程成熟度 | 3013 测试、34 项审计、三平台发布流程 | 大多无 CI 门禁 |

### 劣势/机会

| 维度 | 现状 | 竞品参考 |
|---|---|---|
| 记忆深度 | decay + recall + dream，但无整合/矛盾检测 | ackem 的 consolidator / contradictionDetector |
| 情绪可见化 | 有情绪状态但 UI 呈现弱 | yoji 激素模型；my-neuro Live2D 联动 |
| 角色自定义 | persona 系统存在但导入/预览弱 | Soul-of-Waifu 角色生态 |
| 扩展生态 | MCP 基建扎实但无生态叙事 | yoji 主打 MCP 扩展 |
| 主动陪伴 | check-in 克制（有意为之） | yoji 定时+情绪联动（可作差异化参照） |

## 五、结论：对 Nexus 的启示

1. **赛道验证**：Nexus 的定位（本地优先、隐私边界、陪伴+授权辅助）有真实需求，且
   竞品多在"话痨高交互"或"agent 面板"两端，Nexus 的"安静陪伴"是差异化空隙。
2. **0.4.6 方向确认**：记忆增强（整合/矛盾检测）与情绪可见化有明确竞品参照
   （ackem、yoji），且符合"时光记忆"主题。
3. **工程优势要守住**：安全审计与发布门禁是 Nexus 相对所有竞品的最大壁垒，
   后续版本不应削弱。
4. **生态叙事是机会**：MCP 基建已就绪，缺的是"工坊/扩展"式的用户可见呈现。
