# Nexus v0.4.6-beta.1 — 形象运行时可靠性

**状态：已于 2026-08-10 发布为 GitHub Pre-release，不是公开稳定版。** 当前
稳定版仍是 v0.4.5。受保护 tag 工作流已从提交 `44dd91c` 发布
`v0.4.6-beta.1`，真实使用验证窗口仍在进行。

v0.4.6-beta.1 是一个聚焦 Live2D 的可靠性切片：修复透明窗口合成、让图形
上下文丢失可恢复，并强化现有三模型可视化门禁；不新增感知来源，也不改变
伙伴策略。

## 主要变化

### 透明 Live2D 合成

- Pixi 以直通 Alpha（`premultipliedAlpha: false`）初始化 Live2D 画布，避免
  Electron 在 macOS 合成透明伙伴窗口时产生白色边缘像素。
- 渲染器 CSP 只在 `connect-src` 中增加 `data:`，满足 Pixi 本地 ImageBitmap
  能力探测；脚本、图片、frame 和远程连接策略保持不变。

### 有界 WebGL 恢复

- WebGL 上下文丢失时，会自动重建独占的 Pixi 应用、画布和 Live2D 模型。
- 连续恢复最多重试两次；成功首帧会重置预算。反复失败时停止重启并显示可读
  降级状态，避免无限循环。
- 销毁运行时前先解绑上下文监听器，继续遵守单一所有者与幂等清理契约。

### 可读降级状态

- Live2D 启动或图形失败时，界面不再直接显示技术错误。五语言状态提示会让
  伙伴窗口保持可理解、可使用；技术详情仍保留在现有调试状态中。

### 长期可复用的可视化证明

- Mao、Haru、Hiyori 现有烟测会在同页切换序列中主动触发真实
  `WEBGL_lose_context`。
- 门禁会确认旧画布、Pixi 应用和模型均已替换，旧画布已脱离 DOM，恢复后只
  留下一个画布。
- 烟测继续覆盖三次冷启动、Mao → Haru → Hiyori → Mao 切换、首帧时间、浏览器
  错误、截图差异和七张截图的透明/不透明边缘背景。

## Beta 验证边界

发布审查前必须完成：

- `npm run verify:release`
- `npm run live2d:three-model:smoke`
- `npm run package:dir:smoke`
- `npm run runtime:packaged-sustained`
- `npm run prerelease-check -- v0.4.6-beta.1`
- 发布提交在 macOS、Windows、Linux 的 CI 全绿

本地浏览器烟测能证明 Chromium 中的 Pixi 生命周期和截图行为，但不声称覆盖
所有物理设备或全部操作系统窗口合成器；打包 Electron 门禁仍不可省略。

## macOS unsigned auto-update limitation

macOS arm64 beta 采用 ad-hoc 签名，不是 Apple Developer ID 签名，也未公证。
Gatekeeper 可能要求右键打开，或执行
`xattr -dr com.apple.quarantine /Applications/Nexus.app`。应用只打开官方发布页，
用户需要手动下载并替换应用。

## Windows unsigned installer limitation

Windows x64 安装器为 `NotSigned`，SmartScreen 可能显示未知发布者。绕过提示
不是安全保证；只应使用官方 GitHub Release，并核对发布的 SHA-256 校验和。

Linux x64 仍由受保护工作流生成 AppImage、deb、tar.gz、更新元数据和
`SHA256SUMS-linux.txt` 完整闭包。

## 范围边界

- 不升级依赖。
- 不新增存储迁移或持久数据。
- 不新增桌面感知、遥测或外部服务。
- 不包含 v0.5 的移动、鼠标/打字反应或实体设备控制。
- beta 验证关闭并单独准备稳定晋升前，v0.4.5 仍是稳定更新目标。
