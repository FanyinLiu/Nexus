<p align="center"><img src="public/banner.png" alt="Nexus" width="720" /></p>

# Nexus

Nexus 是一个 **本地优先的 AI 桌面伙伴**。

它不是普通聊天软件，也不是把聊天框套进 Electron 的多模型面板。Nexus 的目标是让 AI 以一个可见、可听、能记住你、能在你明确授权时提供轻量帮助的形象常驻在电脑里。

一句话：**Nexus 是一个住在电脑里的 AI 伙伴。**

> **当前代码版本：** v0.4.2，和 `package.json` 保持一致。正式下载页仍以 GitHub Releases 的最新 tag 为准；更早历史统一放在 Releases，不在 README 顶部继续滚动维护旧版本号。

## 这个项目是什么

Nexus 想做的是一种“陪伴式桌面 AI”：

- **桌宠形象**：AI 不只存在于聊天记录里，而是以一个小角色常驻桌面。
- **自然对话**：先从文字对话开始，之后再加入语音输入和语音输出。
- **长期记忆**：未来它应该记住偏好、习惯、项目、关系和重要事件。
- **本地优先，可接 API**：基础对话优先连接 Ollama 等本地模型；也可以使用 DeepSeek API 先跑通文本体验。
- **授权辅助能力**：在用户明确授权后，它可以整理信息、提醒事项，并以可确认、可停止、可审计的方式提供轻量帮助。

Nexus 的重点不是堆功能，而是把“陪伴”和“辅助”合成一个统一体验：它一直在电脑旁边，安静地存在，需要时能对话，授权后能帮忙，但不会变成默认替你工作的智能体。

## 它不是什么

| 不是 | 因为 Nexus 更关注 |
|---|---|
| 普通 AI 聊天软件 | 常驻感、角色存在感、长期关系和桌面上下文 |
| 多模型 API 面板 | 本地优先的伙伴体验，而不是 provider 列表 |
| 单纯桌宠动画 | 角色只是入口，核心是对话、记忆和任务帮助 |
| 工作型智能体平台 | 辅助能力要服务于陪伴体验，并且必须可控、可授权、可停止 |
| 外部角色复刻 | Nexus 有自己的形象、边界和产品体验 |

## Nexus 的形象方向

Nexus 的形象应该服务于三个感觉：

1. **陪伴式**：它像一个在旁边待着的伙伴，而不是一个只在输入框里出现的工具。
2. **常驻式**：它可以长期留在桌面角落，轻量存在，不抢注意力。
3. **可托付但克制**：它不是只会卖萌，也能在明确授权后帮用户处理轻量事务，但不会抢走用户的控制权。

> 一个住在电脑里的 AI 伙伴。

它的形象应该轻、安静、有存在感。它可以在角落里待着，可以回应用户，可以逐步学会记住和帮忙，但第一阶段不需要完整角色企划。

## 第一阶段只做什么

第一阶段的目标不是做完整产品，而是验证一个最小体验闭环：

> 用户打开电脑后，能看到一个常驻的小 AI 伙伴，并能通过本地 Ollama 或 DeepSeek API 和它简单对话。

第一阶段只做这四件事：

| 范围 | 要做到什么 | 先不追求什么 |
|---|---|---|
| 桌面常驻小窗口 | 可移动、可置顶、可关闭，稳定停在桌面上 | 复杂窗口管理、多屏细节、炫酷动画 |
| 二次元极简头像 | 静态头像或少量表情切换，先有“伙伴”的视觉锚点 | 完整 Live2D、复杂动作、换装、场景 |
| 跑通文本模型 | 默认本地 Ollama，也支持 DeepSeek API；可配置地址、模型名和必要密钥 | 多 provider 体系、云模型矩阵、复杂 failover |
| 简单文字对话 | 输入文本、显示回复、保留基础上下文 | 长期记忆、工具调用、自动任务、复杂 Agent |

这个阶段的验收标准很简单：

- 打开应用后，桌面上能看到一个小伙伴窗口。
- 用户能输入一句话。
- Nexus 能把这句话发给 Ollama 或 DeepSeek API。
- Nexus 能把模型回复展示出来。
- 整个过程稳定、轻量、不打扰。

## 第一阶段明确不做

为了避免项目一开始就失控，第一阶段不做这些：

- 不做完整 Live2D 系统。
- 不做复杂动作、换装、场景和表情编排。
- 不做完整 Agent 框架，也不做 Codex 式工作智能体。
- 不做复杂工具调用和自动执行任务。
- 不做完整语音系统。
- 不做长期记忆、情绪系统、关系等级或主动陪伴逻辑。
- 不做多平台复杂打包流程优先级。

这些能力都是 Nexus 的未来方向，但它们不应该进入第一阶段的最小闭环。

## 阶段路线

| 阶段 | 目标 | 结果 |
|---|---|---|
| Phase 1 | 最小桌面伙伴 | 小窗口 + 极简头像 + Ollama / DeepSeek + 简单对话 |
| Phase 2 | 形象存在感 | 表情状态、待机动作、拖拽交互、轻量桌宠体验 |
| Phase 3 | 语音体验 | 语音输入、语音输出、打断、基础唤醒 |
| Phase 4 | 记忆系统 | 用户偏好、项目记忆、可编辑记忆、隐私控制 |
| Phase 5 | 授权辅助 | 只在明确授权后提供提醒、搜索、文件和工具调用等轻量帮助 |
| Phase 6 | 完整伴侣体验 | 角色系统、长期关系、主动陪伴、多模型和多端扩展 |

每个阶段都应该先完成一个可用闭环，再进入下一个阶段。Nexus 可以很大，但不能一开始就把所有系统塞进去。

更具体的执行拆分见 [Nexus 升级整合计划](docs/NEXUS_UPGRADE_INTEGRATION_PLAN.md)，可执行任务表见
[EXECUTABLE_OPTIMIZATION_TASKS](docs/EXECUTABLE_OPTIMIZATION_TASKS.md)。

## 当前实现状态

Phase 1 已经开始落地，当前默认体验正在收敛到最小闭环：

- 默认伙伴形象使用 `Nexus Mini` 极简静态头像，完整 Live2D 仍作为后续/可选能力保留。
- 新安装的桌宠窗口默认使用更小的常驻尺寸，适合先放在桌面角落里运行；用户仍可拖拽调整。
- 新安装默认走 Ollama 文本链路：`http://127.0.0.1:11434/v1` + `qwen3:8b`；如果已有 DeepSeek API Key，可以直接切换到 DeepSeek + `deepseek-v4-flash`。
- 设置首页收敛为模型、桌面、角色、自检、聊天记录、语音、记忆和工具；设定集已经合并进记忆里的“背景与常用表达”，本地任务、集成和自治不再作为独立入口。
- 模型选择默认走主路径：DeepSeek、Ollama、OpenAI-compatible 和自定义接口；其他 provider 仍保留在更深的模型来源里。
- Onboarding 只引导文字模型和基础伙伴设置，不再把完整语音系统放进第一阶段入口。
- 默认聊天和小窗入口以文字对话为主；语音按钮只在进阶设置开启语音输入或已有语音会话时出现。
- Ollama 和 DeepSeek 连接测试会给出更明确的缺模型、缺 API Key、模型名不匹配提示；如果本机 Ollama 未启动或端口无响应，会提示启动 Ollama、检查 `http://127.0.0.1:11434/v1`，并在需要时运行 `ollama pull qwen3:8b`。
- 连接测试会先做本地预检：Ollama 会提示 `http://127.0.0.1:11434/v1`、`qwen3:8b` 和 `ollama pull qwen3:8b`，DeepSeek 会提示 `https://api.deepseek.com` 与 `deepseek-v4-flash`，自定义接口会提示需要完整的 OpenAI-compatible Base URL 和模型 ID。
- 首次启动向导的文本模型步骤也会复用这套本地预检，并把问题和修复建议分开显示；对于 Ollama/DeepSeek 等内置 provider，可一键填入推荐 Base URL 和模型名，填入后会重新本地预检并提示继续做真实连接测试。真实连接测试失败后，向导和设置页也会在安全时提供同样的修复按钮；只会改 Base URL/模型名，不会代填或改写 API Key。缺云端 API Key 仍允许先保存并体验常驻窗口，但不会遮蔽 Base URL 或模型名缺失。
- 向导最后一步会显示“5 分钟内完成首次对话”的目标状态：只有当前文本模型通过连接测试后才显示已就绪；字段完整但未测试会显示为可开始但需先测试，缺少关键字段则需要补齐。
- 完成向导后，第一次直接文字/语音助手回复会在本地记录 `firstConversationAt` 和耗时，并在 Debug Console 留下是否达成 5 分钟目标的系统事件；不会记录消息内容或密钥。
- 设置里的基础检查会显示首次对话目标状态：未记录、等待首条回复、已达成，或超出 5 分钟。
- 基础检查可以下载本地首次运行 QA 报告，包含检查项、首次对话耗时和隐私标记；不会导出聊天内容、模型输出、API Key 或 provider secret。
- 本地开发时，Nexus 网页预览地址是 `http://127.0.0.1:47821/`；`11434/v1` 是 Ollama API，不是网页预览。

## 本次更新 — v0.4.2

> **主题：Check-In 策略和发布门禁对齐。** 中文说明见 [RELEASE-NOTES-v0.4.2.zh-CN.md](docs/RELEASE-NOTES-v0.4.2.zh-CN.md)，英文完整说明见 [RELEASE-NOTES-v0.4.2.md](docs/RELEASE-NOTES-v0.4.2.md)。

0.4.2 继续保持 v0.4 桌面陪伴感知的保守边界：温和 check-in 只先形成本地、可压制的 in-app 决策，不发送消息、不执行工具、不创建外部通知，也不把精确计时或原始桌面内容送进模型边界。

一句话记住 0.4.2：

- **check-in 决策和发出分开，重复调用不会变成反复打扰。**
- **正在和 Nexus 聊天、刚 dismiss、重复同类信号、过期回到 Nexus 信号都会被压住。**
- **in-app payload 只是本地短 TTL 数据，不调度计时器、不写持久历史、不调用工具。**
- **设置 UI、发布审计和性能预算继续由 `verify:pr` 与预发布门禁保护。**
- **这仍然不是 0.5；桌宠跟随鼠标、打字反应和窗口控制留给后续版本。**

## 上次更新 — v0.4.1

> **主题：陪伴 UI、设置和可靠性加固。** 中文说明见 [RELEASE-NOTES-v0.4.1.zh-CN.md](docs/RELEASE-NOTES-v0.4.1.zh-CN.md)，英文完整说明见 [RELEASE-NOTES-v0.4.1.md](docs/RELEASE-NOTES-v0.4.1.md)。

0.4.1 把 v0.4 的陪伴感知地基推进到更适合公开测试的形态：主对话面板、设置页和 Image4 伙伴场域被拆成更清楚的源码边界；设置入口继续保持懒加载；隐私、安全、UI 和性能审计进入 `verify:pr`，让后续迭代不容易悄悄退化。

一句话记住 0.4.1：

- **主对话面板、设置页和 Image4 伙伴场域更接近统一的陪伴式视觉系统。**
- **设置抽屉样式保持懒加载，打开设置不再把大段 CSS 塞进 JS 热路径。**
- **时间表达继续保持粗粒度，不允许精确到分秒的陪伴计时泄漏。**
- **新增多组 source-only UI、隐私、安全和性能审计，上传前已跑完整 `verify:pr`。**
- **这仍然不是 0.5；桌宠跟随鼠标、打字反应和窗口控制留给后续版本。**

## 更早更新 — v0.4.0

> **主题：桌面陪伴感知地基。** 中文说明见 [RELEASE-NOTES-v0.4.0.zh-CN.md](docs/RELEASE-NOTES-v0.4.0.zh-CN.md)，英文完整说明见 [RELEASE-NOTES-v0.4.0.md](docs/RELEASE-NOTES-v0.4.0.md)。

0.4.0 正式开始“打开 Nexus 后，它能安静理解时间流逝”的桌面陪伴感知。它会优先保持安静，只形成短期、粗粒度、可暂停和可清理的陪伴摘要；进入模型的是脱敏摘要，不是原始截图、完整剪贴板、私人消息或精确计时。

一句话记住 0.4.0：

- **打开 Nexus 后，即使你去电脑别处工作，陪伴感也不会立刻断掉。**
- **时间说法是“一会儿 / 半小时左右 / 一小时左右”，不是精确到分秒。**
- **Memory 设置里能看到说明，并能暂停或清理近期陪伴摘要。**
- **这个稳定版先打好安静观察地基，不扩展主动 check-in。**
- **0.5 才做桌宠跟随鼠标、打字反应和窗口互动。**

## 旧版本记录

README 顶部只保留当前代码版本 v0.4.2 和上一稳定入口 v0.4.1 的重点。更早版本的完整历史统一放在 [CHANGELOG](CHANGELOG.md) 和 [GitHub Releases](https://github.com/FanyinLiu/Nexus/releases)，避免首页继续滚动维护旧版本号。

## 设计原则

- **常驻但不打扰**：它可以一直在桌面上，但不能干扰用户工作。
- **本地优先**：能在本机完成的能力优先在本机完成。
- **先陪伴，再自动化**：没有稳定的陪伴体验，自动任务只会像外挂功能。
- **先简单，再拟真**：先用极简头像跑通体验，再考虑 Live2D、语音和复杂人格。
- **用户授权**：涉及文件、系统、网络、工具和任务执行时，必须让用户明确知道它要做什么。

## 当前技术方向

第一阶段建议保持技术栈简单：

- Electron：桌面窗口和系统集成。
- React：界面和状态组织。
- TypeScript：主进程、渲染层和共享类型。
- Vite：开发和构建。
- Ollama / DeepSeek：第一阶段文本模型连接。

第一阶段的重点是桌面窗口、头像显示、Ollama / DeepSeek 文本对话链路和基础状态管理。其他能力先作为未来方向记录，不作为当前开发重点。

## 安装与更新

普通用户的安装主路径不是 npm，而是桌面安装包：

- Windows：从 GitHub Releases 下载 `Nexus-Setup-<版本号>.exe`。
- macOS：下载 `.dmg` 或 `.zip`，把 `Nexus.app` 放进 `/Applications`。
- Linux：下载 `.AppImage` 或 `.deb`，可用 `SHA256SUMS` 和可选 GPG 签名校验。

### 未签名安装提示（macOS / Windows）

当前桌面安装包还没有 Apple Developer ID、公证和 Windows 代码签名证书，所以首次启动会看到系统信任提示。这是当前发布状态，不代表安装包来自第三方镜像。只从 [GitHub Releases](https://github.com/FanyinLiu/Nexus/releases/latest) 下载；如果你不确定文件来源，删除它并重新从 GitHub Releases 下载，不要从镜像或转载压缩包安装。

- **macOS / Gatekeeper**：把 `Nexus.app` 放进 `/Applications` 后，可以右键点击 Nexus.app -> 打开 -> 在弹窗中确认；也可以在终端运行 `xattr -dr com.apple.quarantine /Applications/Nexus.app`。
- **Windows / SmartScreen**：运行 `Nexus-Setup-<版本号>.exe` 后，如果看到“Windows 已保护你的电脑”，点击“详细信息”，再点击“仍要运行”。

安装版会通过 GitHub Releases + `electron-updater` 检查更新。当前 Windows / Linux 路径可以继续走现有安装包更新；macOS 未签名包在完成 Developer ID 签名和公证前，只会检查新版本并打开 release 页面，由用户手动下载升级，不把它当作已验证的一键自动更新。预发布版本只给手动验证，不会把稳定版用户自动升级到 beta；稳定版发布后，稳定版和 beta 用户都会按版本号升级到新的稳定版。

npm 不是普通用户的安装主路径。这个仓库的 npm 命令只给开发者使用：启动开发环境、打包安装包、运行自检和发布前检查。普通用户只需要下载桌面安装包，并通过应用内更新获得后续版本。

## 已知限制与适用人群

Nexus 仍在活跃开发，更适合愿意测试本地 AI 桌面伙伴、能接受手动确认权限和反馈问题的用户。普通用户可以体验稳定入口，但不应该把当前版本当成已经完成商业签名、企业级运维和零配置交付的成熟软件。

| 限制 | 当前状态 | 建议 |
|---|---|---|
| 未签名安装包 | Windows / macOS 首次启动会出现 SmartScreen 或 Gatekeeper 提示。 | 只从 GitHub Releases 下载；不确定来源时删除后重新下载。 |
| 资源占用 | Electron、Live2D、语音、OCR、WASM 和本地模型会带来一定内存、包体和首次运行下载成本。 | 先用文本模型主路径；语音、本地识别和桌面感知按需开启。 |
| provider 联网 | Ollama 可以本地运行；DeepSeek、OpenAI-compatible 和其他云 provider 会把请求发给对应服务商。 | 使用前确认 provider 的数据政策；API Key 只保存在本机加密存储里。 |
| 桌面感知 | v0.4.2 保持短期、粗粒度、可暂停和可清理的陪伴摘要，并继续阻止精确计时和原始桌面内容进入模型边界。 | 在 Memory 设置里查看说明，按需要暂停或清理近期陪伴摘要。 |
| 语音和本地模型 | 本地语音模型、麦克风权限和平台音频设备可能影响语音链路。 | 语音失败时先回到文字对话；用设置里的自检和模型向导排查。 |

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

发布验收或问题报告需要结构化结果时，可以导出本地 JSON 自检报告：

```bash
npm run doctor -- --json
```

JSON 报告只记录检查结果、运行环境和推荐路径；不会写入 API Key、聊天内容、模型输出或 provider secret。离线 CI 可以加 `--skip-network` 跳过端口探测。

首次启动和模型修复链路的快速验收门禁：

```bash
npm run verify:first-run
```

它会检查 doctor JSON 隐私边界、模型配置预检、向导修复、首次对话计时、基础检查报告和 i18n 完整性；完整发布前仍需运行全量测试、构建和打包冒烟。

常用命令：

```bash
npm run build
npm run lint
npm test
npm run verify:first-run
npm run distribution:audit
```

## 贡献方向

当前最有价值的贡献不是加大功能，而是把第一阶段闭环做扎实：

- 让小窗口更稳定、更轻量。
- 让头像形象更清楚，但不过度复杂。
- 让 Ollama / DeepSeek 配置和错误提示更好懂。
- 让简单对话流程稳定可靠。
- 保持 README、路线图和实际开发重点一致。

想参与但不想改核心代码，也可以从社区内容开始：

- 桌宠包、头像素材和动作预览。
- 人格模板、提示词样例和对话场景。
- 本地模型配置菜谱。
- 安装教程、踩坑记录和翻译。
- v0.4 桌面陪伴感知的使用反馈：时间说法是否自然、提醒是否太频繁、暂停是否明显。

社区文档不是某个版本的小功能，而是项目长期变大的入口。社区入口见
[COMMUNITY.md](docs/COMMUNITY.md)，0.4 系列方向见
[v0.4 Desktop Companion Awareness](docs/V0.4_DESKTOP_COMPANION_AWARENESS.md)，
0.4 最新稳定版说明见
[RELEASE-NOTES-v0.4.2.md](docs/RELEASE-NOTES-v0.4.2.md)，
发布加固清单见
[RELEASE-CANDIDATE-v0.4-HARDENING.md](docs/RELEASE-CANDIDATE-v0.4-HARDENING.md)。
提交人格、提示词或桌宠素材前，请先看 [Nexus Companion Prompt Baseline](docs/NEXUS_COMPANION_PROMPT.md)；
它定义了 Nexus 的稳定身份、边界和社区投稿格式。新人格可以从
[Persona Contribution Template](docs/PERSONA_CONTRIBUTION_TEMPLATE.md) 开始填。

## 项目边界

Nexus 的长期想象空间很大，但当前最重要的是把方向讲清楚：

**Nexus 是一个住在电脑里的 AI 伙伴。**

它会先从一个能常驻桌面、能连接本地模型、能简单对话的小伙伴开始。等这个体验成立之后，再逐步加入语音、记忆、桌宠动作和授权辅助能力。

## License

Released under the [MIT License](LICENSE).

Bundled Live2D sample characters are subject to Live2D's separate terms. See
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) before redistributing Nexus.
