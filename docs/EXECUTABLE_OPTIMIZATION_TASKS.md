# Nexus 可执行优化任务清单（v0.3.2+）

这份清单把「升级整合计划」拆成可直接交付的任务。目标是先完成主循环闭环，再逐步叠加能力，不把高级能力直接推到第一屏。

执行窗口建议按 2 周一个 Sprint 跑，优先级按 `P0 -> P1 -> P2 -> P3`。

> **对账（2026-06-12）**：勾选状态已与实际代码核对。Sprint 1.5 主体已随 v0.3.3 线发货；
> 通讯桥（v0.3.4-beta.1 线）超出本清单原始范围交付了双向消息/语音/配对码，相关条目已标注。

## Sprint 1（P0）：主路径 + 消息抓取闭环

### 目标
- 把桌面上下文和消息监听统一到一个可感知入口。

### 任务
- [x] ~~在通知入口增加「消息摘要」快速通道~~ **被通讯桥超越**（v0.3.4-beta.1）：Telegram/Discord 消息直接进伴侣对话并自动回信，语音消息转写；webhook 通知保留播报+收件箱通道。
- [x] 在设置页新增「窗口上下文」诊断卡，显示前台窗口、剪贴板更新、截图抓取是否可用。✅
  Settings -> Memory now routes the desktop context status grid through a
  pure diagnostics view model, preserving the no-new-sensing privacy boundary
  while making foreground-window, clipboard, and screenshot/OCR availability
  testable.
- [x] 在 `Pet` 侧状态显示新增 `broadcasting / summarizing / needs_attention` 的动作映射。✅
  Pet runtime phases now stay stable while a separate display-action mapping
  lets the pet surface summarizing and needs-attention states; broadcasting is
  registered as a UI-only action until a real runtime broadcast signal exists.
- [x] 在首次安装后的新手路径里加入「收到消息后的处理动作」演示（至少 1 条）。✅
  Onboarding now ends with a static message-action demo that explains source
  notice, a desktop hint, and user-chosen actions without binding to real
  notification schemas, message bodies, IDs, precise timestamps, or chat sends.

### 完成验收
- 模拟 1 条外部消息在 5 秒内生成桌面摘要。
- 未读摘要命中率（60 秒内出现）> 90%。
- 有 1 条以上路径日志记录：消息入库时间、摘要时间、展示时间。

---

## Sprint 1.5（P0）：竞品对齐的启动体验修补

### 目标
- 把“能否第一次把模型跑通”和“是否能立刻知道错在哪”这两件事先修到可用。

### 任务
- [x] 把通知小窗与侧栏的未读文案补齐为 5 个语言版本并通过 i18n 审核。
- [x] 在模型接入里增加“国内 / 国外”模式预设 ✅（onboarding 国内/海外/本地分段控件 PR #14 + `switchTextProvider` 自动填充；设置页 ModelSection 区域 UI 已接入并共享区域 tab 契约，见 Sprint 2）
- [x] 加入“模型 Key 合法性”联动校验 ✅（`isHttpHeaderSafeCredential` 三层强制 + 5 语文案 + 测试）
- [x] 在模型列表页补齐“按厂商最小成功模板” ✅（`FIRST_SUCCESS_PROVIDER_IDS` 置顶排序，PR #12）
- [x] 统一连接失败到用户可执行建议 ✅（`humanizeError('chat')` 四个用户面 + 后端真实串契约测试，PR #11）

### 完成验收
- 首次配置成功率（新用户）≥ 85%。
- 首次失败平均重试 ≤ 2 次。
- 首次失败后 30 秒内可执行一次可恢复操作并回到可发消息状态。

---

## Sprint 2（P1）：配置摩擦降到最低

### 目标
- 把模型配置从“参数表单”变成“向导”。

### 任务
- [x] 增加「区域模板」选择（国内 / 国外 / 本地）——onboarding 与设置页 ModelSection 共用区域 tab 契约，设置页品牌网格支持跨区 brand 路由并保留当前选择可见。
- [x] `ModelSetup` 增加“连通性+鉴权”一键校验（模型可达、key 语法、模型名存在）——首次模型设置面板复用文本连接预检并接入真实连接测试入口。
- [x] 输出统一错误码映射（含中文 key、空格/换行导致 header 失效、模型不存在、限流等）——模型预检、连接测试、模型列表刷新现在都输出稳定 `code`，UI 文案继续走现有本地化建议。
- [x] 把 MiniMax Token Plan / DeepSeek / OpenAI / Gemini / Claude 的最小配置模板接入向导默认值 ✅（随 Sprint 1.5 first-success 落地）

### 完成验收
- 首次配置成功率 ≥ 85%。
- 首次失败平均重试 ≤ 2 次。
- 30 分钟内可完成一次端到端会话（输入 -> 发送 -> 回复 -> 显示）。

---

## Sprint 3（P2）：可追溯可控

### 目标
- 让“自动任务 / 通知动作”具备可追踪、可撤销的最小权限回路。

### 任务
- [x] 宠物面板状态图增加 `waiting_confirmation / executing / done / failed`——PetView 继续保留底层 phase，新增任务层 display-action 与 5 语文案，后续自动任务可直接复用这些稳定状态。
- [x] 通知卡片提供 `稍后处理 / 标记重要 / 一键起草回复`——通知摘要卡现在通过稳定动作模型渲染三项主操作：稍后处理、标记/取消重要、一键起草回复；起草仍只写入本地输入框，不自动发送第三方消息。
- [x] 权限弹窗统一分为「本次一次 / 本次会话 / 长期允许」——外部高风险动作的主进程确认弹窗现在支持本次放行、本次应用会话放行、长期允许三档；会话放行只保存在内存中，长期允许才会把对应集成提升为自动模式。
- [x] 所有高风险动作落审计日志（类型、输入、结果、耗时、失败码）——Telegram、Discord、MCP 与游戏命令等高风险外部动作现在共用生命周期审计包装，记录开始/结束、动作类型、元数据化输入/结果、耗时与稳定失败码，同时继续排除消息正文、目标 ID、命令文本、工具参数和错误正文。

### 完成验收
- 每个自动动作可在日志中查到开始与结束。
- 关键动作误触率下降（新用户误触率 < 5%，一周内回访核对）。

---

## Sprint 4（P3）：发布与分发可信度提升

### 目标
- 让安装和升级更稳，文档与实现保持对齐。

### 任务
- [x] 统一未签名安装提示文档（macOS/Windows 各一版）并放进主 README + 语言 README——根 README 和 4 个语言 README 现在都明确写出 GitHub Releases 下载来源、不要从镜像安装、macOS Gatekeeper 右键打开或 `xattr` 处理、Windows SmartScreen “详细信息/仍要运行”路径，并由分发审计防止后续文档漂移。
- [x] 打包体积与启动路径优化清单：先行清点可延迟下载模型/重资源——新增 [PACKAGE_STARTUP_OPTIMIZATION](PACKAGE_STARTUP_OPTIMIZATION.md)，记录当前 `performance:baseline` 体积基线、ONNX/Live2D/Transformers/Tesseract/Sherpa 模型等重资源、默认启动懒加载边界、可选模型不进安装包的约束，以及后续把必需语音模型迁到首次运行下载前必须验证的降级路径。
- [ ] 建立每月一次的「文档一致性检查」流程（ROADMAP / 升级计划 / FEATURES / README）。

### 完成验收
- 发现不一致项 0 项或在 24 小时内完成修复。
- 安装失败路径可复现一次并给出修复动作文档。

---

## 风险与回滚

- 任一阶段若触发稳定性回归（崩溃率或卡死率高于历史基线），暂停并回滚到上一稳定状态。
- 未通过验收指标的任务，必须在下一 Sprint 前补齐后再进入下一阶段。
