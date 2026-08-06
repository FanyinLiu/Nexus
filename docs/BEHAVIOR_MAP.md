# Nexus Behavior Map（行为→代码定位图）

> 用途：coding agent 接到修改任务时，先读本文件定位行为域和文件，再下钻源码，不要全文 grep。
> 维护：行为域增删或文件迁移时同步更新。最后更新 2026-07-24（P3 升级后：TS7 双栈 / pixi.js 8 / Electron 43）。

## 0. 系统总览

Nexus 是 Electron 桌面伴侣应用（Live2D/sprite 宠物 + 聊天 + 语音 + 记忆 + 本地优先）。

- **主进程**（`electron/`，CommonJS .js）：窗口、IPC、密钥库、模型管理、TTS/STT 本地服务、网关（Telegram/Discord）、MCP/plugin 宿主、审计。**持久状态和敏感能力的权威端。**
- **渲染进程**（`src/`，TS/TSX，Vite 构建）：React 应用壳、聊天面板、宠物渲染、设置、语音 UI。
- **入口**：`electron/main.js`（主）、`src/app/main.tsx` → `src/app/App.tsx`（渲染）。
- **桥**：`electron/preload.js` + `electron/ipc/*Ipc.js`（每个域一个 IPC 模块 + payload schema 校验）。
- 架构基线详见 `docs/ARCHITECTURE.md`；发布流程见 `docs/RELEASING.md`。

## 1. 行为域 → 文件

### 聊天 / LLM 对话
- 行为：发送消息、流式回复、工具调用循环、系统提示词组装、记忆/上下文注入、failover
- 渲染：`src/features/chat/`（`runtime.ts` 主循环、`toolCallLoop.ts`、`systemPromptBuilder.ts`、`contextCompaction.ts`、`memoryInjection.ts`、`failoverChain.ts`、`prompts/`）
- 钩子：`src/hooks/chat/`
- 主进程：`electron/chatRuntime.js`、`electron/ipc/chatIpc.js`

### Agent 自主任务（errand / open goals）
- 行为：后台任务、差事执行、开放目标追踪、agent trace
- `src/features/agent/`（`agentLoop.ts`、`errandRunner.ts`、`errandPolicy.ts`、`errandStore.ts`、`openGoalsStore.ts`、`backgroundTaskStore.ts`）
- 自治 v2 决策：`src/features/autonomy/v2/`（`orchestrator.ts`、`decisionEngine.ts`、`decisionPrompt.ts`、`contextGatherer.ts`、`personaGuardrail.ts`、`prompts/`）
- 控制器：`src/app/controllers/useAutonomyController.ts`、`useAutonomyV2Engine.ts`

### 语音输出 TTS
- 行为：TTS 合成、流式播放、唇形同步、多 provider
- 渲染：`src/features/voice/`（`streamAudioPlayer.ts`、`voiceSessionMachine.ts`、`speechReply.ts`）
- 主进程：`electron/ttsStreamService.js`、`electron/services/ttsService.js`、`ttsProviders.js`、`edgeTts.js`、`localTts.js`、`ttsVolcengine.js`、`electron/ipc/ttsStreamIpc.js`

### 听觉 / STT / 唤醒词
- 行为：麦克风监听、VAD、唤醒词、本地/云 ASR
- 渲染：`src/features/hearing/`（`hearingRuntime.ts`、`wakewordRuntime.ts`、`wakewordListener.ts`、`browserVad.ts`、`tencentAsr.ts`）
- 主进程 sherpa 本地模型：`electron/sherpaKws.js`、`sherpaVad.js`、`sherpaParaformer.js`、`sherpaSenseVoice.js`、`electron/services/sttService.js`、`electron/ipc/sherpaIpc.js`

### 视觉 / 桌面感知
- 行为：截屏、OCR、VLM 分析、桌面上下文采集
- `src/features/vision/`（`captureQueue.ts`、`ocrWorker.ts`、`vlmAnalysis.ts`）
- 桌面上下文：`src/features/context/`（`desktopContext.ts`、`gameContext.ts`、`companionAwareness*.ts`）
- 主进程：`electron/services/desktopContextService.js`、`desktopContextPrivacy.js`、`electron/ipc/desktopContextAudit.js`

### 记忆系统
- 行为：记忆写入/召回、向量检索、聚类、衰减、叙事记忆、那年今日、反思
- `src/features/memory/`（`memory.ts` 核心、`recall.ts`、`vectorSearch.ts`、`clustering.ts`、`decay.ts`、`narrativeMemory.ts`、`reflectionGenerator.ts`、`coldArchive.ts`、`onThisDay*.ts`）
- 主进程：`electron/services/localDataMemoryStore.js`、`memoryVectorStore.js`、`vectorSearchWorker.js`、`bm25Search.js`、`electron/ipc/memoryIpc.js`

### 宠物 / Live2D / sprite 渲染
- 行为：宠物渲染、Live2D 模型加载、表情/眨眼/帧渲染、sprite 宠物、移动、VTube Studio 桥
- 渲染：`src/features/pet/`（`spriteRuntime.ts`、`presence.ts`、`activityState.ts`、`idleSequence.ts`、`performance.ts`）
- Live2D：`src/features/pet/components/live2d/`（`lifecycle.ts` 加载生命周期、`frameRender.ts`、`expressions.ts`、`blink.ts`、`vendor.ts` — **pixi.js 8 + jannchie Live2D 包**，见 §3）
- VTS：`src/features/pet/vts/`、`electron/services/vtsBridge.js`、`electron/ipc/vtsBridgeIpc.js`
- 主进程模型服务：`electron/services/petModelService.js`、`live2dModelDiscoveryService.js`、`spritePet*.js`、`electron/petLocomotion.js`、`petWindowInstances.js`

### 工具 / MCP / 插件
- 行为：内置工具执行、web 搜索、天气、MCP 服务器宿主、插件宿主与消息总线
- 渲染：`src/features/tools/`（`registry.ts`、`builtInToolExecutor.ts`、`builtInToolSchemas.ts`、`permissions.ts`、`circuitBreaker.ts`）
- 主进程：`electron/tools/toolRegistry.js`、`webSearch.js`、`weatherTool.js`、`electron/webSearchRuntime.js`、`webSearchProviderRunners.js`
- MCP：`electron/services/mcpHost.js`、`mcpApprovals.js`、`electron/ipc/mcpIpc.js`
- 插件：`electron/services/pluginHost.js`、`pluginMessageBus.js`、`electron/ipc/pluginIpc.js`

### 模型 / provider 管理
- 行为：provider 目录、连接测试/修复、模型下载管理、本地模型
- 渲染：`src/features/models/`（`providerCatalog.ts`、`discovery.ts`、`connectionPreflight.ts`、`connectionRepair.ts`）
- 主进程：`electron/services/modelManager.js`、`modelDownloader.js`、`modelDefinitions.js`、`modelPaths.js`、`pythonRuntime.js`
- 核心路由：`src/core/routing/`、`src/core/sessions/`、`src/core/budget/`

### 集成（Telegram / Discord / 游戏）
- 行为：消息网关收发、webhook、外部动作策略
- 主进程：`electron/services/telegramGateway.js`、`discordGateway.js`、`factorioRcon.js`、`minecraftGateway.js`、`electron/integrationRuntime.js`、`electron/ipc/telegramIpc.js`、`discordIpc.js`、`externalActionPolicyIpc.js`
- 渲染控制器：`src/app/controllers/useTelegramBridge.ts`、`useDiscordBridge.ts`、`telegramMessageRouter.ts`、`discordMessageRouter.ts`
- 策略：`src/features/integrations/`（`permissions.ts`、`allowlists.ts`）、`electron/services/externalActionPolicy*.js`

### 窗口 / Electron 壳
- 行为：窗口创建/管理、面板窗口、托盘、启动项、导航
- `electron/windowManager.js`、`windowCreation.js`、`panelWindowController.js`、`windowNavigation.js`、`windowRuntimeState.js`、`launchOnStartup.js`、`electron/ipc/windowIpc.js`
- 渲染视图：`src/app/views/`、`src/features/panelScene/`、`src/features/uiV2/`

### 数据持久化 / 密钥
- 行为：本地数据存储（聊天/记忆/设置）、safeStorage 密钥库、迁移
- `electron/services/localDataStore.js`、`localDataStoreCore.js`、`localDataChatStore.js`、`keyVault.js`、`localData*Migration.js`、`electron/ipc/localDataIpc.js`
- 渲染：`src/lib/storage/`、`src/lib/privacy/`

### 设置 / i18n / 主题 / 新手引导
- 设置 UI：`src/features/settingsV3/`、`src/components/settingsSections/`、`src/app/controllers/useSettingsNavigation.ts`
- i18n：`src/i18n/locales/<lang>/`（**P2 后按域拆分目录**，如 `zh-CN/settings-memory.ts`、`en/core.ts`、`en/index.ts`）
- 主题：`src/features/themes/`、`src/app/settingsStyles*.ts`
- 引导：`src/features/onboarding/`、`src/features/setup/`

### 主动关怀 / 通知 / 提醒
- `src/features/proactive/`（`awayScheduler.ts`、`bracketScheduler.ts`）、`electron/services/proactiveNotification.js`、`notificationBridge.js`、`macNotificationWatcher.js`
- 提醒：`src/features/reminders/`、`src/app/controllers/useReminderController.ts`

### 更新 / 安全 / 审计
- 更新：`electron/services/updaterService.js`、`updatePolicy.js`、`electron/ipc/updaterIpc.js`
- 安全：`electron/services/urlSafety.js`、`errorRedaction.js`、`auditLog.js`、`modelDownloadSecurity.js`、`electron/ipc/*Audit.js`、`trustedSenderPolicy.js`
- 渲染安全域：`src/features/safety/`

## 2. 测试与门禁

- 测试：`tests/`（node:test，2985 个，**不许通过改测试让门禁变绿**）
- 审计脚本：`scripts/*audit*.mjs`（i18n/ipc/storage/source-size/heavy-module/architecture-boundary 等），`npm run verify:release` 是发布总门禁
- 构建：`scripts/build.mjs`（vite + 构建完整性哈希）

## 3. P3 技术债与坑（2026-07-24）

1. **TS7 双栈**：`package.json` 主依赖 `typescript@^7.0.2`（给 `npx tsc` 用）；`scripts/typescript-classic-shim.mjs`（postinstall）让 `require('typescript')` 解析到 TS 6.0.3 经典 API（ESLint/脚本/测试依赖）。跟踪 typescript-eslint #10940，支持 TS7 后删 shim。
2. **Live2D on pixi.js 8**：用的是 jannchie 的 pixi-live2d 兼容包（非官方 pixi-live2d-display）。自动化测试不覆盖 GPU 渲染，改动 `live2d/` 后必须真实窗口冒烟。
3. ~~ESLint 10 新规则~~（已解决 2026-07-24：`no-useless-assignment` 38 处 + `preserve-caught-error` 24 处已修，规则已重新打开，commit eb220bf / 6468106）。
4. **jannchie UMD 的 process.env**：`scripts/setup-vendor.mjs` 会在拷贝时把 `process.env.NODE_ENV` 内联为 `"production"`（经典 script 无 process）。升级该包后必须重跑 `node scripts/setup-vendor.mjs` + `live2d:three-model:smoke`（commit 538a646）。
5. i18n locale 已按域拆目录（P2），新增文案键要进对应域文件，不要新建单文件 locale。zh-CN 是 key 集合的唯一真源：各域文件 `as const satisfies Partial<TranslationDictionary>`、聚合字典 `satisfies TranslationDictionary`，tsc 编译期双向钉死 union ↔ zh-CN key 集合——加/删 key 只需改 `src/types/i18n.ts`（或 `src/types/i18nKeys/*`）的 union 类型 + 5 个 locale 的对应域文件，无生成步骤；`verify:pr` 里的 `i18n:audit` 负责其他 locale 对 zh-CN 的 parity。
6. **vault IPC 已 schema 化**（2026-08-01）：`vault:*` 通道收对象 payload（preload 内部把不变的位置参数签名包装成对象，渲染侧 0 调用点改动、明文不经新层），校验在 `electron/ipc/vaultPayloadSchemas.js`（`unknown:'reject'`）；store-many 线上格式为 `{slot, plaintext}` 数组。选 schema 化而非保留 manual，是为与其余 high-risk 通道的 strip→reject 收口一致。

## 4. 使用规程（给 coding agent）

1. 任务 → 在 §1 找到行为域 → 读列出的 2-4 个核心文件确认现状
2. 跨域改动（常见：聊天+记忆、语音+宠物唇形）两个域的文件都要读
3. 改 IPC 面必须同步 payload schema（`electron/ipc/*PayloadSchemas.js`）和对应审计
4. 收工前：`npx tsc -b` + `npm run lint` + `npm run build` + `npm test` 全绿才算完
