# Nexus 真竞品调研（2026-06-11）

> 三路并行扫描：国内市场 / 国际市场 / 开源新秀（2025H2-2026 新增）。
> 竞品判定标准（命中 ≥2 才算竞品）：①桌面常驻视觉形象 ②持久人格+情绪/关系演化 ③语音对话 ④主动行为。
> 排除已调研的邻居：SillyTavern、Open-LLM-VTuber、AIRI、Amica、Cherry Studio、LobeChat、Chatbox、OpenClaw、Hermes。
> 体量数据为 2026-06-11 实查。

## 0. 结论

1. **「文件化人格 + 情绪/关系状态机 + 做梦记忆固化 + 桌面感知自主引擎 + IM 桥」的完整组合，仍然没有任何单一产品同时具备**——三路调研独立得出同一结论，护城河成立。
2. 但这个象限**正在快速变拥挤**：2025-12 ~ 2026-04 Steam 集中上了一批 Live2D 桌宠+LLM 新品；开源侧 my-neuro 把"持续情绪状态"列为当前主攻，与 Nexus 正面撞车。
3. 国内大厂陪伴产品（星野/猫箱/筑梦岛，月活第一梯队）**全部没有桌面端**；"桌面常驻 × 主动性"象限里成规模的商业产品只有逗逗一家。
4. 两大 OS 厂都在做"助手"不做"陪伴"（Copilot Mico 明确设计原则是防情感依恋；新 Siri 无 avatar）——OS 自带短期不构成威胁。

## 1. 真竞品（按威胁强度）

### 商业
| 产品 | 命中 | 体量 | 与 Nexus 的差异 |
|---|---|---|---|
| **逗逗游戏伙伴 / Hakko AI**（心影随形） | 4/4 | 注册 1000 万+、月活 200 万+、订阅制跑通（Pro $9.99/Ultra $19.99） | 游戏陪玩垂直（VLM 看游戏画面、赛后复盘）vs Nexus 泛生活陪伴；闭源 SaaS+自研垂直模型；Windows only；IP 角色运营（B站 UP 数字分身/虚拟主播入驻） |
| **Molili AI Friends**（Steam EA 2025-12） | 4/4 | 307 评 86% 好评，本档最活跃 | 好感度+演化人格系统化（与 Nexus 关系状态机直接对位）；闭源订阅、单角色 IP |
| **Desktop Companion**（Dokk75，$9.90 买断） | 4/4（④仅定时器级） | 单人开发，itch.io+官网，体量小 | 形态最接近：always-on-top + Live2D/VRM 导入 + 长期记忆 + 屏幕视觉 + 本地/云多 LLM；无情绪状态机/做梦/IM 桥/Mac |
| **Doki**（Pretender，国内独立，免费） | 4/4 | 体量未知 | **像素风直接撞型**：多层级记忆 + 情绪动作 + 主动提醒气泡 + 数据本地 |
| **AI Desktop Pet**（42kami，Steam ¥52） | ①③ | 42 评 78%（口碑走低） | 全离线本地 LLM + 声音克隆 + 酒馆角色卡；无关系演化无主动性 |

### 开源
| 项目 | Stars | 命中 | 要点 |
|---|---|---|---|
| **super-agent-party** | 2.4k（日活跃） | ①③+②④部分 | 覆盖面最广的单项目：VRM/Live2D 桌宠+语音+角色卡记忆+QQ/微信/TG/Discord 桥+自主任务+直播 bot；走平台广度，无情绪演化/做梦 |
| **my-neuro** | 1.3k（日活跃） | ①③④+②部分 | **叙事正面撞车**："一起开黑/叫你起床/偷偷记住你做了什么/对某句话难受很久"；主动对话 V1 已落地，持续情绪状态是当前主攻；DIY 训练向（声线/性格微调），无打包精致度/无桥 |
| **LingChat** | 1.0k | 4/4 | 国产：情绪识别模型换立绘表情+每角色永久记忆+视觉屏幕感知主动对话；galgame 立绘形态 |
| **Soul of Waifu** | 725 | ①②③ | 2026-04 刚加桌面常驻模式的 RP 引擎：28 情绪表情+全双工语音+RAG 记忆；无主动引擎 |
| **Sapphire** | 259（solo 日更） | ②③④ | 除了没形象层，功能单逐条对应 Nexus：heartbeat 主动问候/dream mode/随机 check-in/**Discord+Telegram+Email 桥**/向量记忆/AI 自改人格——同路人，持续盯 |

## 2. 监视名单（现在不是、随时可能变成最强竞品）

- **Desktop Mate**（infiniteloop，Steam）：装机量巨大（初音/2B/原神联动 DLC 持续运营），**至今未接 AI**，社区有请愿。一旦接 LLM 即成最强形态竞品。
- **Anuttacon LPM 1.0**（蔡浩宇新公司，2026-04 公布）：170 亿参数实时全双工音视频角色表演模型，明确瞄准"对话智能体/游戏伴侣视觉引擎"，未开放。
- **Grok Companions**（xAI）：好感度系统+语音做得重、背靠 X 流量，目前困在手机 App（$30/月 SuperGrok）；若出桌面端会立刻升级。
- **Replika**：主动 check-in/记忆/情绪识别在同维度最强（2026 记忆大版本+Ultra 档每日自我反思），但无桌面形态。
- **QwenPaw**（阿里 AgentScope，17.4k★）：助理+多 IM 桥+本地模型+桌面 app beta，v1.1.8 加了 Pet 功能——"巨型助理下探桌宠"的信号。
- **华为小艺智能陪玩**（59.9 元/月）：大厂跟进游戏陪玩的信号。

## 3. 已确认只是邻居

- 国内大厂陪伴 app：猫箱（字节）、星野/Talkie（MiniMax）、筑梦岛（阅文）、X Eva（小冰）、Glow——全部纯手机+网页，零桌面动向
- 国际 web/移动陪伴：Character.AI（20M MAU）、Nomi、Kindroid、Paradot、AI girlfriend 类——无一桌面常驻
- OS 厂：Copilot Mico（变形圆球，刻意防情感依恋）、Apple Siri AI（2026-06-08 发布，无 avatar 无人格化）
- OpenClaw 化身生态：Clawra（爆红 60 万浏览后**两天停更**，实质只是 selfie skill）、Pixel Lobster 等——全停在皮肤层，无一长成独立产品
- coding-agent 桌宠潮：clawd-on-desk（3 个月 4.1k★）、openpets 等——像素桌宠形态被 coding 场景带火，但内核是状态监视器，无对话/人格
- 已停滞：LobeVidol（停 15 个月）、桌崽AI（疑似失活）、OpenHer/Alice（理念同源但弃更/高风险）

## 4. 事实性观察（供战略参考，不是建议）

1. 逗逗证明了"桌面常驻+主动性"的**付费意愿**存在（200 万付费、用户偏好 $19.99 Ultra 档），路径是游戏垂直场景切入。
2. Steam ¥11-52 价位的 AI 桌宠供给在快速增加，但评测量全在两位数到 400 区间，**无破圈者**——形态有需求、没人做出完整体验。
3. 所有真竞品里没有任何一家同时有「情绪/关系状态机 + 做梦固化 + IM 桥」；最接近的两个（my-neuro 在补情绪、Sapphire 有桥+做梦但没形象）各缺一大块。
4. Replika 的主动 check-in（关系等级解锁、记得"你的猫好点没"并主动追问）是主动性体验的标杆参照，尽管它没有桌面形态。

## 5. 来源（节选）

- 逗逗：doudou.fun ・ 腾讯新闻（全球用户超1000万, 2026-05）・ 东方财富（200万玩家付费）・ 量子位/知乎报道
- Steam：store.steampowered.com（Molili 4141770 / AI Desktop Pet 4227700 / AI Desk Pet 4417720 / Desktop Mate 3301060 / Ai Vpet 3029820 / ChatWaifu 2331610）
- Desktop Companion: dokk75.itch.io ・ desktopaicompanion.com ／ Doki: doki.pretender.asia
- 开源（GitHub API 实查）：heshengtao/super-agent-party ・ morettt/my-neuro ・ SlimeBoyOwO/LingChat ・ jofizcd/Soul-of-Waifu ・ ddxfish/sapphire ・ Lynpoint/CyberVerse ・ shinyflvre/Mate-Engine ・ SumeLabs/clawra ・ rullerzhou-afk/clawd-on-desk ・ agentscope-ai/QwenPaw ・ lobehub/lobe-vidol
- Grok Companions: grokipedia.com/page/Grok_Companions ／ Replika: weavai.app 2026 review ・ aicompanionguides.com 实测
- OS: windowsforum.com（Mico）・ TechCrunch/Apple Newsroom（Siri AI, 2026-06-08）
- Anuttacon LPM: ithome.com ・ ai-bot.cn
