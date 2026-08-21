# Nexus v0.4.6 — 形象运行时可靠性

**状态：正式未签名稳定版。** v0.4.6 是当前稳定版本，本文档是它的正式发行记录。
v0.4.6 经过 v0.4.6-beta.1 验证窗口后，按标准 beta 流程晋升。正式产物只由受保护
的 tag 工作流从发布提交创建。

v0.4.6 是一次聚焦桌面伙伴可靠性的发布：改善透明 Live2D 合成，支持有界恢复
WebGL 上下文丢失，并在图形初始化无法完成时保持伙伴状态可读。

## 变化

### 形象运行时可靠性

- Live2D 改用直通 Alpha 的 WebGL 输出，避免 Electron 在 macOS 合成透明伙伴窗口时
  产生白色边缘像素。
- Pixi 的本地 ImageBitmap 能力探测通过窄范围渲染器 CSP 放行，不扩大远程访问范围。
- WebGL 上下文丢失时会在有界预算内重建独占的 Pixi 应用、画布和模型；连续失败后停止
  重试并保留可读的本地化降级状态，避免进入重启循环。
- 三模型可视化烟测覆盖 Mao、Haru、Hiyori 的冷启动、切换、透明边缘和强制上下文恢复。

### 宠物导入边界

- 稳定版界面不再提供“从图片/Atlas 制作宠物”。仍可导入现有 Live2D/Sprite 宠物包、
  导入社区宠物包；需要在 Nexus 外创作宠物时，Creator Kit 仍然可用。

## 验证边界

发布提交必须通过 `verify:release`、Live2D 烟测、打包 smoke、持续运行门禁，以及完整的
`prerelease-check -- v0.4.6` 流程，然后才由受保护的 tag 工作流发布产物。macOS、Windows
和 Linux 的 CI 必须在该提交上全绿。

不会虚构跨平台实体设备验证证据。macOS 构建为 arm64、ad-hoc 签名且未公证；Windows
x64 安装器仍未签名。用户应只从官方 GitHub Release 下载，并核对发布的平台校验和。
macOS 首次启动如果被 Gatekeeper 拦截，可右键点击 Nexus.app 选择“打开”，或运行
`xattr -dr com.apple.quarantine /Applications/Nexus.app`。

## 范围边界

- 不升级依赖，不新增存储迁移、遥测或桌面感知来源。
- 不包含 v0.5 的移动、鼠标/打字反应或实体设备控制。
- 直接从图片/Atlas 生成宠物的功能有意不进入稳定版产品面；本版本支持宠物包导入与
  Creator Kit 创作路径。
