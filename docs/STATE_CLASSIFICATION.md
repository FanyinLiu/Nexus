# Nexus 状态分类总表

> Workstream 1 产出物 | 生成日期: 2026-04-05
>
> 目的: 列出所有核心状态、分清持久/临时、确定唯一权威源、标记重复同步风险。

---

## 1. 持久状态 (Persistent State)

存储在 localStorage / Electron 加密 vault / 文件系统，重启后保留。

### 1.1 localStorage (via `src/lib/storage.ts`)

| # | Storage Key | 数据类型 | 写入方 | 读取方 | 默认值 | 上限 |
|---|------------|---------|--------|--------|--------|------|
| 1 | `nexus:settings` | `AppSettings` (~100 字段) | `saveSettings()` | `loadSettings()` + migration | `defaultSettings` | - |
| 2 | `nexus:chat` | `ChatMessage[]` | `saveChatMessages()` | `loadChatMessages()` | `[]` | - |
| 3 | `nexus:memory:long-term` | `MemoryItem[]` | `saveMemories()` | `loadMemories()` | `[]` | - |
| 4 | `nexus:memory:daily` | `DailyMemoryStore` | `saveDailyMemories()` | `loadDailyMemories()` | `{}` | - |
| 5 | `nexus:reminder-tasks` | `ReminderTask[]` | `saveReminderTasks()` | `loadReminderTasks()` | `[]` | - |
| 6 | `nexus:voice-pipeline` | `VoicePipelineState` | `saveVoicePipelineState()` | `loadVoicePipelineState()` | `{step:'idle',...}` | - |
| 7 | `nexus:voice-trace` | `VoiceTraceEntry[]` | `saveVoiceTrace()` | `loadVoiceTrace()` | `[]` | 8 条 |
| 8 | `nexus:debug-console-events` | `DebugConsoleEvent[]` | `saveDebugConsoleEvents()` | `loadDebugConsoleEvents()` | `[]` | 60 条 |
| 9 | `nexus:onboarding` | `{completedAt?}` | `saveOnboardingCompleted()` | `loadOnboardingCompleted()` | `null` | - |
| 10 | `nexus:ambient-presence` | `AmbientPresenceState\|null` | `saveAmbientPresence()` | `loadAmbientPresence()` | `null` | 含过期检查 |
| 11 | `nexus:presence-activity-at` | `number` (ms) | `savePresenceActivityAt()` | `loadPresenceActivityAt()` | `Date.now()` | - |
| 12 | `nexus:last-proactive-presence-at` | `number` (ms) | `saveLastProactivePresenceAt()` | `loadLastProactivePresenceAt()` | `0` | - |
| 13 | `nexus:presence-history` | `PresenceHistoryItem[]` | `savePresenceHistory()` | `loadPresenceHistory()` | `[]` | 6 条 |
| 14 | `nexus:pet-window-preferences` | `PetWindowPreferences` | `savePetWindowPreferences()` | `loadPetWindowPreferences()` | `{isPinned:true, clickThrough:false}` | - |
| 15 | `nexus:runtime` | `PetRuntimeState` | `savePetRuntimeState()` | `loadPetRuntimeState()` | `{mood:'idle'}` | - |
| 16 | `nexus:autonomy:dream-log` | `MemoryDreamLog` | `useMemoryDream` | `useMemoryDream` | `createInitialDreamLog()` | history 10 条 |
| 17 | `nexus:autonomy:context-triggers` | `ContextTriggeredTask[]` | `useContextScheduler` | `useContextScheduler` | `[]` | - |
| 18 | `nexus:autonomy:notification-messages` | `NotificationMessage[]` | `useNotificationBridge` | `useNotificationBridge` | `[]` | 50 条 |
| 19 | `nexus:analytics:consent` | `'granted'\|null` | `setAnalyticsConsent()` | `getAnalyticsConsent()` | 未存储 | - |
| 20 | `nexus:analytics:events` | `AnalyticsEvent[]` | `localSink()` | `readStoredEvents()` | `[]` | 50 条 |

**未使用的 key (可清理):**
- `nexus:autonomy:state` — 已定义但从未读写
- `nexus:autonomy:notification-channels` — 已定义但从未读写

### 1.2 Electron 加密 Vault (`{userData}/vault.json`)

| Slot 模式 | 用途 | 加密方式 |
|-----------|------|---------|
| `settings:apiKey` | LLM 主 API key | safeStorage (Windows DPAPI / macOS Keychain) |
| `settings:speechInputApiKey` | STT API key | 同上 |
| `settings:speechOutputApiKey` | TTS API key | 同上 |
| `settings:voiceCloneApiKey` | 声音克隆 API key | 同上 |
| `settings:toolWebSearchApiKey` | 搜索 API key | 同上 |
| `profile:{category}:{providerId}:apiKey` | Provider 配置的 key | 同上 |

### 1.3 Electron 文件系统

| 文件路径 | 数据类型 | 用途 | 上限 |
|---------|---------|------|------|
| `{userData}/memory-vectors.json` | `{version, entries[]}` | 记忆向量索引 | 2000 条, 2s debounce |
| `{userData}/plugins/*.json` | Plugin manifests | 插件配置 | - |

### 1.4 系统级

| 位置 | 用途 |
|------|------|
| Windows Registry (LoginItems) | 开机自启 |

---

## 2. 运行时状态 (Runtime / Ephemeral State)

仅存在于内存，重启即丢失。

### 2.1 Electron 主进程 (`windowManager.js`)

| 状态 | 类型 | 权威源 | 同步方向 | 同步通道 |
|------|------|--------|---------|---------|
| `runtimeState` | 20+ 字段的对象 | **主进程** (唯一写入) | 主→渲染 (广播) | `runtime-state:changed` |
| `petWindowState` | `{isPinned, clickThrough, petHotspotActive}` | **主进程** | 双向 | `pet-window:state-changed` / `pet-window:update-state` |
| `panelWindowState` | `{collapsed}` | **主进程** | 双向 | `panel-window:state-changed` / `panel-window:set-state` |
| `runtimeClientHeartbeat` | `{pet: number, panel: number}` | **主进程** | 渲染→主 (10s 心跳) | `runtime-state:heartbeat` |
| `mainWindow` / `panelWindow` | BrowserWindow refs | **主进程** | - | - |
| `panelSection` | `string` | **主进程** | 主→Panel | `panel-section:changed` |

### 2.2 React 渲染进程 — 按 Hook 归属

#### useAppController (顶层协调器)

| 状态名 | 种类 | 持久化? | 消费者 | 备注 |
|--------|------|---------|--------|------|
| `settings` | useState | YES → localStorage | 全局 | 通过 `settingsRef` 分发 |
| `settingsOpen` | useState | NO (IPC 同步) | overlays, bridge | 双向同步到主进程 `panelSettingsOpen` |
| `panelWindowState` | useState | NO | panel view | 从主进程接收 |
| `isPinned` | useState | YES → pet-window-prefs | pet view | 双向同步 |
| `clickThrough` | useState | YES → pet-window-prefs | pet view | 双向同步 |

#### useChat

| 状态名 | 种类 | 持久化? | 备注 |
|--------|------|---------|------|
| `messages` | useState | YES → `nexus:chat` | |
| `input` | useState | NO | |
| `busy` | useState | NO | 通过 `busyRef` 分发 |
| `error` | useState | NO | 8s 自动清除 |
| `petDialogBubble` | useState | NO | |
| `assistantActivity` | useState | NO | 同步到主进程 runtimeState |

#### useVoice

| 状态名 | 种类 | 持久化? | 备注 |
|--------|------|---------|------|
| `voiceState` | useState | NO | idle/listening/processing/speaking |
| `continuousVoiceActive` | useState | NO | 同步到主进程 runtimeState |
| `liveTranscript` | useState | NO | 实时 ASR 文本 |
| `speechLevel` | useState | NO | 音频电平 0-100 |
| `wakewordState` | useState | NO | 唤醒词检测器状态 |
| `voicePipeline` | useState | YES → `nexus:voice-pipeline` | |
| `voiceTrace` | useState | YES → `nexus:voice-trace` | |

#### usePetBehavior

| 状态名 | 种类 | 持久化? | 备注 |
|--------|------|---------|------|
| `mood` | useState | YES → `nexus:runtime` | |
| `gazeTarget` | useState | NO | 眼球跟踪 |
| `petPerformanceCue` | useState | NO | 当前动画 |
| `petStatusText` | useState | NO | |
| `ambientPresence` | useState | YES → `nexus:ambient-presence` | 含过期机制 |
| `mascotHovered` | useState | NO | |
| `petTapActive` | useState | NO | |
| `petTouchZone` | useState | NO | |
| `petHotspotActive` | useState | NO | 同步到主进程 petWindowState |

#### useMemory

| 状态名 | 种类 | 持久化? | 备注 |
|--------|------|---------|------|
| `memories` | useState | YES → `nexus:memory:long-term` | |
| `dailyMemories` | useState | YES → `nexus:memory:daily` | |

#### useFocusAwareness (Kairos)

| 状态名 | 种类 | 持久化? | 备注 |
|--------|------|---------|------|
| `focusState` | useState | NO | active/idle/away/locked |
| `idleSeconds` | useState | NO | 系统空闲秒数 |

#### useAutonomyTick (Kairos)

| 状态名 | 种类 | 持久化? | 备注 |
|--------|------|---------|------|
| `autonomyState` | useState | NO | phase + counters, 重启归零 |

#### useMemoryDream (Kairos)

| 状态名 | 种类 | 持久化? | 备注 |
|--------|------|---------|------|
| `dreamLog` | useState | YES → `nexus:autonomy:dream-log` | |
| `dreamRunningRef` | useRef | NO | 锁标志 |

#### useContextScheduler (Kairos)

| 状态名 | 种类 | 持久化? | 备注 |
|--------|------|---------|------|
| `tasks` | useState | YES → `nexus:autonomy:context-triggers` | |

#### useNotificationBridge (Kairos)

| 状态名 | 种类 | 持久化? | 备注 |
|--------|------|---------|------|
| `messages` | useState | YES → `nexus:autonomy:notification-messages` | |

#### useReminderTaskStore

| 状态名 | 种类 | 持久化? | 备注 |
|--------|------|---------|------|
| `reminderTasks` | useState | YES → `nexus:reminder-tasks` | |

#### useDebugConsole

| 状态名 | 种类 | 持久化? | 备注 |
|--------|------|---------|------|
| `debugConsoleEvents` | useState | YES → `nexus:debug-console-events` | 最多 60 条 |

#### useMediaSessionController

| 状态名 | 种类 | 持久化? | 备注 |
|--------|------|---------|------|
| `mediaSession` | useState | NO | 当前媒体播放 |
| `musicActionBusy` | useState | NO | |
| `dismissedMusicSessionKey` | useState | NO | |
| `pollingActive` | useState | NO | |

---

## 3. 同步路径分析

### 3.1 双向同步的状态 (需重点关注)

| 状态 | 路径 1 (主→渲染) | 路径 2 (渲染→主) | 路径 3 (持久化) | 风险等级 |
|------|-----------------|-----------------|----------------|---------|
| `runtimeState` | IPC 广播 `runtime-state:changed` | IPC 请求 `runtime-state:update` | 无 | **低** — React 值比较防回环 |
| `petWindowState` | IPC 广播 `pet-window:state-changed` | IPC 请求 `pet-window:update-state` | localStorage `nexus:pet-window-preferences` | **低** — 主进程归一 |
| `panelWindowState` | IPC 广播 `panel-window:state-changed` | IPC 请求 `panel-window:set-state` | 无 | **低** — 线性, 非回环 |
| `settings` | `SETTINGS_UPDATED_EVENT` 自定义事件 | `saveSettings()` → localStorage | localStorage `nexus:settings` | **低** — storage event 仅跨窗口 |

### 3.2 冗余同步链路 (潜在简化)

| 状态 | 当前路径数 | 说明 |
|------|-----------|------|
| `isPinned` / `clickThrough` | **3 条** | ① React useState ② IPC petWindowState ③ localStorage pet-window-prefs |
| `settingsOpen` | **2 条** | ① React useState ② IPC runtimeState.panelSettingsOpen |
| `mood` | **2 条** | ① React useState (usePetBehavior) ② localStorage `nexus:runtime` + IPC runtimeState.mood |
| `continuousVoiceActive` | **2 条** | ① React useState (useVoice) ② IPC runtimeState.continuousVoiceActive |

### 3.3 权威源确认

| 状态 | 唯一权威源 | 其他来源角色 |
|------|-----------|-------------|
| settings | `settingsStore` (localStorage) | 渲染进程读, vault 存 key |
| runtimeState (跨窗口) | `windowManager.js` (主进程内存) | 渲染进程读 + 请求写 |
| petWindowState | `windowManager.js` (主进程) | localStorage 仅持久化备份 |
| panelWindowState | `windowManager.js` (主进程) | 渲染进程仅消费 |
| chat messages | `useChat` (渲染进程 useState) | localStorage 持久化 |
| memories | `useMemory` (渲染进程 useState) | localStorage 持久化 |
| voice state | `useVoice` (渲染进程 useState) | 汇总到 runtimeState |
| autonomy state | `useAutonomyTick` (渲染进程) | 不同步, 不持久化 |
| focus state | `useFocusAwareness` (渲染进程) | 不同步, 不持久化 |

---

## 4. 发现的问题与风险

### 4.1 已确认安全

- [x] runtimeState 双向同步: React 值比较阻止回环
- [x] settings 跨窗口: storage event 天然单向 (不触发本窗口)
- [x] petWindowState: 主进程归一, applyPetWindowState 幂等

### 4.2 可改进项

| # | 问题 | 严重度 | 建议 |
|---|------|--------|------|
| 1 | `isPinned`/`clickThrough` 走 3 条路径 (React + IPC + localStorage) | 低 | 可考虑去掉 localStorage 层, 仅用 IPC 做持久化 (主进程写文件) |
| 2 | `mood` 同时在 usePetBehavior (React) 和 runtimeState (IPC) 维护 | 低 | 已经以 React 为准, IPC 仅做通知, 可接受 |
| 3 | ~~`nexus:autonomy:state` / `nexus:autonomy:notification-channels` 未使用~~ | ~~无~~ | **已清理** (2026-04-05) |
| 4 | `runtimeStore.ts` 做了额外的 module-level 缓存 | 低 | 如果仅 `useDesktopBridge` 消费, 可简化为直接 state |
| 5 | `useVoice` 有 30+ useRef, 状态机复杂度极高 | 中 | Phase 2 Milestone 1 (单轮对话稳定) 时再处理 |

---

## 5. 统计摘要

| 分类 | 数量 |
|------|------|
| localStorage 持久 key (活跃) | 20 |
| localStorage 持久 key (未使用) | 0 (已清理) |
| Vault 加密 slot | 5 固定 + N 动态 |
| 文件系统存储 | 2 (vectors, plugins) |
| 主进程运行时状态对象 | 4 (runtimeState, petWindowState, panelWindowState, heartbeat) |
| React useState (全 hooks) | ~30 |
| React useRef (全 hooks) | ~80+ |
| IPC handlers | 107 |
| IPC subscriptions | 10 |
| 双向同步状态 | 4 (均低风险) |
| 冗余同步路径 | 4 (均可接受) |

---

## 6. Workstream 2-6 执行记录

### WS2: Runtime Authority (已确认)
- 跨窗口运行时状态: `windowManager.js` 为唯一权威源
- 渲染进程仅消费 + 请求写入, 不自作主张
- **结论: 架构已达标, 无需改动**

### WS3: 同步回环 (已确认)
- 4 个双向同步状态均无回环风险
- React 值比较 + storage event 单向特性 + 主进程归一化 已阻断回环
- **结论: 架构已达标, 无需改动**

### WS4: IPC/Preload 合同 (已审计)
- 117 个 preload 方法 / 107 个 IPC handlers / 全部有 TS 声明
- 1 个 `isPanelWindow` 用 sendSync (刻意设计, 非 bug)
- 5 对 MCP 方法重复 (`mcp-client:*` vs `mcp:*`, 两套实现功能不同)
- **结论: 干净, 仅 MCP 可考虑长期合并**

### WS5: 启动顺序 (已确认)
```
1. Electron main boot (main.js)
2. ensureRendererServer()
3. registerMediaPermissionHandlers()
4. registerIpc()
5. createMainWindow() + applyPetWindowState() + createTray()
6. React mount (main.tsx → App.tsx)
7. useAppController() 初始化所有 hooks
8. initializeSettingsWithVault() 异步水合 API keys
9. useDesktopBridge 订阅 runtimeState + heartbeat
10. 自主系统 hooks 按 enabled 标志启动
```
- 无抢写风险: vault 水合是异步的, hooks 全部 gated
- **结论: 启动顺序线性且安全, 无需改动**

### WS6: 拆 useAppController (已执行)
- 自主系统 ~180 行 → 提取为 `useAutonomyController.ts` (227 行)
- `useAppController.ts`: 701 行 → 544 行 (减少 22%)
- 返回结构完全不变, `App.tsx` 无需修改
- **结论: 已完成首轮拆分, 后续可考虑拆 reminder / voice-chat glue**
