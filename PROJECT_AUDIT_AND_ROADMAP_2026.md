# Nexus 全量代码审查、开源对标与 1 年升级计划

审查日期：2026-05-01  
审查范围：`/Users/klein/Projects/Nexus` 当前工作树、本地发布脚本、测试覆盖、依赖状态、GitHub/开源同类项目公开资料。

## 0. 针对三条审查发现的落地状态（2026-05-01 更新）

- [x] Finding 1（Vault 明文跨 IPC）已修复：
  `vault:retrieve` / `vault:retrieve-many` 改为返回 opaque ref，renderer 不再直接拿明文；在 main 进程 outbound handler 中按 sender 绑定解析 ref。
- [x] Finding 2（URL 安全缺 DNS/redirect 复核）已修复：
  新增 DNS 解析复核 `checkUrlSafetyWithDns`，并在 RSS 与 web-search preview fetch 链路改为手动 redirect + 每跳复核。
- [x] Finding 3（CI typecheck 空转）已修复：
  CI 中 Type check 已从 `npx tsc --noEmit` 改为 `npx tsc -b --force`。

## 0.1 三系统对齐专项（macOS / Windows / Linux）

本轮按“对齐 macOS 体验”为目标，已完成的跨平台改动：

- [x] Windows 图标链路统一：`app.setAppUserModelId` + `win.setAppDetails` + tray 使用同源 `.ico`，任务栏/托盘身份一致。
- [x] 登录启动对齐：Windows/macOS/Linux 都支持启动项；Linux 增加 XDG autostart（`~/.config/autostart/nexus-autostart.desktop`）。
- [x] 启动行为对齐：检测登录启动后，若托盘可用则默认后台启动，避免抢焦点。
- [x] 生命周期对齐：关闭窗口在“有托盘/可恢复”场景走 hide-to-background；无托盘场景直接退出，避免僵尸进程。
- [x] Linux 兼容对齐：Wayland 会话默认优先 XWayland（可通过 `NEXUS_LINUX_USE_WAYLAND=1` 显式切回），降低窗口行为差异。
- [x] Linux 媒体与上下文能力补齐：`playerctl` 系统媒体控制、`xdotool + ps + /proc` 前台窗口上下文采集。
- [x] UI 安全对齐：Vault 从明文跨 IPC 改为 opaque ref 后，设置/引导页输入框不再显示 ref token，只保留底层引用。
- [x] 性能对齐：  
  1) `media-session:get` 增加短 TTL + 并发去重缓存，减少 Win/Linux shell 抖动；  
  2) 截图上下文增加 TTL + 并发去重缓存，减少高频抓屏开销。

本轮验证结果：

- `npm run lint` ✅
- `npm test` ✅（1209/1209）
- `npm run build` ✅
- `npm run package:dir:smoke` ✅（本地 unpacked 打包烟测，不发布）
- 语音高风险文件专项覆盖 ✅：`browserVad` / `wakewordListener` / `wakewordRuntime` / `runtimeSupport` 合计 line 86.50%、branch 70.72%、function 75.68%。

发布策略说明（按你的要求）：

- 本轮只做检查与推进，不做发版动作，不打 tag，不推 release。

## 0.2 下一步升级执行计划（当前已开始）

优先级从“先证明三系统一致”开始，而不是继续堆功能：

1. [x] 跨平台 packaged smoke 门禁：新增 `scripts/packaged-smoke.mjs`，CI 在 Windows/macOS/Linux 上执行 `electron-builder --dir` 后启动打包产物并确认 renderer 能加载。
2. [x] 运行时能力矩阵继续扩展：`platformProfile` 已扩到 Context、Voice、Media Session；Linux 的 `playerctl`、`xdotool/xprop + X11/XWayland DISPLAY`、截图/剪贴板所需 display session 会在主进程检测，设置页与后台上下文/媒体轮询会按能力自动降级。
3. [x] 高风险语音覆盖率补齐：已补 `browserVad`、`runtimeSupport`、`wakewordListener`、`wakewordRuntime` 的故障注入测试；目标文件合计 line 86.50%、branch 70.72%，`runtimeSupport` line 93.26%。
4. [x] IPC schema rollout 第一段：已新增纯 JS `schemaValidator` 与 `payloadSchemas`，并覆盖 window/panel state、window drag/open panel、runtime heartbeat/update、desktop context、media control、audio list/transcribe/synthesize；新增 schema 成功/失败测试。
5. [x] IPC schema rollout 第二段：已覆盖 chat/service/tools/memory/workspace/mcp/plugin 的主要 renderer-visible payload；保留兼容性 strip 策略，并新增大对象、路径、命令、向量、插件参数的 schema 成功/失败测试。
6. [ ] IPC schema rollout 第三段：对高风险入口逐步把未知字段策略从 strip 收紧到 reject，并补调用侧兼容清理。
7. [ ] Memory 存储迁移预备：先抽象主进程 storage adapter，不直接迁大数据，避免一次性改动过大。

## 1. 当前项目状态

- 项目类型：Electron + React + TypeScript 桌面 AI companion。
- 当前版本：`package.json` 为 `0.3.1`；GitHub 最新 release 为 `v0.3.1`，发布时间 2026-04-28。
- Git 状态：`main` 分支领先 `origin/main` 16 个提交；当前工作树包含本轮跨平台、安全、性能、语音覆盖与文档改动，尚未发布、未打 tag。
- 代码规模：`src/electron/tests` 约 127,419 行；`src/electron/tests/docs` 文件数约 737；工作区约 2.1 GB，其中 `sherpa-models` 约 508 MB，`dist` 约 71 MB。
- 当前未提交改动方向：把后台 scheduler 聚合进 `useBackgroundSchedulers`，把 `errandRunner` 的状态持久化拆到 `errandRunnerState`，并延迟加载 agent 执行路径以减小首包压力。

## 2. 本地验证结果

已通过：

- `npm run verify:release`：通过 `tsc -b --force`、ESLint、1181 个 node test、生产构建。
- `npm audit --omit=dev --audit-level=moderate`：0 vulnerabilities。
- `npm audit --audit-level=moderate`：0 vulnerabilities。
- 覆盖率命令：1181 个测试全通过；`src/features/**/*.ts` line coverage 88.10%，branch coverage 77.62%，function coverage 78.44%。
- 生产构建主要包：`app-runtime` 约 52.94 KB，`transformers-vendor` 约 869.89 KB，`ort-wasm-simd-threaded` 约 21.6 MB。

阻塞项：

- `npm run prerelease-check -- v0.3.1 --quick` 明确失败 5 项：本地 tag 已存在、远端 tag 已存在、工作树不干净、HEAD 不等于 `origin/main`、当前 HEAD 没有 CI 成功记录。
- 这不是代码质量失败，而是发布流程正确阻止了“重复发布已存在的 v0.3.1”。下一版必须使用新 tag，例如 `v0.3.2` 或 `v0.4.0`。

依赖过期观察：

- 可做 patch/minor 升级：`electron 41.3.0 -> 41.4.0`、`onnxruntime-web 1.24.3 -> 1.25.1`、`sherpa-onnx-node 1.12.39 -> 1.13.0`、`vite 8.0.9 -> 8.0.10`、`eslint-plugin-react-hooks 7.0.1 -> 7.1.1`。
- 需要单独迁移评估的 major：`@huggingface/transformers 3.8.1 -> 4.2.0`、`pixi.js 6.5.10 -> 8.18.1`、`typescript 5.9.3 -> 6.0.3`、`eslint 9.39.4 -> 10.3.0`。

## 3. 代码审查结论

### 3.1 主要优势

- 产品定位清晰：不是通用 ChatGPT shell，而是“本地优先、长期关系、记忆 ritual、Live2D/voice presence”的 companion。
- Electron 边界比普通独立项目成熟：`contextIsolation: true`、`sandbox: true`、`nodeIntegration: false`、导航守卫、外链规范化、workspace symlink 防逃逸都有对应测试。
- 发布门禁已经形成体系：typecheck、lint、test、build、bundle、CSP、audit、license、docs、privacy governance 等都有脚本化检查。
- 测试数量和核心算法覆盖良好：memory、autonomy、voice state machine、web search、workspace fs、window navigation、安全提示都有单元测试。
- 文档/README/多语言对齐度高，当前 v0.3.1 的安全和已知 deferred 项透明。

### 3.2 高优先级风险

1. 发布状态不可用作新版本。
   当前 `v0.3.1` tag 已经在本地和远端存在，而且 release 是 immutable。继续把当前代码打 `v0.3.1` 会破坏版本语义。下一次必须 bump 到 `0.3.2` 或 `0.4.0`。

2. Vault 主链路已切到 opaque ref，但 ref 生命周期治理仍需继续强化。
   目前 renderer 不再拿明文，主进程 outbound handler 会按 sender 解析 ref；后续建议补“引用生命周期策略（失效/轮换）+ 全量 IPC schema 化”，避免未来插件生态扩大后出现新旁路。

3. URL safety 的 DNS/redirect 复核已补齐，需持续扩展到新增网络入口。
   RSS 与网页 preview 已改为“每跳重定向 + DNS/IP 复核”；后续新增联网工具或 webhook 新路径时，必须沿用同一套安全复核基线。

4. macOS/Windows 信任链仍是发行瓶颈。
   当前 README 解释了 unsigned 警告；`package.json` 中 macOS `hardenedRuntime: false`、`gatekeeperAssess: false`，Windows package 默认 `signAndEditExecutable=false`。对早期用户能接受，但会明显限制传播、自动更新和安全信任。

### 3.3 中优先级风险

1. CI TypeScript 步骤已纠偏，后续需要补“发布前跨平台 smoke 自动化”。
   当前 Type check 已改为 `npx tsc -b --force`；下一步应把 macOS/Windows/Linux 的 packaged smoke 纳入同一条 release 门禁，避免仅靠本地手工验证。

2. 高风险 runtime 模块覆盖不足。
   覆盖率低的关键模块包括 `features/hearing/wakewordListener.ts` 18.14%、`features/voice/runtimeSupport.ts` 21.72%、`features/reminders/schedule.ts` 42.82%、`features/tools/registry.ts` 49.55%、`features/hearing/browserVad.ts` 49.08%。这些都属于用户可感知故障面，应补测试。

3. IPC schema 还不统一。
   `validate.js` 已有轻量 validator，但不是所有 IPC handler 都有结构化 payload schema。当前靠服务层兜底尚可；如果后续做插件/marketplace，需要把 renderer-visible IPC 全量 schema 化。

4. 单文件复杂度仍偏高。
   超过 700 行的文件包括 5 个 locale、`keys.ts`、`electron/windowManager.js`、`features/pet/performance.ts`、`hooks/useChat.ts`、`hooks/chat/assistantReply.ts`、`hooks/useVoice.ts`、`SettingsDrawer.tsx`。这不是立即 bug，但会拖慢长期维护。

5. localStorage 承载的数据越来越重。
   当前 memory、timeline、metering、letters、chat 等大量依赖 localStorage。对 v0.x 可接受，但长期 memory/yearbook/affect timeline 建议迁移到主进程文件或 SQLite 层，避免 quota、同步阻塞和跨窗口一致性问题。

## 4. 对标项目解读

### Nexus

Nexus 的差异化不是“模型最多”或“RAG 最强”，而是长期 companion ritual：significance-weighted memory、nightly dream、callback queue、anniversary、morning/evening bracket、Sunday letter、background errand。GitHub 当前约 9 stars、2 forks，属于早期单作者项目。优势是产品诗性和关系系统纵深；短板是生态、分发信任、社区规模和成熟安装体验。

### Open WebUI

Open WebUI 是自托管 AI 平台，GitHub 约 135k stars、19.2k forks，最新版 `v0.9.2` 在 2026-04-24。它强调离线运行、多模型、RAG、voice/video call、Python function calling。对 Nexus 的启发是：知识库、插件/工具工作区、社区规模和部署成熟度。但它不是桌面 companion，缺少 Live2D、关系记忆 ritual 和长期情感节奏。

### LobeHub

LobeHub 约 75.9k stars、15k forks，已从 LobeChat 演进为 agent workspace。它强调 agent teammates、agent groups、schedule、personal memory、MCP marketplace、desktop app、artifacts、knowledge base 和 TTS/STT。它是 Nexus 在“agent 生态 + marketplace + white-box memory”上的强对标。Nexus 应学习它的 agent 编排和记忆可编辑性，但不应追随成泛工作台。

### Cherry Studio

Cherry Studio 是跨平台桌面 LLM 客户端，约 44.9k stars、4.3k forks，最新版 `v1.9.4` 在 2026-04-30。它支持多 LLM provider、Ollama/LM Studio、本地模型、300+ assistants、多模型并行、文档/图片/Office/PDF、MCP。它的优势是“开箱即用的桌面 AI 工作台”。Nexus 相比之下 provider 数量和通用生产力弱，但 companion 体验更有独特性。

### Jan

Jan 是本地优先的 ChatGPT replacement，约 42.3k stars、2.8k forks，最新版 `0.7.9` 在 2026-03-23。它强在下载/运行本地模型、隐私、OpenAI-compatible local API、MCP。Nexus 如果要提升本地模型体验，应参考 Jan 的模型管理和本地 server 生态，而不是自己从零构建完整推理平台。

### AnythingLLM

AnythingLLM 官方定位为 MIT、开源、桌面本地、无需账号、文档/RAG/agent/API 一体化。强项是面向普通用户的 document chat、agent skills、data connectors 和本地私有部署。Nexus 可借鉴它的“无需开发者知识”的 onboarding 和文件知识库体验。

### Khoj

Khoj 是 self-hostable personal AI second brain，约 34.3k stars、2.2k forks，最新版 `2.0.0-beta.28` 在 2026-03-26。它强在个人知识、语义搜索、web/docs、custom agents、scheduled automations、deep research。Nexus 的 background errand、Sunday letter、memory timeline 可以借鉴 Khoj 的“可调度个人助理”成熟度。

### SillyTavern

SillyTavern 是本地安装的 power-user LLM frontend，支持大量 LLM API、image generation、TTS、WorldInfo/lorebooks、角色卡、扩展和移动友好界面。它是角色聊天和 AI hobbyist 社区的事实标准之一。Nexus 应兼容其角色卡生态，但不应复制其复杂 prompt 面板；Nexus 的优势是更低干预、更有长期关系形状。

### PyGPT

PyGPT 是跨平台桌面 AI assistant，约 1.8k stars，最新版 `2.7.12` 在 2026-02-06。它覆盖 chat、vision、agents、RAG、image/video generation、computer use、MCP、plugins、voice、web search、memory。它的功能广度很强，对 Nexus 的启发是插件、profile、工具和 sandbox computer use；但它没有 Nexus 的 Live2D companion identity。

### Open Interpreter

Open Interpreter 是自然语言电脑接口，强在本地环境执行、代码/文件/互联网访问、LiteLLM、多模型、本地模式和 voice interface 示例。它不是 companion，但对 Nexus 的 background errand / agent loop 有参考价值：任务执行需要可解释日志、权限确认、文件边界、可中断和结果复现。

## 5. 1 年升级路线

### 2026 Q2：v0.3.2 / v0.3.3 稳定化

目标：不扩功能，先把 v0.3.1 后的质量债收口。

- 发布 `v0.3.2`：合入当前 16 个提交和 scheduler/errand refactor，修 CI TypeScript 步骤，补 release notes。
- 修 URL safety：RSS/web preview fetch 增加 DNS 解析、私网 IP 拒绝、redirect 二次检查。
- 增加 coverage：wakeword listener、voice runtime support、reminder schedule、tool registry 提升到至少 70% line coverage。
- 建立每周 dependency hygiene：Electron/ORT/sherpa/vite 小版本优先；Pixi/Transformers/TypeScript major 单独分支。
- 增加 packaged smoke：至少 macOS arm64 + Windows NSIS 两条手工或 CI smoke path。

### 2026 Q3：v0.4 Trust Release

目标：把“安全可信”和“可分发”变成主线。

- Vault opaque handles：renderer 只拿 handle，密钥只在 main process 的 outbound request handler 中解析。
- IPC schema rollout：所有 renderer-visible IPC 有统一 schema、限流、audit 分类。
- macOS hardened runtime + notarization 准备；Windows signing 方案明确。
- Release workflow 修正 immutable release 的重建策略，避免自动删除已发布 release 的危险路径。
- 隐私页和数据导出：列清楚 localStorage、vault、filesystem、logs、models、webhook token。

### 2026 Q4：v0.5 Memory & Knowledge Release

目标：让 Nexus 的记忆既深又可控。

- White-box memory UI：用户可查看、编辑、固定、删除、导出长期记忆。
- 从 localStorage 逐步迁移重型状态到主进程存储层，优先 memory archive、affect timeline、letters/yearbook。
- 文件/知识库轻量接入：不要追 Open WebUI/AnythingLLM 的全量 RAG，先支持 companion 自己的“可引用资料”。
- 记忆质量评估：重复率、召回命中、误召回、情绪引导后 24h valence delta 的本地仪表。
- 角色卡生态：SillyTavern/Character Card import/export 质量做成稳定卖点。

### 2027 Q1：v0.6 Voice & Presence Release

目标：把长期陪伴体验从“能用”提升到“稳定可信赖”。

- Wake word/VAD/STT/TTS runtime 覆盖率和故障注入测试。
- 设备切换、耳机/扬声器场景、TTS 泄漏防误唤醒。
- Voice latency 指标：first audio、barge-in、no-speech recovery、provider failover。
- Live2D/Pixi 渲染升级评估：Pixi 8 不直接并入主线，先兼容性 branch。
- Accessibility：键盘操作、字幕/转写、降低 motion、低性能模式。

### 2027 Q2：v0.7 Ecosystem / Pre-v1 Release

目标：开放但不失控。

- MCP/插件生态做 allowlist marketplace，不做无限制插件商店。
- Background errand 升级为可审计 task runs：输入、工具、预算、权限、输出、可取消。
- 社区模板：persona、relationship type、voice preset、scene preset、safe tool profile。
- Release health dashboard：crash-free session、本地错误分类、安装失败反馈、issue 模板闭环。
- v1.0 gate：签名/公证、opaque vault、IPC schema、核心 voice 稳定、memory migration、文档完整后再定。

## 6. 下一版发布建议

结论：不要再发布 `v0.3.1`；建议下一版是 `v0.4.0`（minor）。

原因：本轮已经合入三项安全边界修复（Vault opaque ref、DNS+redirect URL safety、CI typecheck 纠偏），不再是纯补丁语义。再写的内容应该控制在：

- 2-3 个小 commit：收口当前 scheduler/errand refactor、补最小回归测试、修文档差异。
- 1 个 release notes commit：`docs/RELEASE-NOTES-v0.4.0.md` + 5 语 README news 同步。
- 代码新增建议不超过 300-600 行，测试/文档新增 100-300 行即可。

发布前必须满足：

1. 工作树 clean，未跟踪文件纳入提交或删除。
2. `package.json` bump 到 `0.4.0`。
3. `npm run verify:release` 通过。
4. `npm run prerelease-check -- v0.4.0 --quick` 通过；正式发版前跑 full，除非 smoke/coverage 有明确跳过理由。
5. 推送到 `origin/main` 后等待 CI 在当前 HEAD 成功。
6. 只打新 tag：`v0.4.0`。

## 7. 参考来源

- Nexus GitHub release v0.3.1: https://github.com/FanyinLiu/Nexus/releases/tag/v0.3.1
- Nexus repository: https://github.com/FanyinLiu/Nexus
- Open WebUI: https://github.com/open-webui/open-webui
- LobeHub: https://github.com/lobehub/lobehub
- Cherry Studio: https://github.com/CherryHQ/cherry-studio
- Jan: https://github.com/janhq/jan
- AnythingLLM: https://anythingllm.com/
- Khoj: https://github.com/khoj-ai/khoj
- SillyTavern: https://github.com/SillyTavern/SillyTavern
- PyGPT: https://github.com/szczyglis-dev/py-gpt
- Open Interpreter: https://github.com/OpenInterpreter/open-interpreter
