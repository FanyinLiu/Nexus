# Nexus v0.4.5 — 发布硬化草稿

状态：草稿。Klein 明确要求最终发布检查、tag 和 GitHub Release 之前，不要发布。

本草稿不发布新的运行时功能。它把当前公开稳定版 v0.4.4 与 v0.4.5
草稿收拢成后续发布前的硬化评审层，用来证明 0.4 系列在未来任何发布决定前仍然保持一致。

## 变化

- 增加 v0.4 草稿栈审计，只从源码和文档文件检查 release-state 不变量，并分成 PR quick
  guard 和完整发布评审模式。
- 增加 v0.4.5 草稿硬化 handoff，记录堆叠 PR 依赖、回滚说明、隐私断言和验证命令。
- 公开稳定入口继续停留在 v0.4.4，同时把 v0.4.5 明确标为唯一的草稿评审层。
- 增加草稿栈边界测试，避免未来文档修改时意外把 v0.4.5 推成正式发布。
- 记录 `verify:release`、打包 smoke 和完整 v0.4 草稿栈审计的本地硬化证据，同时不生成发布产物。
- 明确 v0.5 才是后续桌宠行为线，而不是用来绕过 v0.4 release-state 问题的补丁。

## v0.4.4 之后累积的内容

以下维护工作已在 v0.4.4 稳定版发布后合入 `main`，归属于本草稿层。它们都不改变用户可见行为。

### 工具链与代码风格

- **eslint-plugin-react-hooks 7.1.1**——启用 React Compiler 时代的新规则
  （`react-hooks/refs`、`set-state-in-effect`、组件创建）并清零全部 58 处违规，
  修法保持行为不变：惰性 ref 初始化改为 `useState` 惰性初始化，render 期 ref 写入移到
  commit 后的 effect，effect 内同步 setState 改为带前值快照的 render 期 adjust。
  v0.2.7 建立的防渲染风暴不变量（hook 返回 bag 的 useMemo 稳定化、无 store→render
  setState 循环）原样保留。
- **import 路径后缀统一**——所有文件级相对 import 现在都带显式 `.ts` / `.tsx`
  后缀（221 个文件共 826 处），与新代码已有的 `allowImportingTsExtensions` 配置一致；
  目录（barrel）导入保持无后缀。按字符串精确匹配 import 的审计脚本及其测试
  fixture 同步更新为规范形式。

### 安全

- **高风险 IPC schema 改为拒绝未知字段**——IPC payload schema 第三段 rollout，
  把 plugin、plugin-bus、telegram/discord 发送、游戏指令、文本文件、VTS legacy token、
  MCP 调用/同步、外部动作策略、open-external 工具策略、桌面上下文策略、pet-model
  creator kit 等通道从静默剥离未声明字段收紧为直接拒绝。`mcp:sync-servers` 调用侧
  在发送前把持久化的 server 条目按 schema 白名单清洗，另有守卫测试防止高风险 schema
  回退到 strip。
- **Vault IPC 通道纳入 schema 体系**——全部六个 `vault:*` 通道接入 schema
  （拒绝未知字段姿态）；损坏的 `vault.json` 不再被原地覆盖，改为直接暴露失败。
- **聊天补全路径 SSRF 加固**——修复聊天补全流程中的服务端请求伪造绕过
  （代理式 URL 处理在外发请求前校验目标）。

### 可靠性修复

- **Errand 恢复**——进程退出时中断的后台任务在下次启动时重新排队，
  不再卡在 `running` 状态。
- **语音 / VAD**——VAD 帧订阅在唤醒词监听器重建后仍然存活（共享麦克风路径不再
  因监听器报错而饿死）；已取代的录音器迟到的 `onstop` 被忽略；清理了唤醒词运行时
  不可达的 cooldown 状态。
- **聊天 turn 守卫**——90 秒硬超时在中断前先失效 turn id（迟到的延续走静默
  stale-turn 路径）；工具调用循环把前几轮的工具交换带进后续 continuation payload。
- **存储**——删除全部聊天会话或记忆后不再从 legacy 扁平存储键复活数据；记忆衰减
  锚点在每次 dream 周期推进，避免衰减被重复计算；记忆迁移包与 dry-run 报告仅在
  当前键真正缺失时才回退 legacy；隐藏预览面板新增记忆迁移备份导出。
- **IPC 启动**——加载失败的 deferred IPC 模块改为记录日志并重试，不再静默失败。

### 内部清理

- **删除旧设置面板**——被取代的 `src/components/settingsSections` 整棵树
  （36 个文件、约 1.2 万行）移除；仍被引用的 3 个组件（关于面板、发布 spotlight
  操作、URL 输入）迁入 `settingsV3`；error-redaction、message-privacy、
  forms/settings-surface 审计基线改为跟踪 V3 实现。
- **删除 TTS pipeline**——被默认关闭的 flag 门控的 pipecat 式管线
  （`tts-pipeline/`）因卡住 `waitForCompletion` 且无声音而移除；
  legacy 流式控制器成为唯一 TTS 路径。
- **死代码清理**——删除 `src` 与 electron 服务中约 270 个未使用导出、
  `choiceRadioNav` 组件、errand/arc/reminder 未用辅助函数及工具调用循环中的
  `usedPromptMode` 占位；knip ignore 相应缩减。
- **打包运行时基线**——`scripts/packaged-runtime-baseline.mjs` 在本地记录
  持续运行参考值并在回归时告警（仅警告、仅本地机器、不阻塞）。

### 文档

- 反馈与文案调优切片经评估后放弃（2026-08-01 决定）；社区反馈保持定性。
- v0.4.5 草稿层重新界定为本文所述的累积维护。

## 不包含

- 暂不发布正式 v0.4.5。
- 不改 package 版本号。
- 不打 tag，不创建 GitHub Release。
- 不切换 README 稳定版入口。
- 不新增感知来源、check-in 行为、设置页重设计、反馈分析、自适应文案、外部通知、消息发送、
  工具执行、效率评分、桌宠移动或桌面窗口控制。
