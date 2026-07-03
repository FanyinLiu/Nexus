# Nexus v0.4.1 — 陪伴 UI、设置和可靠性加固

v0.4.1 是 v0.4 桌面陪伴感知地基之后的第一个稳定跟进版本。它不会把
Nexus 变成默认替你工作的智能体，也不会提前进入 v0.5 的桌宠窗口控制路线。
这个版本重点是把主对话界面、设置、发布检查和隐私边界整理到更适合公开测试的状态。

## 重点变化

- **陪伴 UI 源码拆分**：面板、输入区、消息、圆环、收起态、节奏、动效和视觉锁定样式被拆成更聚焦的源码文件，后续继续打磨界面时不需要把所有东西堆回一个大 CSS 文件。
- **设置界面加固**：设置页新增更清晰的源码结构、source-only 表面审计和设置选项架构说明，让设置能继续贴近对话界面，而不是把太多行为藏在一个大组件里。
- **设置抽屉性能守卫**：设置入口继续懒加载。设置样式作为独立 CSS chunk 加载，懒加载 JS 入口保持很小，避免重新把 raw CSS 字符串塞进 JavaScript 或把设置样式推回启动路径。
- **Image4 伙伴场域守卫**：Image4 面板状态、信号渲染、活动标签、输入区状态、视觉节奏和颜色边界都有源码级契约和测试。
- **自定义伙伴名唤醒词同步**：伙伴名字变化有了独立的唤醒词同步层，后续语音唤醒可以跟随用户改名，同时不让 feature 模块反向依赖 app 层。
- **运行时隐私与脱敏加固**：桌面上下文、消息隐私、vault、支持日志、运行时日志清洗、记忆向量支持缓冲和网络错误脱敏都有更严格的 source-only 审计。
- **GitHub 上传说明**：`docs/GITHUB_UPLOAD_PREP.md` 记录了这次大型 PR 的定位、review 顺序、性能基线和验证命令。

## 具体内容

### UI 和设置

- 把陪伴面板 CSS 拆成 `src/app/styles/panel-companion*.css` 下的多个聚焦模块。
- 新增 Image4 伙伴场域、节奏网格、信号、活动标签、聊天预览、伙伴状态和输入区状态模块。
- 新增设置、聊天、输入区、表单、焦点管理、流式输出和 agent-activity 表面的参考文档与源码审计。
- `docs/ui-qa/` 继续作为本地截图和指标目录，不上传到仓库；仓库只提交源码可追踪的 review 文档。

### 性能

- `src/app/settingsDrawerEntry.ts` 不再把设置样式作为 raw CSS 字符串打进 JS，而是作为正常懒加载 CSS 资源导入。
- `scripts/performance-baseline.mjs` 新增独立预算：
  - 总 CSS
  - 最大 CSS chunk
  - 首屏 CSS chunk
  - Settings drawer lazy CSS
  - Settings drawer lazy JS entry
- 如果 Settings lazy CSS 或 lazy JS entry 消失，性能基线会失败，因为这通常表示设置样式又被合回启动路径。
- `docs/PACKAGE_STARTUP_OPTIMIZATION.md` 更新了当前基线：Settings drawer lazy CSS 约 554 KB，Settings drawer lazy JS entry 约 0.1 KB。

### 桌面陪伴感知和语音边界

- 桌面陪伴感知继续保持短期、粗粒度、隐私有界的摘要。
- v0.4 的规则继续保留：时间表达应该像陪伴者的粗略感知，而不是秒表。
- 补充或加固了粗粒度时间文案、多语言精确时间泄漏检测、check-in policy、summary 存储和透明视图模型测试。
- 新增自定义伙伴名的唤醒词同步层。

### 隐私、安全和发布检查

- 新增运行时日志清洗和记忆向量支持日志缓冲，并用测试覆盖脱敏边界。
- 把 error-redaction 审计的短语和规则拆成更聚焦的源码文件。
- 扩展消息隐私、桌面上下文隐私、vault 安全和网络错误脱敏审计。
- 新增或扩展 release、storage、IPC、architecture、boundary 等 source-only 审计 fixture 测试。
- `verify:pr` 会一起跑新的 UI、隐私、性能和发布守卫。

## 仍然不做

v0.4.1 不包含：

- 外部主动通知
- 发送消息
- 未经明确用户动作的工具执行
- 生产力评分
- 原始桌面活动时间线
- 新桌面感知来源
- 桌宠跟随鼠标、跟随打字或控制桌面窗口
- 除 `v0.4.1` tag 和 GitHub Release 之外的新发布流程

这些继续留给后续 v0.4.x 或 v0.5。

## 分发说明

在 Nexus 拥有签名安装包和 macOS notarization 之前，手动安装仍可能看到平台信任提示：

- macOS 可能显示 Gatekeeper 或 quarantine 警告。如果你确认应用来自官方 GitHub Release，只对这次下载的 app bundle 移除 quarantine。
- Windows 可能显示 SmartScreen 警告，因为安装包还没有足够的代码签名信誉。

不要从镜像站或二次转载压缩包下载安装。

## 验证

这次从上传准备转为 v0.4.1 候选前，本地已通过：

```bash
git diff --check
npm run source-size:audit
npm run performance:baseline
npm run distribution:audit
npm run verify:pr
npm audit --omit=dev
```

正式发布 GitHub Release 前，在最终 push 的提交上再跑：

```bash
npm run verify:release
npm run prerelease-check -- v0.4.1
npm run package:dir:smoke
```
