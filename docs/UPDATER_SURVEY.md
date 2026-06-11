# 版本升级（构建/分发/auto-update）调研

> 调研日期：2026-06-10。基线：v0.3.2 已发布，工作区 package.json = 0.3.3-beta.1。
> 镜像/政策类信息时效性强，引用处标注了时点。

---

## 0. 最大发现：auto-update 不是"要建"，是早就全量存在

electron-updater 链路从 **v0.2.0 起**就完整发布（`git tag --contains e62bed1` 验证）：

- 主进程 `electron/services/updaterService.js`（147 行）：main.js:367 调 `initAutoUpdater`，启动 8 秒后静默检查；`autoDownload=true`、`autoInstallOnAppQuit=true`、`allowDowngrade=false`；6 类事件经 `updater:event` 广播（:56-109）
- IPC `electron/ipc/updaterIpc.js`（check / quitAndInstall）+ preload.js:258-259
- Renderer `src/features/updater/` + 设置页 `UpdaterPanel.tsx` + `AboutPanel.tsx:35`（版本显示，单一来源 `app.getVersion()`，无硬编码版本串）
- GitHub Release v0.3.2 挂着 `latest.yml` / `latest-mac.yml` / `latest-linux.yml` + 各平台 blockmap，README:152-156 也写明会自动更新
- dev 模式（unpackaged）自动跳过，IPC 返回 `dev-mode`

## 1. 构建/发布链现状

- 打包配置在 package.json `build` 字段：appId `ai.factory.desktoppet`，输出 `release/`；win→nsis（oneClick:false）、mac→dmg+zip（CI 仅 arm64，Intel 已于 v0.2.8 弃）、linux→AppImage+deb（CI 另打 tar.gz+SHA256SUMS）；`publish: github → FanyinLiu/Nexus`（repo PUBLIC）
- 发布流：`docs/RELEASING.md`（Beta→Validation→Stable 三段，禁手动 gh release create/复用 tag/跳过 beta）；`release.yml` 由 `v*.*.*` tag 触发：ensure-release(draft) → preflight(prerelease-check) → 三平台并行 build+upload → 全绿才 publish
- tag 格式 `vX.Y.Z` / `vX.Y.Z-beta.N`；v0.2.4 缺号（烧掉），v0.2.8 也有 burnout 教训

### 全平台未签名（文档化的已知状态）
- mac：`hardenedRuntime:false`、`gatekeeperAssess:false`、无 notarize；CI 显式 `CSC_IDENTITY_AUTO_DISCOVERY: false`；entitlements 文件注释自述 "for ad-hoc signed unsigned builds"
- win：CI 显式 `--config.win.signAndEditExecutable=false`；SmartScreen 首启告警（release notes 自认）
- linux：可选 GPG detached 签名（secret 配了才签）
- 用户侧缓解：release notes 指引 mac 用户 `xattr -dr com.apple.quarantine`（RELEASE-NOTES-v0.3.2.md:147）

## 2. 真正的缺口

### 缺口 1：macOS 更新链路大概率整个是坏的（未验证盲区）
从 Squirrel.Mac 源码（SQRLCodeSignature）层面确认：**macOS 自动更新硬性要求有效 Developer ID 签名**——框架取当前运行 app 的 designated requirement 验证下载包，要求"有效签名 + 同一开发者身份"。这是框架内嵌校验，**electron-updater 无开关、不可绕过**；开源身份、官方 update.electronjs.org 都没有豁免（其条件同样写明 code signed）。未签名的失败表现：`"Could not get code signature for running application"` / `"code object is not signed at all"`。

注意边界：**公证（notarization）不是更新校验项**——更新由 app 自己下载、无 quarantine、不过 Gatekeeper；公证只是首次浏览器下载的前提。即：签名 = 更新硬前提，公证 = 首装分发前提。

repo 内没有任何 mac 更新实际 apply 成功的验证记录或已知问题文档——当前 mac 用户的"自动更新"大概率在安装阶段静默失败。

Windows 不受影响：NSIS 更新 = 下载新完整安装器静默运行（`/S --updated`），不依赖签名，靠 HTTPS + sha512 校验；blockmap 差量两端都有（mac 差量需 electron-updater ≥6.3，当前 ^6.8.3 满足）。

### 缺口 2：大陆用户走 GitHub 的可达性
- 失败模式：yml 检查超时报"检查更新失败"，或下载极慢/中断；release 资产 302 到 `release-assets.githubusercontent.com`（2025-04 起新域名），可达性不稳
- 缓解手段评估：ghproxy 系镜像域名寿命 1-2 年（ghproxy.com→mirror.ghproxy→ghfast.top），**只能作 UI 备选下载链接，绝不能硬编码为更新源**；jsDelivr 不能代理 release 附件（且实际 20MB 上限）；Gitee 附件 ≤100MB + 审核 + 大陆手机号，对 Electron 包太紧
- 正解（若失败率高）：generic provider + 国内 COS/OSS/CDN 同步 yml+安装包+blockmap，electron-builder 原生支持；代价 = ICP 备案域名 + 防盗刷流量费
- 双源回退无内置支持：publish 数组运行时只用第一个；社区惯例 = 运行时探测后 `setFeedURL()` 动态切换，自写
- **务实路线：先 GitHub 单源 + 检查失败静默吞掉（不弹错误打扰），观察真实失败率再决定上不上 CDN**

### 小卫生问题
- v0.3.1-beta.3 残留一个 Draft release
- release.yml 注释（称 pre-release 发 beta.yml channel）与 RELEASING.md（靠 GitHub latest API 排除 pre-release）对 beta 防自动升级机制的描述不一致，未核实 beta release 上是否真有 beta.yml；GitHub provider 下 `detectUpdateChannel` 不生效，channel 须显式设置，prerelease 走 `allowPrerelease`

## 3. 核心决策：买不买 Apple Developer（$99/年）

### 买（候选 B：一步到位）
- 个人注册当天可用（双因素 Apple ID + 本人信用卡 + 法定真名）
- electron-builder v26 签名+公证已是"配三个环境变量"级别：`mac.notarize` 为布尔值（teamId 对象写法 v26.0.0 已移除），凭据环境变量存在即默认自动公证；CI 首选 `APPLE_API_KEY`/`APPLE_API_KEY_ID`/`APPLE_API_ISSUER` 三件套；`hardenedRuntime: true` 转默认开；旧 afterSign+@electron/notarize 脚本写法已过时
- 配完现有 updater 链路立即真正可用，无需改代码
- 外部压力都在推这个方向：macOS Sequoia (15) 已移除右键"打开"绕过（用户每个新版本要去系统设置点"仍要打开"+输密码）；Homebrew 5.0 公告 **2026-09 起禁用过不了 Gatekeeper 的官方 cask**

### 不买（候选 A/C：check-only 降级）
- mac 端把现有 updater 降级为 check-only：匿名 GitHub API `releases/latest`（60 次/小时/IP 足够）→ semver 对比 → 非打断提示 → `shell.openExternal` 到 release 页；检查失败静默。约 50 行或用 pd4d10/electron-update-notification
- Windows 保留 electron-updater 全自动（同一套代码按平台分流）
- 注意：electron-builder **26.15.0（2026-06-05）起移除无证书自动 ad-hoc 签名 fallback**——arm64 要 ad-hoc 必须显式 `mac.identity: "-"`（否则 Apple Silicon 上 Gatekeeper "damaged"；本机构建因 Electron 预置 linker ad-hoc 签名能跑）。26.0.13~26.14 期间是自动 ad-hoc 的
- ad-hoc 只解决 Apple Silicon 内核页级签名（防 SIGKILL），**不能**过 Gatekeeper、不能用于 Squirrel 更新；DIY 下载自替换 .app 不可行（App Translocation 只读随机路径）
- xattr 指引可作当下兜底，但与恶意软件诱导话术同款，摩擦只增不减，只当临时态

### Windows 签名（独立决策，优先级低）
- 未签名只是 SmartScreen 摩擦，不阻断 auto-update，可先不签
- 要签：2023-06 起 OV 私钥强制硬件 token；EV 已无 SmartScreen 即时信誉优待（2024-03 起）；非北美个人最便宜 = Certum 开源开发者证书（首套 ~€69-85，续 ~€29/年）；Azure Trusted Signing（现名 Artifact Signing，$9.99/月）个人仅限美加，走不通

## 4. 无论买不买都该先做：数据迁移骨架

- 用户用 check-only 也会跳版本升级（v0.3→v0.5），二进制层面天然安全（每次完整包，差量失败回退全量），**坑全在设置/localStorage 迁移**
- "只写相邻版本迁移"是行业级踩坑模式（GitLab 强制禁跳版、Nextcloud 拒绝跨大版本）
- 正解：数据记 `schemaVersion` 整数 + while 循环逐级执行所有中间迁移，跳版本自动安全；迁移前备份旧配置（`config-v0.3.json.bak`）；遇"数据版本比应用新"拒绝加载而非反向迁移
- electron-store 自带 migrations 有官方自认的已知 bug 且无修复计划，自管 schemaVersion 是主流
- localStorage/IndexedDB 迁移只能在 renderer 侧、业务读数据前做

## 5. 更新 UX 惯例（现状已大体符合）

- 检查时机：启动延迟检查 ✅（现 8 秒）+ 可选周期轮询（update-electron-app 默认 10 分钟，VS Code ~24h）+ 手动入口 ✅（UpdaterPanel）
- 下载/安装：静默下载 + 退出自动装 ✅ + "重启以更新"软提示（非模态，Slack/VS Code badge 风格）
- staged rollout：发布后手动编辑 Release 上的 yml 加 `stagingPercentage`；回滚必须发更高版本号
- 注意 `checkForUpdates()` 调两次会下载两遍

## 来源

- electron-updater / auto-update: https://www.electron.build/docs/features/auto-update/ ・ https://www.electron.build/docs/tutorials/release-using-channels/ ・ GitHubProvider.ts / MacUpdater.ts / AppUpdater.ts（electron-builder 仓库）
- mac 差量: PR #7709；NSIS 差量收益: issue #6265
- Squirrel.Mac 签名校验: https://github.com/Squirrel/Squirrel.Mac/blob/master/Squirrel/SQRLCodeSignature.h ・ https://www.electronjs.org/docs/latest/tutorial/updates
- update.electronjs.org 条件: https://github.com/electron/update.electronjs.org ・ https://github.com/electron/update-electron-app
- ad-hoc fallback 引入/移除: electron-builder PR #9007 / PR #9822（26.15.0, 2026-06-05）
- Sequoia Gatekeeper: https://appleinsider.com/articles/24/08/06/apple-removes-control-click-option-for-skipping-gatekeeper-in-macos-sequoia
- Homebrew 5.0 截止线: https://brew.sh/2025/11/12/homebrew-5.0.0/
- App Translocation: https://eclecticlight.co/2023/05/09/what-causes-app-translocation/
- 公证: https://developer.apple.com/documentation/technotes/tn3147-migrating-to-the-latest-notarization-tool ・ https://www.electron.build/docs/mac/ ・ electron-builder v26.0.0 release notes
- Windows 签名: https://learn.microsoft.com/en-us/azure/artifact-signing/faq ・ https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation
- 大陆可达性: https://github.com/hunshcn/gh-proxy ・ jsdelivr issue #18268 ・ https://help.gitee.com/repository/release/ ・ release-assets 新域名（StepSecurity 博文, 2025-04）
- 迁移: https://github.com/sindresorhus/electron-store ・ gitlab-org/gitlab issue #356636
- check-only 实现: https://github.com/pd4d10/electron-update-notification ・ https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api
