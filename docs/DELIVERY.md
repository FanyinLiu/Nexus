# Nexus Delivery Guide

## Release Status

Nexus is currently in a shippable desktop-release state.

Validated commands:

- `npm run lint`
- `npm test`
- `npm run build`
- `npm run smoke`
- `npm run package:dir`
- `npm run package:win`
- `npm run verify:release`

Verified runtime behavior:

- The unpacked desktop build launches successfully.
- The packaged Windows executable launches successfully.
- The packaged macOS `.app` launches successfully on Apple Silicon after
  running `xattr -dr com.apple.quarantine` to clear Gatekeeper's
  translocation flag. First launch shows the in-app model-setup wizard.
- The packaged app falls back automatically when the preferred renderer port
  `127.0.0.1:47822` is already occupied.

## Release Artifacts

Primary local release outputs:

- `release/Nexus-Setup-0.0.0.exe`
- `release/win-unpacked/`

Useful metadata files:

- `release/latest.yml`
- `release/builder-debug.yml`

## Recommended Release Commands

Daily engineering verification:

```bash
npm run lint
npm test
npm run build
npm run smoke
```

Full local release verification:

```bash
npm run verify:release
```

Unsigned Windows installer build:

```bash
npm run package:win
```

Signed Windows installer build:

```bash
npm run package:win:signed
```

## Packaging Notes

- Local unsigned packaging uses `signAndEditExecutable=false` to avoid the
  Windows metadata-edit/signing step during normal developer builds.
- Signed release builds should use `npm run package:win:signed` in an
  environment where signing is configured.
- `electron/mediaSession.ps1` is unpacked at package time on Windows only
  (it drives the SMTC media-session bridge; macOS uses JXA/osascript).
- Large ML-related chunks such as local Whisper worker assets and Transformers
  browser runtime assets are intentionally lazy-loaded. The main application
  runtime bundle has been reduced so startup-critical UI code stays separate
  from optional local AI pipelines.
- Sherpa-onnx voice models (KWS / SenseVoice) + Silero VAD are bundled on
  Windows / Linux via `extraResources`, but **not** bundled on macOS — the
  `.dmg` stays slim and the in-app setup wizard downloads them on first
  launch to `~/Library/Application Support/Nexus/sherpa-models`. Runtime
  services probe both `userData` and the `resourcesPath` bundled location,
  so either layout works.
- Python sidecars (OmniVoice TTS, GLM-ASR) auto-start only if (a) the
  `scripts/*.py` server script is bundled and (b) the Python runtime probe
  at startup confirms `torch`, `transformers`, `fastapi`, `uvicorn` are
  importable. Missing prerequisites produce a single info-level log line
  and skip the spawn — no tracebacks, no spinning startup checks.

## macOS Verification

When delivering a macOS build, verify the following on an Apple Silicon AND
an Intel host (the release workflow builds both slices on a single runner
via `--x64 --arm64`):

1. **Gatekeeper first launch.** On an unsigned build the `.dmg` opens but
   the `.app` refuses to run. Right-click → *Open* → confirm, or run
   `xattr -dr com.apple.quarantine /Applications/Nexus.app` after copying.
2. **TCC prompts.** First voice session should surface the *Microphone*
   prompt; first desktop-context capture should surface *Screen Recording*;
   Now Playing / foreground-app detection should surface *Automation*
   (System Events + Music/Spotify). All three are declared in
   `package.json > build.mac.extendInfo` with usage strings.
3. **Tray + dock.** The menu-bar icon should appear using the template
   asset (`public/nexus-trayTemplate@2x.png`). The dock icon is hidden
   while only the pet overlay is visible, and re-appears while the panel
   window is open (ref-counted via `acquireDock` / `releaseDock` in
   `electron/windowManager.js`).
4. **Transparency + fullscreen.** The pet window uses
   `setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })` so it
   should remain visible when another app enters fullscreen. Transparency
   is forced through the non-Skia compositor via
   `--disable-features=UseSkiaRenderer` in `electron/main.js`.
5. **Native module sanity.** Run `bash scripts/setup.sh` — it now calls
   `require('sherpa-onnx-node')` as a smoke check so a missing
   `darwin-arm64` / `darwin-x64` optional binary surfaces immediately
   rather than at first use.
6. **Now Playing.** With Apple Music or Spotify playing, the companion
   should be able to read track metadata via `osascript -l JavaScript`.
   If the user has denied Automation access, the media session is reported
   as empty instead of erroring.
7. **Model setup wizard.** On a clean install (no `~/Library/Application Support/Nexus/sherpa-models` directory), the in-app wizard appears in the
   panel view and offers a one-click download for the 4 required models
   (KWS EN, KWS ZH, SenseVoice, Silero VAD — ~280 MB total). The wizard
   subscribes to `models:download-progress` IPC events and renders per-model
   progress bars; "稍后再说" is remembered on this computer, so the wizard
   does not open again on a later launch. The next time the user tries to
   talk, the pet says once where to download the models.
8. **Python fallback.** On a mac without `pip install -r requirements.txt`,
   the OmniVoice / GLM-ASR sidecars are skipped at startup. Log output
   should show one of: `[OmniVoice] Skipping auto-start — Python
   prerequisites not met.` or `[OmniVoice] Script not bundled in this
   build — skipping auto-start.` — never a Python traceback.

Validated macOS commands:

```bash
bash scripts/setup.sh
npm run verify:release
npm run package:mac
```

The `release/` folder for a macOS build contains:

- `Nexus-<version>-arm64.dmg` / `.zip` (Apple Silicon)
- `Nexus-<version>.dmg` / `.zip` (Intel)

## Architecture Pointers

- Structure overview: [ARCHITECTURE.md](./ARCHITECTURE.md)
- Live2D import notes: [ADDING_LIVE2D_MODEL.md](./ADDING_LIVE2D_MODEL.md)

---

## 中文交付说明

### 当前状态

Nexus 目前已经达到本地可提交、可交付的桌面版本状态。

已重新验证的命令：

- `npm run lint`
- `npm test`
- `npm run build`
- `npm run smoke`
- `npm run package:dir`
- `npm run package:win`
- `npm run verify:release`

已确认的运行行为：

- 未安装版目录可以正常启动。
- Windows 打包后的 `Nexus.exe` 可以正常启动。
- 当首选渲染端口 `127.0.0.1:47822` 被占用时，打包版会自动回退到可用端口，不会因为端口冲突直接失败。

### 交付产物

- `release/Nexus-Setup-0.0.0.exe`
- `release/win-unpacked/`

### 建议验收命令

日常工程检查：

```bash
npm run lint
npm test
npm run build
npm run smoke
```

完整本地交付验证：

```bash
npm run verify:release
```

### 打包说明

- 本地无签名打包使用 `signAndEditExecutable=false`，避免在普通开发环境卡在签名步骤。
- 需要正式签名时，使用 `npm run package:win:signed`。
- `electron/mediaSession.ps1` 已按打包运行时要求解包，安装版/便携版都能继续使用媒体会话桥接。
- 目前仍然较大的 chunk 主要来自本地 Whisper Worker 和 Transformers 浏览器运行时，它们都是按需懒加载，不会再把主界面启动包体一起拖大。

### macOS 交付验收

macOS 发布流程在一个 `macos-latest` Runner 上同时构建 Apple Silicon 和 Intel 两种切片（`electron-builder --x64 --arm64`），建议在两种 Mac 上各自验证：

1. **Gatekeeper 首次启动**：未签名的 `.dmg` 能打开，但 `.app` 默认会被拒绝运行。右键 →「打开」→ 确认，或复制到 /Applications 后执行 `xattr -dr com.apple.quarantine /Applications/Nexus.app`。
2. **TCC 权限弹窗**：第一次语音对话触发「麦克风」；第一次桌面上下文抓取触发「屏幕录制」；Now Playing / 前台应用识别触发「自动化（System Events + Music/Spotify）」。这三个 usage string 已写在 `package.json > build.mac.extendInfo`。
3. **托盘 + Dock**：菜单栏图标使用模板素材 `public/nexus-trayTemplate@2x.png` 呈现。只显示桌宠时 Dock 图标隐藏，打开设置/对话面板时 Dock 图标显示（通过 `electron/windowManager.js` 里的 `acquireDock` / `releaseDock` 引用计数控制）。
4. **透明窗体 + 全屏**：桌宠窗口通过 `setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })` 在其他应用进入全屏时仍保持可见；透明渲染通过 `electron/main.js` 里 `--disable-features=UseSkiaRenderer` 回退到老版合成器。
5. **原生模块校验**：`bash scripts/setup.sh` 现在会执行 `require('sherpa-onnx-node')` 做冒烟检查，缺 `darwin-arm64` / `darwin-x64` optional 二进制会立刻报警，而不是等到运行时。
6. **Now Playing**：Apple Music 或 Spotify 正在播放时，桌宠能读到曲目信息（通过 `osascript -l JavaScript`）。用户拒绝自动化权限时返回空会话，而不会抛异常。

已验证命令：

```bash
bash scripts/setup.sh
npm run verify:release
npm run package:mac
```

打包输出位于 `release/`：

- `Nexus-<version>-arm64.dmg` / `.zip`（Apple Silicon）
- `Nexus-<version>.dmg` / `.zip`（Intel）
