# Nexus v0.4.4 — 维护与加固

**状态：正式未签名稳定版。** v0.4.4 是当前稳定版本，本文件是它的正式发行记录。
发布入口和各平台资产只会从发布提交经受保护的 tag 工作流生成；在该工作流成功前，
本文件不会声称 GitHub 资产已经存在。

仅针对本次发布，维护者在审阅完整自动化发布门禁后，明确豁免了通常要求的多日 beta
时长：v0.4.4 是维护与加固切片，没有用户可见的行为变化，多日对话验证窗口对它没有
意义。最终二进制仍必须由受保护工作流重新构建；本文件
不会虚构多日使用或跨平台实体设备验证证据。

v0.4.4 建立在稳定的 v0.4.3 陪伴界面版本之上。它不带来新功能，也没有行为变化：
陪伴界面、check-in 策略、设置契约、隐私边界和多语言文案都与 v0.4.3 完全一致。
用户得到的是更安全、更新的底层基础。

## 变化

### 安全

- **CVE-2026-14257** — 内置依赖已升级到修复后的 `brace-expansion` 版本
  （1.1.18 / 2.1.4 / 5.0.9），关闭了这个广泛使用的间接依赖中的拒绝服务问题。

### 稳定性更新

- Electron 43.2.0、本地推理运行时（`@huggingface/transformers` 4.2.0）和 Live2D
  渲染栈（pixi.js 8.19.0 + `@jannchie/pixi-live2d-display` 1.4.0）整体升级到当前
  版本，吸收上游的崩溃与兼容性修复。
- 启动修复：Live2D UMD vendor 包现在内联 `process.env`，修复了可能停在启动失败
  画面的路径。

### 工具链升级

- ESLint 10.7.0 与 TypeScript 7.0.2，并保留 `typescript6@6.0.3` 双栈 shim，供仍
  需要经典编译器的工具使用。
- 启用 ESLint 10 的 `no-useless-assignment`（38 处）和 `preserve-caught-error`
  （24 处）规则，并把两处违规全部清零。

### 代码结构

- **循环依赖消除** — pet、agent、chat 和 prompts 模块现在共享抽出的类型模块，
  打破了彼此之间的 import 环。
- **大文件拆分** — i18n 语言文件按命名空间拆分，`localDataStore` 拆成 core 与
  chat 两个域，`windowManager` 的窗口创建和运行时状态抽成独立模块。

### CI 与发布管道

- 在仓库根新增 `.npmrc`（`legacy-peer-deps=true`），让 CI 的 `npm ci` 能解析当前
  peer 依赖图；同时把过期的 `minimatch` override 键放宽到 `minimatch@10`，保持
  lockfile 同步。
- 发布管道现在校验四个 `dist/vendor/ort/` WebAssembly 文件的大小和 SHA-256，
  被截断或损坏的推理运行时无法静默发出。

### 测试与文档

- 新增跨窗口聊天同步的专项测试（3 个用例），覆盖窗口间 `BroadcastChannel` 同步
  和回声抑制。
- 新增 `docs/BEHAVIOR_MAP.md`，为编码代理提供用户可见行为与实现模块之间的导航
  地图。

## 推迟范围

- 曾计划在 v0.4.4 编号下的 beta 反馈与文案调优切片从未合入 main，已推迟到后续
  版本，与本版无关。
- `eslint-plugin-react-hooks` 7.1.1 升级仍在等待：新的 `react-hooks/refs` 规则
  报告的点位需要先清理，升级才会落地。

## 未签名发行契约

官方 GitHub Releases 是唯一支持的二进制下载来源。v0.4.4 面向 macOS arm64、
Windows x64 与 Linux x64；不宣称提供 macOS x64 或 universal 资产。签名与公证
状态与 v0.4.3 一致。

### macOS unsigned auto-update limitation

macOS arm64 应用采用 ad-hoc 签名，不是 Apple Developer ID 签名或公证。ad-hoc 不
等于 Apple 信任，Gatekeeper 仍可能要求右键打开或明确移除隔离属性
（`xattr -dr com.apple.quarantine /Applications/Nexus.app`）。应用只检查新版本
并打开官方 release 页面；用户需要手动下载并替换应用。

### Windows unsigned installer limitation

Windows x64 NSIS 安装器状态为 `NotSigned`。SmartScreen 可能显示未知发布者，
安装器无法提供发布者身份验证或稳定声誉。用户应先确认资产来自官方 GitHub
Release，再决定是否继续运行。

每个平台构建都在同一个 GitHub Release 中附带独立校验清单：
`SHA256SUMS-windows.txt`、`SHA256SUMS-macos.txt` 和
`SHA256SUMS-linux.txt`。Linux 用户只下载其中一种包格式时，可以运行
`sha256sum --ignore-missing -c SHA256SUMS-linux.txt` 进行校验。

## 隐私边界

与 v0.4.3 一致。桌面陪伴感知仍然只产生短生命周期、粗粒度、脱敏的摘要；暂停会
停止采集并阻止摘要进入模型；原始窗口标题、截图、剪贴板正文、消息正文、文件
路径、精确计时和桌面活动时间线始终不进入模型边界。

## 不包含

- 不做新功能、界面变化、提示词变化或陪伴行为变化。
- 不改变 check-in 策略、隐私边界或设置契约。
- 不做 v0.5 桌宠跟随鼠标、打字反应或窗口控制。
