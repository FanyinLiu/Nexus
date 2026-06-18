<p align="center"><img src="public/banner.png" alt="Nexus" width="720" /></p>

# Nexus

Nexus 是一个 **AI 桌面伴侣 + 自主数字助手**。

它不是普通聊天软件，也不是把聊天框套进 Electron 的多模型面板。Nexus 的目标是让 AI 以一个可见、可听、能记住你、能帮你处理事情的形象常驻在电脑里。

一句话：**Nexus 是一个住在电脑里的 AI 伙伴。**

## 这个项目是什么

Nexus 想做的是一种“陪伴式桌面 AI”：

- **桌宠形象**：AI 不只存在于聊天记录里，而是以一个小角色常驻桌面。
- **自然对话**：先从文字对话开始，之后再加入语音输入和语音输出。
- **长期记忆**：未来它应该记住偏好、习惯、项目、关系和重要事件。
- **本地优先，可接 API**：基础对话优先连接 Ollama 等本地模型；也可以使用 DeepSeek API 先跑通文本体验。
- **自主任务能力**：在用户授权后，它可以整理信息、提醒事项、调用工具、执行小任务。

Nexus 的重点不是堆功能，而是把“陪伴”和“助手”合成一个统一体验：它一直在电脑旁边，安静地存在，需要时能对话，授权后能做事。

## 它不是什么

| 不是 | 因为 Nexus 更关注 |
|---|---|
| 普通 AI 聊天软件 | 常驻感、角色存在感、长期关系和桌面上下文 |
| 多模型 API 面板 | 本地优先的伙伴体验，而不是 provider 列表 |
| 单纯桌宠动画 | 角色只是入口，核心是对话、记忆和任务帮助 |
| 完整 Agent 平台 | 自主能力要服务于陪伴体验，并且必须可控、可授权 |
| 外部角色复刻 | Nexus 有自己的形象、边界和产品体验 |

## Nexus 的形象方向

Nexus 的形象应该服务于三个感觉：

1. **陪伴式**：它像一个在旁边待着的伙伴，而不是一个只在输入框里出现的工具。
2. **常驻式**：它可以长期留在桌面角落，轻量存在，不抢注意力。
3. **任务助手式**：它不是只会卖萌，也能在明确授权后帮用户处理事情。

> 一个住在电脑里的 AI 伙伴。

它的形象应该轻、安静、有存在感。当前代码已经超过早期 Phase 1：Nexus 不只是一个静态头像聊天框，而是正在收敛为 **常驻桌面伴侣 + 真实电脑上下文 + 消息感知 + 本地优先模型/语音 + 可控主动性** 的产品。

## 当前阶段：v0.3.4 稳定化

当前最重要的工作不是继续堆新功能，而是把已经落地的 v0.3.4 能力验证成可信闭环：

| 优先级 | 要稳定的能力 | 验收证据 |
|---|---|---|
| P0 | README / ROADMAP / release notes 与当前代码一致 | 文档不再把 Live2D、语音、记忆、消息桥描述成“以后再做” |
| P0 | 桌面消息感知真实可用 | macOS Full Disk Access 后，真实通知能进入 Nexus；本地 webhook 消息可被稳定注入 |
| P0 | Telegram / Discord 桥真实可用 | 配对码、owner 限制、文本回信、忙碌排队、重连语义在真实服务上验证 |
| P1 | 主动关怀有分寸 | 事件驱动、限流、跳过原因可观察，不把用户工作流打断 |
| P1 | 记忆可解释可编辑 | 重要记忆能查看来源、编辑、忘记、置顶 |
| P2 | Live2D / 语音诊断更可控 | 表情动作映射、语音链路诊断、低延迟本地 TTS 有明确入口 |

稳定化验证流程见 [v0.3.4 稳定化验证计划](docs/V0.3.4_STABILIZATION.md)，执行拆分见
[EXECUTABLE_OPTIMIZATION_TASKS](docs/EXECUTABLE_OPTIMIZATION_TASKS.md)，长期方向见 [ROADMAP](docs/ROADMAP.md)。

## 当前实现状态

当前默认体验正在从“能聊”进入“住在电脑里并理解上下文”的验证期：

- 桌面端使用 Electron + React + TypeScript，桌宠窗口支持常驻、拖拽、置顶和小窗交互。
- Live2D 星绘已经成为默认形象，像素 / Codex 兼容 sprite pet 保留为可选路径。
- 对话支持本地 Ollama、DeepSeek、OpenAI-compatible、自定义接口和多个 provider 预设；设置页已经按国内 / 海外 / 本地路径收敛。
- 语音链路包含语音输入、TTS 播报、打断、VAD / SenseVoice / Tencent / Paraformer 等路径，以及本地 sherpa-onnx TTS 选项。
- 记忆与关系系统已经落地：长期记忆、每日日志、情绪 / 关系状态、回忆和主动在场文案会影响她怎么回应；聊天来源可跳 History，调度器 / 任务 / 话题 / 胶囊来源可跳 Autonomy。
- 桌面消息感知已进入 v0.3.4 beta：macOS 通知中心可把微信、QQ、邮件、Telegram、Discord、Slack、Teams 等通知转成伴侣可感知事件；通知预览朗读单独受控。
- Telegram / Discord 桥已支持配对码、owner 限制、自动回信、可选语音回信和 Telegram 语音转写；真实网络验证仍是 v0.3.4 稳定化门槛。
- 主动关怀诊断已能追溯来源：消息来源可跳到 History 里的原消息；调度器 / 晨晚问候会跳到 Autonomy；夜间任务 / 开放话题 / 未来胶囊会跳到 Autonomy 的关怀队列，并在对象仍存在时高亮。P1/P2 文件证据可用 `npm run stabilization:evidence:status` 汇总缺口。
- 本地 webhook 和外部 adapter 是中国通讯软件的现实接入路径：先接系统通知或用户自动化事件，再走 Nexus webhook；不要把它描述成直接读取所有私有聊天数据库。新 adapter 先用 `npm run message:adapter:check -- --template email` 或 `--template im` 生成 payload 模板，再用 checker 产出脱敏证据。
- 本地开发时，Nexus 网页预览地址是 `http://127.0.0.1:47821/`；`11434/v1` 是 Ollama API，不是网页预览。

## 本次更新 — v0.3.4-beta.4

> **她的小表情落在脸上，不再漏进聊天框（预发布）。** 完整说明见 [RELEASE-NOTES-v0.3.4-beta.4.md](docs/RELEASE-NOTES-v0.3.4-beta.4.md)（英文）。

她常用括号给回复加点小动作——「（眼睛亮了）」「（歪头）」——这些是给她头像的**舞台指令**，本该驱动表情，不该被当成文字念或显示。偶尔会有一条漏进可见回复里，看着像 bug。这版改成**按形状**判断（而不是靠一张要人工维护的词表）：认识的表情驱动她的脸、不显示也不念（跟之前一样）；她临时造的、没收录的旁白则留下来渲染成**暗色斜体的旁注**，是有意的旁白而不是漏出来的字；两类都不会被念出来（连语音流式中途也不念）。带冒号的「（注：周一照常）」仍当正文照常显示。关键在于按**形状**判断，所以别人屏幕上出现的新表情也会被同样处理，不用谁去往词表里加。预发布版仅供手动验证，稳定版用户不会被自动升级。

## 本次更新 — v0.3.4-beta.3

> **她的情绪现在真的驱动她了，不只是描述她（预发布）。** 完整说明见 [RELEASE-NOTES-v0.3.4-beta.3.md](docs/RELEASE-NOTES-v0.3.4-beta.3.md)（英文）。

这版把情绪引擎端到端打通：她会从整段对话里读出**你**的心情（不靠关键词，"我今天被裁了"她也能察觉），她自己的情绪由真实事件塑造（回复失败、你长时间离开、你最近不开心），而这份情绪会真的改变她**怎么、要不要**开口——担心时倾向轻轻确认，累了倾向安静，但绝不越过免打扰时段，也不会因为心情好就变话痨；关系越近表达越开放。另外 **Live2D 星绘成为默认形象**（像素宠降为可选）、桌面消息感知**合并成一个开关**、错过的消息会在下次对话温柔带一句。预发布版仅供手动验证，稳定版用户不会被自动升级。

## 本次更新 — v0.3.4-beta.2

> **伴侣能感知你全部的消息了（预发布）。** 完整说明见 [RELEASE-NOTES-v0.3.4-beta.2.md](docs/RELEASE-NOTES-v0.3.4-beta.2.md)（英文）。

新增 **桌面消息感知（macOS）**：开一个开关，Nexus 读系统通知中心，微信/QQ/邮件等任何应用来消息伴侣都知道、会进对话（默认只知道来源和发件人，念内容是单独开关；需授予"完全磁盘访问"权限）。通讯桥新增**配对码**——给 bot 发条消息收 6 位码、桌面里点批准即完成授权，不用再手挖 Chat ID。另含 MiniMax 联网搜索（与编程套餐共用 Key）、设置页模型选择的国内/海外/本地分区、删除约 2100 行死代码。beta.1 的全部内容（自动回信/语音双向/免费本地 TTS）也在其中。预发布版仅供手动验证，稳定版用户不会被自动升级。

## 本次更新 — v0.3.3

> **维护 + 打磨 + 瘦身。** v0.3.3-beta.1 验证期结束后转正，内容一致。完整说明见 [RELEASE-NOTES-v0.3.3.md](docs/RELEASE-NOTES-v0.3.3.md)（英文）。

这版让导入的角色卡真正驱动聊天（开关开启后），新增语音识别云→本地 SenseVoice 失败兜底，修了一批语音/通知/人设的 bug。桌宠侧：默认改名 **Pip**（示例/测试宠）、默认改成显示场景背景（透明满屏走改成 opt-in，设置或右键切换）、移除“分身”功能。工程侧删掉约 2500 行死/休眠代码（孤儿模块、休眠的 realtime 语音后端、未用的 fs 工具栈、重复/桩文件）并去掉未用依赖。更大的主动性能力仍在 v0.4 单独推进。稳定版与 beta 用户下次启动时自动升级。

## 本次更新 — v0.3.2

> **Codex 兼容桌宠 + 社区导入 + 宠物制作链路。** 完整说明见 [RELEASE-NOTES-v0.3.2.md](docs/RELEASE-NOTES-v0.3.2.md)。

v0.3.2 把 Codex 风格的轻量 sprite pet 作为 Nexus 的可选头像路径接进来：Nexus 可以读取 `8x9` / `1536x1872` / `192x208` 的 Codex 兼容图集，验证 `pet.json`，预览每一行动作，并在桌面小窗里播放 idle、waving、review 等状态。

这版也加入了用户主动选择的社区宠物入口和制作工具：可以从支持的社区页面、slug、ZIP 下载地址导入宠物；也可以从图片或创作者套件生成自己的 Codex 兼容包，再安装到 `${CODEX_HOME:-~/.codex}/pets/`。社区素材仍按第三方内容处理，Nexus 只做用户选择、下载、校验和本地导入，不把未授权社区作品当作自有素材打包。

工程侧同步补了远程下载和包解析的安全边界：下载走超时、DNS / 私网检查和流式大小上限；ZIP 解压限制 deflated 输出；依赖审计清零；插件重启路径重新检查启用、审批和可信命令策略。

## 设计原则

- **常驻但不打扰**：它可以一直在桌面上，但不能干扰用户工作。
- **本地优先**：能在本机完成的能力优先在本机完成。
- **先陪伴，再自动化**：没有稳定的陪伴体验，自动任务只会像外挂功能。
- **先稳定，再扩张**：Live2D、语音、消息桥、记忆和主动性已经存在，下一步是验证闭环和边界，而不是继续扩大表面能力。
- **用户授权**：涉及文件、系统、网络、工具和任务执行时，必须让用户明确知道它要做什么。

## 当前技术方向

当前技术栈：

- Electron：桌面窗口和系统集成。
- React：界面和状态组织。
- TypeScript：主进程、渲染层和共享类型。
- Vite：开发和构建。
- Ollama / DeepSeek / OpenAI-compatible：文本模型主路径。
- sherpa-onnx / 云 ASR / 云 TTS：语音输入输出路径。
- macOS Notification Center / local webhook / Telegram / Discord：消息感知与通讯桥路径。

当前开发重点是把这些路径变成可验证、可恢复、可解释的稳定体验：失败要有诊断，权限要有边界，消息和主动关怀要可追踪。

## 安装与更新

普通用户的安装主路径不是 npm，而是桌面安装包：

- Windows：从 GitHub Releases 下载 `Nexus-Setup-<版本号>.exe`。
- macOS：下载 `.dmg` 或 `.zip`，把 `Nexus.app` 放进 `/Applications`。
- Linux：下载 `.AppImage` 或 `.deb`，可用 `SHA256SUMS` 和可选 GPG 签名校验。

当前 macOS / Windows 构建暂未接入付费代码签名。首次打开时，macOS
可能提示开发者无法验证，可在确认来源是本仓库 GitHub Releases 后对
应用运行 `xattr -dr com.apple.quarantine /Applications/Nexus.app`；Windows
可能出现 SmartScreen，确认发布来源后选择“更多信息 → 仍要运行”。这不是长期
目标，后续如果启用 Developer ID / Windows 证书，会移除这条 unsigned fallback。

安装版会通过 GitHub Releases + `electron-updater` 检查更新。预发布版本只给手动验证，不会把稳定版用户自动升级到 beta；稳定版发布后，稳定版和 beta 用户都会按版本号升级到新的稳定版。

npm 不是普通用户的安装主路径。这个仓库的 npm 命令只给开发者使用：启动开发环境、打包安装包、运行自检和发布前检查。普通用户只需要下载桌面安装包，并通过应用内更新获得后续版本。

## 本地开发

环境要求：

- Node.js 22+
- npm 10+
- 已安装 Ollama 并至少准备一个本地模型，或准备可用的 DeepSeek API Key

只看前端网页预览：

```bash
npm install
npm run dev
```

然后打开：

```text
http://127.0.0.1:47821/
```

启动 Electron 桌面开发环境：

```bash
npm install
npm run electron:dev
```

`electron:dev` 会复用已经运行的 `47821` Vite 服务；如果没开，它会自动先启动 Vite，再启动 Electron。

不要把 `http://127.0.0.1:11434/v1` 当成网页打开。它是 Ollama 的 OpenAI-compatible API 地址，只给 Nexus 调模型用；浏览器预览始终看 Vite 的 `47821` 端口。

快速自检：

```bash
npm run doctor
```

它会检查仓库依赖、`electron:dev` 启动路径、`47821` 预览服务、Ollama API 和默认 `qwen3:8b` 模型，并提醒 DeepSeek API 的配置入口。
如果你主要走 DeepSeek，可以运行：

```bash
npm run doctor -- --provider deepseek
```

这样 Ollama 未启动会降为信息提示，不会被当成主路径警告。

常用命令：

```bash
npm run build
npm run lint
npm test
npm run distribution:audit
```

## 贡献方向

当前最有价值的贡献不是加大功能，而是把 v0.3.4 稳定化闭环做扎实：

- 真实机器验证桌面消息感知、Full Disk Access 授权、Telegram / Discord 回信链路。
- 本地 webhook 验证优先跑可复现 smoke：`npm run message:smoke:local`；如果要验证已经打开的 Nexus 实例，再用 `npm run message:validate -- --token "Bearer nexus_..." --evidence-file artifacts/v0.3.4/message-awareness-local.json`。
- 真实 macOS / Telegram / Discord 验证先生成模板：`npm run message:live:template`，再用 `npm run message:live:record -- macos ...`、`-- telegram ...` 或 `-- discord ...` 记录每个真实 gate；`pass` 记录必须带观察时间、operator、具体 note 和对应 proof flags。用 `npm run message:gate:live` 审 live gate；需要查看缺口时跑 `npm run message:status:release`，再用 `npm run message:merge:release` 把本地 evidence 和真实 evidence 合成完整证据包，最后用 `npm run message:gate:release` 审完整 release gate。
- 让模型、语音、通知和桥的失败都能被用户看懂并恢复。
- 继续补强上下文诊断卡、主动关怀事件日志、验证脚本和 release gate。
- 保持 README、ROADMAP、release notes、设置页文案和实际功能一致。
- 改进主动关怀的时机、限流和跳过原因，而不是增加更多打扰。

## 项目边界

Nexus 的长期想象空间很大，但当前最重要的是把方向讲清楚：

**Nexus 是一个住在电脑里的 AI 伙伴。**

它已经拥有语音、记忆、桌宠动作和消息桥的早期实现。接下来的边界是：不做泛 AI 工作台，不做成人/擦边角色社区，不承诺直接读取所有通讯软件私有数据库；先把“电脑旁边的、有分寸的伙伴”做可靠。

## License

Released under the [MIT License](LICENSE).
