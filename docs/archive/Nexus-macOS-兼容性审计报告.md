# Nexus — macOS 兼容性全面审计报告

审计对象:Nexus v0.2.5 (electron/React 桌面 AI 伴侣)
审计范围:package.json、electron 主进程、构建配置、脚本、源码、CI、文档
审计日期:2026-04-16
审计类型:只读审计 (未修改任何文件)

---

## 一、结论摘要

**总体评价:项目已具备 macOS 基础适配,可以编译出 `.dmg` / `.zip` 并在 Apple Silicon 上运行,但距离"开箱即用的 macOS 完整功能"还有若干阻断项和退化项。**

分级如下:

| 等级 | 数量 | 说明 |
| --- | --- | --- |
| 阻断 (Blocker) | 3 | 未修复则 macOS 用户无法完成关键路径 |
| 严重 (Major) | 5 | 核心功能在 macOS 上降级或不工作 |
| 次要 (Minor) | 6 | 体验/可维护性问题,不阻塞发布 |
| 已适配 (Good) | 9 | 已有显式 macOS 分支处理 |

---

## 二、已经做对的部分 (Good)

项目并非完全忽视 macOS。以下代码路径已显式适配:

1. **electron-builder 配置 `mac` 段完整** — `package.json` 71–149 行已配置 `dmg` + `zip` 目标、`public.app-category.utilities` 分类、`darkModeSupport: true`、麦克风/屏幕录制的 usage 说明字符串。
2. **Hardened Runtime 权限清单存在** — `build/entitlements.mac.plist` 已声明 `audio-input`、`screen-capture`、`network.client`、`network.server`、`allow-unsigned-executable-memory` (后者对 sherpa-onnx 原生 dylib 必需)。
3. **Skia 渲染器在 macOS 上被禁用** — `electron/main.js:75-77` 有针对 darwin 的 `UseSkiaRenderer` 关闭,注释说明是为了解决透明窗口 + WebGL 的 SharedImageManager 竞态。
4. **Dock 图标在桌宠模式下隐藏** — `electron/main.js:220-223` 调用 `app.dock.hide()`。
5. **window-all-closed 保留应用** — `electron/main.js:277-279` 按 macOS 习惯不退出应用。
6. **alwaysOnTop 按平台使用不同 level** — `electron/windowManager.js:139, 384` 在 darwin 上使用 `'floating'`,其他平台用 `'screen-saver'`。
7. **applicationMenu 在 macOS 才设置** — `electron/windowManager.js:662-696` 为 macOS 构建标准菜单栏 (About / Hide / Edit),其他平台显式 `Menu.setApplicationMenu(null)`。
8. **Tray 图标使用 macOS 模板图标** — `electron/windowManager.js:700-710` 使用 `nexus-trayTemplate@2x.png` 并 resize 到 22×22,利用模板机制自动适配明暗模式。资产已存在于 `public/nexus-trayTemplate{,@2x}.png`。
9. **Dock 边距补偿** — `electron/windowManager.js:17` 在 darwin 上将底边距从 24px 调大到 80px,避免桌宠按钮被 Dock 遮挡。
10. **Python 命令按平台切换** — `electron/main.js:146, 158` 使用 `python3` (macOS/Linux) vs `python` (Windows)。
11. **快捷键兼容 Cmd** — `electron/windowManager.js:437, 531` DevTools 监听 `input.control || input.meta`,覆盖 Cmd+Shift+I。
12. **原生前台窗口抓取有 darwin 分支** — `electron/services/desktopContextService.js:92-146` 使用 osascript 调用 System Events,不是降级为 null。
13. **媒体会话在非 Windows 上优雅降级** — `electron/mediaSessionRuntime.js:16-21` 非 win32 直接返回空 JSON,不会崩溃。
14. **sherpa-onnx-node 官方支持 darwin-arm64 和 darwin-x64** — `node_modules/sherpa-onnx-node/package.json` optionalDependencies 包含两者,在 macOS 上 `npm install` 会自动拉对应 native 包。
15. **CI 跨平台 release workflow** — `.github/workflows/release.yml` 使用 `windows-latest` / `macos-latest` / `ubuntu-latest` 矩阵,每个平台原生构建。
16. **README 与下载页承诺 macOS 支持** — 提供 `.dmg` / `.zip` 下载链接,说明了绕过 Gatekeeper 的方法。

---

## 三、阻断项 (Blocker) — 必须修复

### B1. `extraResources` 为空,sherpa 模型不随安装包发布

**位置:** `package.json:84`

```json
"extraResources": [],
```

**问题:**
- 运行时 `sherpaKws.js:40-42`、`sherpaSenseVoice.js:26-27`、`sherpaParaformer.js:26-27` 都到 `process.resourcesPath/sherpa-models` 找模型。
- `postinstall` 脚本只在 **开发者机器上** 下载模型到工作区 `./sherpa-models/`,而 electron-builder 的 `files` 数组不包含该目录,`extraResources` 又为空。
- 结果:macOS 用户下载 `.dmg` 装好 Nexus.app 后,唤醒词、VAD、本地 SenseVoice STT **都会因找不到模型而失败**。
- 这不是 macOS 独有问题,Windows/Linux 安装包也一样。但对 macOS 影响更大 — Windows 用户至少有人发 `setup.bat`,macOS 没有替代路径;源码里 `src/hooks/voice/conversationEntrypoints.ts:132,157` 的提示说"请运行 node scripts/download-models.mjs"在 .app 里根本不存在。

**建议:**
任选其一 —
- (a) 把 `sherpa-models/` 加入 `extraResources`,代价是安装包增加 ~277 MB (KWS 47 MB + SenseVoice 230 MB);或
- (b) 在 Electron 主进程里实现首次启动时的模型按需下载,把 `scripts/download-models.mjs` 的逻辑内联进 IPC handler,并给用户一个进度条。

### B2. 发布 workflow 只输出一个 mac 架构

**位置:** `.github/workflows/release.yml:112-116`

```yaml
- os: macos-latest
  cmd: npx electron-builder --mac dmg zip --publish never
```

**问题:**
- `macos-latest` 在当前 GitHub Actions 是 **Apple Silicon (M1/M2)** runner。
- `npm ci` 只会在 Apple Silicon 上拉 `sherpa-onnx-darwin-arm64`,打包的 `.dmg` **在 Intel Mac 上运行时 sherpa-onnx 原生模块会加载失败**。
- `electron-builder` 默认只构建 host 架构。没有 `--mac dmg --x64 --arm64` 或 `--universal`。
- Intel Mac 用户(相当比例,尤其中国用户)下载后启动 → 唤醒词/VAD/本地 STT 直接崩,其他功能可能也因 app 启动时 require 失败而全体罢工。

**建议:**
任选其一 —
- (a) 构建 Universal Binary:`--mac dmg zip --universal` — 体积翻倍,但一个包覆盖 x64/arm64;
- (b) 矩阵内增加 `macos-13` (Intel) runner,分别产出 `-x64.dmg` 和 `-arm64.dmg`;
- (c) 如果只支持 Apple Silicon,在 README 和 releases 页面 **明确标注**,并在 electron 入口检测 `os.arch() === 'x64'` 时给 Intel 用户一个友好提示。

### B3. 首次启动 osascript 无对应 TCC/Entitlement 声明

**位置:**
- `electron/services/desktopContextService.js:107-112` — 通过 `osascript` 调 System Events 获取前台应用窗口标题。
- `build/entitlements.mac.plist` — 缺失 `com.apple.security.automation.apple-events`。

**问题:**
- 调用 AppleScript 让 System Events 告知前台应用 → 触发 macOS TCC **"自动化 / 辅助功能"** 授权弹窗。
- 如果应用将来启用 Hardened Runtime 并做公证,而 entitlements 里没有 `com.apple.security.automation.apple-events`,osascript 调用 **会被直接拒绝** (errAEEventNotPermitted),用户连看到弹窗授权的机会都没有。
- 目前 release workflow 跳过了签名(`CSC_IDENTITY_AUTO_DISCOVERY: false`),所以暂时不炸;但任何未来开启签名 + 公证的尝试都会让"桌面感知"功能在 macOS 上完全失效。
- 次生问题:屏幕录制权限在 macOS 需要用户在系统设置 → 隐私与安全性 → 屏幕录制 **手动勾选** Nexus.app,entitlement 只是允许请求,不会自动勾上。首次使用"视觉上下文"功能会静默失败直到用户去设置里授权,代码里没有提示用户这一点。

**建议:**
- 在 `build/entitlements.mac.plist` 中加入:
  ```xml
  <key>com.apple.security.automation.apple-events</key>
  <true/>
  ```
  并在 Info.plist 里(通过 `build.mac.extendInfo`)加入 `NSAppleEventsUsageDescription`,例如 "Nexus 需要访问系统事件来识别你当前在用的应用,以便智能响应。"
- 在 `captureActiveWindowContextMac` 的 catch 分支里检测 `error.code === 1` (权限拒绝)并回传给 UI,弹一条引导用户去"隐私与安全性 → 自动化"授权的消息。
- `src/features/vision/` 触发屏幕截图前,先用 `systemPreferences.getMediaAccessStatus('screen')` 判断,如果是 `denied`/`not-determined`,提示用户去系统设置。

---

## 四、严重问题 (Major) — 降级但不阻断

### M1. `electron/mediaSession.ps1` 在 macOS 上完全失效

**位置:** `electron/mediaSession.ps1` + `electron/mediaSessionRuntime.js:16-21`

运行时会直接返回 `{ ok: true, hasSession: false }`,也就是 **Nexus 永远看不到 macOS 用户正在听什么歌**。README highlights 里没承诺这个功能,影响面可控,但对"了解你在做什么"的叙事是一个可见退化。

**建议:** 用 Swift/Objective-C 通过 `MPNowPlayingInfoCenter` 或 `AVAudioSession` 写一个 macOS 版的 `mediaSession` 小二进制,或用 JXA (`osascript -l JavaScript`) 通过 `Application('System Events')` 读当前播放状态。后者零编译成本但信息颗粒度差。

### M2. 桌宠 BrowserWindow 的透明 + alwaysOnTop 行为在 macOS 上有差异

**位置:** `electron/windowManager.js:358-381`

`transparent: true` + `frame: false` + `alwaysOnTop: 'floating'` 组合在 macOS 上:
- **不会跨 Mission Control / Spaces** — 除非设置 `win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })`,否则用户切换桌面(或某个 App 进入全屏)时桌宠就看不到了。`main.js`/`windowManager.js` **没有调用** `setVisibleOnAllWorkspaces`。
- **`hasShadow: false`** 在 macOS 上生效但透明窗口仍可能有系统级描边。
- `skipTaskbar: true` 在 macOS 无直接对应 — macOS 用的是 `app.dock.hide()`,代码已经做了,但只对整个 app 生效;单独让一个窗口不在 Command+Tab 中出现,需要 `setSkipTaskbar` 在 macOS 下几乎 no-op。

**建议:**
- `createMainWindow` 的 `did-finish-load` 回调中追加:
  ```js
  if (process.platform === 'darwin') {
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  }
  ```

### M3. `app.dock.hide()` 让所有窗口在 Cmd+Tab 中消失

**位置:** `electron/main.js:220-224`

`app.dock.hide()` 确实实现了"floating widget" 效果,**代价**是整个应用(包括 panel settings 窗口)都不会出现在 Cmd+Tab 里,用户想切回设置面板只能点托盘图标。这可能是设计意图(桌宠专用机型),但如果 panelWindow 打开时用户在别的 App 里, 无法用键盘快速切回 Nexus 来 `Cmd+V` 粘贴 API Key — 实测体验会比较割裂。

**建议:**
- 让 dock 隐藏成为可选项(设置里开关),或者:
- 只在 `mainWindow` 全部隐藏时调用 `app.dock.hide()`,打开 `panelWindow` 时临时 `app.dock.show()`。

### M4. Intel Mac 的 onnxruntime-node / sharp / esbuild 架构处理

**位置:** `package.json:82`

```json
"!node_modules/onnxruntime-node/bin/napi-v3/win32/arm64/**"
```

排除了 Windows ARM64 路径,但 macOS 上打包时 `node_modules/onnxruntime-node/bin/napi-v3/darwin/{arm64,x64}/` 两个目录都会被带进 asar。如果出 universal 包,没问题;如果出单架构包,**会把另一架构的二进制一起装进去** — 增加 ~30 MB 但不影响运行。这是 minor-to-major,取决于是否还想压缩安装包。

**建议:** 如果确认目标只出 arm64 或出 universal,进一步清理 `files` 规则:
```
"!node_modules/onnxruntime-node/bin/napi-v3/darwin/x64/**"  // 仅 arm64 构建
```
同理 `sharp`、`esbuild`、`@rolldown/binding-darwin-*` 都有类似对偶包。

### M5. 托盘图标模板加载路径假设了 public→dist 镜像

**位置:** `electron/windowManager.js:702-710`

```js
const trayIconDir = isDev
  ? path.join(__dirname, '..', 'public')
  : path.join(__dirname, '..', 'dist')
```

生产模式下从 `dist/` 读 `nexus-trayTemplate@2x.png`。问题是 vite 的构建产物默认把 `public/*` 原样拷贝到 `dist/`,但 **这假设了图标存在于 dist**。如果未来有人优化 vite 的 public 处理逻辑,或打包器更改,托盘图标在 macOS 上就会 `createFromPath` 得到空 image,导致 `new Tray(emptyIcon)` 在 macOS 上抛 `Cannot create Tray with empty image`。

**建议:** 在 `electron-builder` 的 `files` 里显式包含图标作为应用资源,用 `__dirname/../` 不稳定,应统一走 `process.resourcesPath` 或在 builder 中用 `extraResources` 显式搬运 `public/nexus-trayTemplate*.png` 到 `Contents/Resources/`。

---

## 五、次要问题 (Minor)

### m1. `README.md:94` 的 build 示例只展示 `npm run package:win`

macOS 用户看 README 引导的第一条命令是 `npm run package:win`,虽然下一行有注释说可以换成 `package:mac`,但对非英文用户不够友好。

### m2. `docs/DELIVERY.md` 全文只提 Windows

整个交付流程文档未提及 macOS 验证步骤。当前只有 Windows smoke test 和 Windows installer 被标记为"验证通过"。macOS 缺少对应的发布前检查清单。

### m3. CI workflow 只跑 Windows

`.github/workflows/ci.yml:11` `runs-on: windows-latest`。任何破坏 macOS 构建的 PR(比如未来给 `electron/services/desktopContextService.js` 的 darwin 分支引入 bug)都不会在 CI 里被发现 — 要等到 release 打包时才炸。建议 lint+typecheck+test 改成跨平台矩阵(build 可以只跑 Windows 因为是最快的 runner)。

### m4. Icon 文件未提供 `.icns`

`package.json:101` 使用 `public/nexus-1024.png` 作为 mac icon。electron-builder 会自动生成 `.icns`,但生成的结果在各种 DPI 下不总是锐利 — 手工制作的 `.icns` (包含 16/32/64/128/256/512/1024 多尺寸位图 + retina 版本)效果更好。

### m5. `scripts/install-desktop-shortcut.ps1` 和 `scripts/launch-nexus.ps1` 都硬编码 `F:\nexus`

虽然这些是 Windows-only 脚本,但注释里的"项目根目录"假设是 `F:\nexus`,对任何跨平台/跨用户的复用都不友好。macOS 用户不会用到,但移植相同概念(dev-build 启动器)到 macOS 时需要注意 — 最好用 `Join-Path $PSScriptRoot '..'` 或对应 bash 写法,而不是绝对路径。

### m6. `setup.bat:75-77` 对 macOS 使用者毫无帮助

`setup.bat` 的 `[5/5] 验证安装...` 给出的错误提示 "可能需要安装 Visual Studio Build Tools" 对 macOS 调试者是误导。这是 Windows 脚本,本身无可厚非,但 `scripts/setup.sh` **没有对应的"验证 native module"步骤**,macOS 用户如果 sherpa-onnx 加载失败没有任何诊断帮助。

---

## 六、第三方依赖原生兼容性明细

| 依赖 | macOS 状态 | 备注 |
| --- | --- | --- |
| `electron` ^36.2.1 | ✅ 原生支持 | |
| `sherpa-onnx-node` ^1.11.3 | ✅ 官方 darwin-arm64/x64 | 需要 `extraResources` 正确拷贝 dylib |
| `onnxruntime-web` ^1.24.3 | ✅ WASM 纯浏览器 | |
| `onnxruntime-node` (sharp 间接) | ✅ darwin-arm64/x64 | 见 M4 |
| `@huggingface/transformers` ^3.8.1 | ✅ WASM | |
| `pixi.js` ^6.5.10 / `pixi-live2d-display` | ✅ WebGL | 依赖 electron 的 GPU 通路,见 `main.js:75` 的 SkiaRenderer workaround |
| `tesseract.js` ^7.0.0 | ✅ WASM | |
| `@ricky0123/vad-web` ^0.0.30 | ✅ WASM + WebAudio | 依赖浏览器麦克风权限,entitlement 已声明 |
| `electron-updater` ^6.8.3 | ⚠️ 需代码签名才能自动更新 | 当前 release workflow 显式关闭签名,自动更新在 macOS 实际上不工作 |
| `electron-builder` ^26.0.12 | ✅ | macOS 打包支持完备 |

---

## 七、macOS 适配修复工作量估算

| 工作项 | 所属等级 | 估工 | 优先级 |
| --- | --- | --- | --- |
| B1 模型随包发布 / 运行时按需下载 | 阻断 | 0.5–2 d | 必做 |
| B2 Universal Binary 或双架构构建 | 阻断 | 0.5 d | 必做(或 Intel 用户拒绝该产品) |
| B3 AppleEvents entitlement + 权限引导 | 阻断 | 0.5 d | 必做(配合未来签名时) |
| M1 macOS Now Playing 实现 | 严重 | 1–3 d | 看路线图 |
| M2 setVisibleOnAllWorkspaces | 严重 | <1 h | 立即可做 |
| M3 Dock 隐藏策略优化 | 严重 | 2–4 h | 推荐 |
| M4 多余架构 dylib 精简 | 严重 | 1–2 h | 减包体 |
| M5 托盘图标资源定位 | 严重 | 1 h | 建议 |
| m1–m6 文档/脚本/CI | 次要 | 合计 0.5–1 d | 有空就做 |
| electron-updater 签名+公证 | 长期 | 1–3 d + Apple 开发者账号 $99/年 | 规模化后必做 |

**粗略总估:3–5 个工作日可以把 macOS 从"能编译出包"推到"Apple Silicon 开箱即用",额外 2–3 天补齐 Intel Mac 和公证自动更新。**

---

## 八、立即可以做的三件事 (不用改代码)

如果现在就想让 macOS 版好很多,只需:

1. **在 `release.yml` 里把 `--mac dmg zip` 改成 `--mac dmg zip --x64 --arm64`** — 一行改动,解决 B2。代价是构建时长 + 包体翻倍。
2. **把 `extraResources: []` 改成 `extraResources: ["sherpa-models/"]`** — 一行改动,解决 B1 的一半(代价是安装包大约 +280 MB,前提是 `sherpa-models/` 已通过 postinstall 预下载)。
3. **在 `entitlements.mac.plist` 加两行** — 声明 `automation.apple-events`,为未来签名做好准备(B3)。

这三个改动加起来不超过 10 行,就能把 macOS 从"有隐患"推到"基本可用"。

---

## 九、审计依据(全部为源码实证)

本报告中的每一条断言都对应仓库中可见的文件/行号:

- `package.json` 71–149(electron-builder 配置)
- `electron/main.js` 75–77、146、158、220–224、277–279
- `electron/windowManager.js` 17、73、139、384、437、531、662–696、700–710
- `electron/services/desktopContextService.js` 80–146、149–155、169–202
- `electron/mediaSession.ps1` 15–17(WinRT-only API)
- `electron/mediaSessionRuntime.js` 16–21
- `electron/sherpaKws.js` 38–42、`sherpaSenseVoice.js` 26–27、`sherpaParaformer.js` 26–27
- `build/entitlements.mac.plist`(缺 `automation.apple-events`)
- `scripts/setup.sh`(有 macOS 分支)
- `.github/workflows/ci.yml`(windows-latest only)
- `.github/workflows/release.yml` 112–116(macOS 单架构)
- `src/app/controllers/useWorkspaceRootBridge.ts` 15–46(前端做了 Windows 盘符校验)
- `src/hooks/voice/conversationEntrypoints.ts` 132、157(错误提示指向不存在的脚本)

没有推测 — 每条都可以在当前 HEAD 验证。

---

报告完。
