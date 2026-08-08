# Nexus v0.4.5 — 记忆可信度与维护

**状态：正式未签名稳定版。** v0.4.5 是当前稳定版本，本文档是它的正式发行记录。
发布与平台产物只从发布提交经受保护的 tag 工作流创建；在该工作流成功之前，本文档
不声称任何 GitHub 资产已经存在。

v0.4.5 走标准 beta 流程发布，没有任何维护者豁免：`v0.4.5-beta.1` 于 2026-08-03
在通过完整自动门禁（prerelease-check 30/30、verify:release、三平台 CI 全绿）后
作为 GitHub 预发布版发布，beta 验证窗口从 2026-08-03 运行到 2026-08-06，随后
晋升为稳定版。不会虚构跨平台实体设备验证证据；验证手段是自动门禁加打包 smoke
检查。

v0.4.5 建立在 v0.4.4 维护与硬化稳定版之上。它带来一组用户可见的记忆可信度改动，
把伙伴 presence 接到真实请求信号上，并承载了 v0.4.4 以来在 `main` 上累积的
可靠性、安全与清理工作。

## 变化

### 记忆可信度（用户可见）

- **矛盾检测**——dream 管线现在会在衰减与聚类之间对矛盾候选进行排序、判定并执行。
  被取代的记忆按两档自动降权（likely ×0.3，possible ×0.6），在关键词召回与向量
  召回中同时生效，没有确认 UI。每条被降权的记忆会在记忆项上记录
  `supersededBy` / `supersededAt` / `supersededPending`，记忆设置页可以据此说明
  条目淡出的原因。
- **本地数据迁移默认开启**——记忆本地数据迁移开关现在默认为开。环境变量紧急
  开关与回滚路径保留，迁移在移动任何数据前仍需用户明确授权。

### 伙伴 presence

- presence 阶段（`thinking` / `waiting` / `offline` / `error`）现在由主进程根据
  真实聊天请求生命周期推导，不再依赖渲染进程侧的启发式判断。`waiting` 只在所有
  在途请求都停在有界重试退避中时上报，并随请求落定必然清除，阶段不会卡住；
  重试原因是稳定的诊断码，绝不含 URL。

### beta 窗口期间的发布路径修复

- Linux deb 验证改为与 electron-builder 产出的 Debian 规范化预发布版本号
  （`0.4.5~beta.1`）比较，而不是原始 semver（`scripts/verify-linux-release.mjs`）。
- tag 被强制移动到修复提交后遗留的过期 draft release 现在会被删除并重建，
  发布 tag 绑定检查得以通过。

### 工具链与代码风格

- **eslint-plugin-react-hooks 7.1.1**——启用 React Compiler 时代的新规则
  （`react-hooks/refs`、`set-state-in-effect`、组件创建）并清零全部 58 处违规，
  修法保持行为不变：惰性 ref 初始化改为 `useState` 惰性初始化，render 期 ref 写入
  移到 commit 后的 effect，effect 内同步 setState 改为带前值快照的 render 期
  adjust。v0.2.7 建立的防渲染风暴不变量（hook 返回 bag 的 useMemo 稳定化、
  无 store→render setState 循环）原样保留。
- **import 路径后缀统一**——所有文件级相对 import 现在都带显式 `.ts` / `.tsx`
  后缀（221 个文件共 826 处），与新代码已有的 `allowImportingTsExtensions` 配置
  一致；目录（barrel）导入保持无后缀。按字符串精确匹配 import 的审计脚本及其
  测试 fixture 同步更新为规范形式。

### 安全

- **高风险 IPC schema 改为拒绝未知字段**——IPC payload schema 第三段 rollout，
  把 plugin、plugin-bus、telegram/discord 发送、游戏指令、文本文件、VTS legacy
  token、MCP 调用/同步、外部动作策略、open-external 工具策略、桌面上下文策略、
  pet-model creator kit 等通道从静默剥离未声明字段收紧为直接拒绝。
  `mcp:sync-servers` 调用侧在发送前把持久化的 server 条目按 schema 白名单清洗，
  另有守卫测试防止高风险 schema 回退到 strip。
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

### 内部清理与契约单源化

- **镜像契约单源化（约 2600 行）**——localData 存储键、runtime-state 字段名与
  电源事件种类现在收敛到共享元组，原先手写的镜像（主进程 payload schema、渲染进程
  存储分组、vite-env 类型、存储契约、web-search/sprite id 联合类型）全部改为从
  共享元组派生，主进程键集不会再静默漂移。五处 `RuntimeStateSnapshot` 声明收敛为
  一份共享 schema（26 个字段：20 个可 patch + 6 个主进程专有）。翻译键改为通过
  `keyof typeof` 从 zh-CN 消息目录派生，不再使用生成的清单。
- **规范成文**——仓库根目录新增 `AGENTS.md`，记录编号代码规范
  （ARCH/SRC/FILE/IMP/DOC/ERR/STORE/I18N/TEST/CSS/GIT/AGT），本次及后续工作
  都必须遵守。
- **删除旧设置面板**——被取代的 `src/components/settingsSections` 整棵树
  （36 个文件、约 1.2 万行）移除；仍被引用的 3 个组件（关于面板、发布 spotlight
  操作、URL 输入）迁入 `settingsV3`；error-redaction、message-privacy、
  forms/settings-surface 审计基线改为跟踪 V3 实现。
- **删除 TTS pipeline**——被默认关闭的 flag 门控的 pipecat 式管线
  （`tts-pipeline/`）因卡住 `waitForCompletion` 且无声音而移除；
  legacy 流式控制器成为唯一 TTS 路径。
- **死代码清理**——删除 `src` 与 electron 服务中约 270 个未使用导出、
  `choiceRadioNav` 组件、errand/arc/reminder 未用辅助函数及工具调用循环中的
  `usedPromptMode` 占位；删除低价值的过程/结构测试与重复审计运行；knip ignore
  相应缩减。
- **打包运行时基线**——`scripts/packaged-runtime-baseline.mjs` 在本地记录
  持续运行参考值并在回归时告警（仅警告、仅本地机器、不阻塞）。

## 未签名分发约定

官方 GitHub Releases 是唯一受支持的二进制来源。v0.4.5 面向 macOS arm64、
Windows x64 与 Linux x64；不声称提供 macOS x64 或 universal 产物。签名与公证
姿态与 v0.4.4 一致。

### macOS 未签名自动更新限制

macOS arm64 应用是 ad-hoc 签名，不是 Apple Developer ID 签名，也未公证。ad-hoc
签名无法建立 Apple 信任，Gatekeeper 可能要求右键 → 打开，或显式移除隔离属性
（`xattr -dr com.apple.quarantine /Applications/Nexus.app`）。应用只检查新版本
并打开官方发布页；用户需手动下载并替换应用。

### Windows 未签名安装包限制

Windows x64 NSIS 安装包为 `NotSigned`。SmartScreen 可能显示未知发布者警告，
安装包无法提供已验证的发布者身份或信誉积累。用户应在确认产物来自官方 GitHub
Release 后再继续。

每个平台构建都会在同一个 GitHub Release 中发布自己的校验和清单：
`SHA256SUMS-windows.txt`、`SHA256SUMS-macos.txt`、`SHA256SUMS-linux.txt`。
下载单一包格式的 Linux 用户可以运行
`sha256sum --ignore-missing -c SHA256SUMS-linux.txt` 进行校验。

## 隐私边界

与 v0.4.4 一致。桌面伙伴感知仍然只产出短期存活、粗粒度、经过脱敏的摘要；暂停即
停止采集与模型可达；原始窗口标题、截图、剪贴板内容、消息正文、文件路径、精确
计时与桌面活动时间线都在模型边界之外。记忆矛盾检测完全在本地 dream 管线内运行，
任何记忆内容都不会离开设备。

## 不包含

- 不新增感知来源、check-in 行为、设置页重设计、反馈分析、自适应文案、外部通知、
  消息发送、工具执行、效率评分、桌宠移动或桌面窗口控制。
- 不改变 check-in 策略、隐私边界或设置页契约。
- 不包含 v0.5 桌宠鼠标跟随、打字反应或窗口控制。
