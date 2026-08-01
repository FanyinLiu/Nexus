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

- **eslint-plugin-react-hooks 7.1.1**——启用 React Compiler 时代的新规则
  （`react-hooks/refs`、`set-state-in-effect`、组件创建）并清零全部 58 处违规，
  修法保持行为不变：惰性 ref 初始化改为 `useState` 惰性初始化，render 期 ref 写入移到
  commit 后的 effect，effect 内同步 setState 改为带前值快照的 render 期 adjust。
  v0.2.7 建立的防渲染风暴不变量（hook 返回 bag 的 useMemo 稳定化、无 store→render
  setState 循环）原样保留。
- **高风险 IPC schema 改为拒绝未知字段**——IPC payload schema 第三段 rollout，
  把 plugin、plugin-bus、telegram/discord 发送、游戏指令、文本文件、VTS legacy token、
  MCP 调用/同步、外部动作策略、open-external 工具策略、桌面上下文策略、pet-model
  creator kit 等通道从静默剥离未声明字段收紧为直接拒绝。`mcp:sync-servers` 调用侧
  在发送前把持久化的 server 条目按 schema 白名单清洗，另有守卫测试防止高风险 schema
  回退到 strip。

## 不包含

- 暂不发布正式 v0.4.5。
- 不改 package 版本号。
- 不打 tag，不创建 GitHub Release。
- 不切换 README 稳定版入口。
- 不新增感知来源、check-in 行为、设置页重设计、反馈分析、自适应文案、外部通知、消息发送、
  工具执行、效率评分、桌宠移动或桌面窗口控制。
