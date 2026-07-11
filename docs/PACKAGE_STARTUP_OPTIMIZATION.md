# Nexus 打包体积与启动路径优化清单

这份清单用于 Sprint 4 的先行盘点：先把安装包体积、构建资产、启动路径和可延迟下载资源列清楚，再决定是否改打包策略。当前文件不代表发布版本变更，也不触发模型迁移。

## 当前基线

以当前工作区的 `npm run performance:baseline` 为准：

| 指标 | 当前值 | 预算 | 说明 |
|---|---:|---:|---|
| 构建资产总量 | 27.64 MB | 35.00 MB | 只统计 `dist/assets`，不含 Electron、原生依赖和 extraResources。 |
| JavaScript | 3.88 MB | 5.00 MB | 最大 JS chunk 是 `transformers-vendor`，当前仍在预算内。 |
| CSS | 852.4 KB | 900.0 KB | 主入口 CSS 保持首屏轻量，Settings UI 通过延迟 CSS chunk 加载。 |
| WASM | 21.60 MB | 25.00 MB | 最大资产是 `ort-wasm-simd-threaded.jsep.wasm`。 |
| 最大 JS chunk | 868.7 KB | 1.20 MB | `transformers-vendor` 由记忆向量路径按需加载。 |
| 最大 CSS chunk | 554.0 KB | 650.0 KB | 最大块是延迟加载的 Settings CSS，不进入首屏 CSS。 |
| 首屏 CSS chunk | 298.4 KB | 450.0 KB | 主入口 CSS 的单块预算用于防止首屏样式无声膨胀。 |
| Settings drawer lazy CSS | 554.0 KB | 600.0 KB | 设置抽屉样式作为 CSS 资源延迟加载，避免 raw CSS 打进 JS 后同步注入。 |
| Settings drawer lazy JS entry | 0.1 KB | 100.0 KB | 设置入口 JS 只负责动态边界；若再次塞入 raw CSS 或重逻辑会触发预算。 |

本地目录快照：

| 路径 | 当前大小 | 含义 |
|---|---:|---|
| `dist/` | 74 MB | Vite 构建输出，含 assets 和入口文件。 |
| `public/vendor/` | 36 MB | Live2D/Pixi/ORT/VAD 供应商文件来源。 |
| `sherpa-models/` | 4 KB | 当前 checkout 只有 README；发布打包前脚本可能下载模型。 |

必须继续通过的基线命令：

- `npm run performance:baseline`
- `npm run heavy:audit`
- `npm run source-size:audit`（同时约束 TS/JS/CSS 源文件，现有大设置样式表只通过明确临时预算放行）
- `npm run distribution:audit`
- `npm run package:dir:smoke`（真正改打包策略时必须跑）

## 重资源盘点

| 资源 | 当前来源 | 当前加载/打包方式 | 后续方向 |
|---|---|---|---|
| ONNX Runtime WASM | `public/vendor/ort/` -> `dist/assets` | 构建资产内，`performance:baseline` 预算守住 25 MB WASM 上限。 | 继续排除 asyncify/jspi/training/webgl/webgpu 变体，不把未使用 WASM 打回包内。 |
| Live2D/Pixi/Cubism vendor | `public/vendor/` | `PetView` 懒加载 `Live2DCanvas`，Live2D vendor 由 `ensureLive2DVendorScripts` 按需加载。 | 不进入默认首屏；保持 Sprite/static avatar 可以在无 Live2D 时启动。 |
| 记忆向量 Transformers | `@huggingface/transformers` | `src/features/memory/vectorSearchRuntime.ts` 动态导入。 | 仅向量召回使用时加载；不能回到 renderer 静态导入。 |
| OCR/Tesseract | `tesseract.js` | `src/features/vision/ocrWorker.ts` 动态导入。 | 只在用户启用屏幕 OCR 时加载。 |
| 浏览器 VAD | `@ricky0123/vad-web` | `src/features/hearing/browserVad.ts` 动态导入。 | 只在语音活动检测开始时加载。 |
| Sherpa 必需语音模型 | `electron/services/modelDefinitions.js` + `sherpa-models/` | `prepackage:*` 当前运行 `download-models.mjs --skip-asr`，会下载 required 模型并由 `extraResources` 纳入打包资源。 | 下一阶段评估是否从安装包改为首次运行下载；改动前必须保留离线语音不可用时的清楚降级。 |
| Sherpa 可选 ASR/TTS 模型 | `MODEL_CATALOG` 中 `required: false` | `download-models:lite` / `--skip-asr` 跳过。 | 继续保持用户选择后下载，不能进入默认打包路径。 |
| Silero VAD standalone | `public/vendor/vad/silero_vad_v5.onnx` | `extraResources` 复制为 `silero_vad_v5.onnx`，也支持运行时下载到 userData。 | 若改为全量运行时下载，需要保留旧 bundled 路径探测兼容。 |

## 启动路径边界

默认启动必须保持轻量：

- 可以加载：主进程、preload、React 入口、默认静态/Sprite 伙伴、文本模型设置、基础状态恢复。
- 不应在默认启动加载：Live2D vendor、OCR/Tesseract、Transformers、浏览器 VAD、Sherpa 可选模型、社区宠物下载、外部 provider 探测。
- 本地语音、OCR、Live2D、记忆向量和社区宠物都必须由用户动作、设置开关或明确功能入口触发。
- 如果某个重资源缺失，UI 应显示可恢复状态，而不是在启动时阻塞主窗口。

## 优化候选队列

1. **守住当前懒加载边界。** 继续让 `heavy:audit` 阻止 renderer 静态导入 `@huggingface/transformers`、`@ricky0123/vad-web`、`onnxruntime-web`、`pixi-live2d-display`、`pixi.js`、`tesseract.js`。
2. **保持可选模型不进安装包。** `prepackage:win`、`prepackage:mac`、`prepackage:linux` 必须继续使用 `download-models.mjs --skip-asr`，避免可选 Paraformer / MeloTTS 被默认打包。
3. **继续拆设置与守住设置打开速度。** `settingsDrawerEntry` 已避免污染首屏 CSS；设置 CSS 有 480 KB 预算，总 CSS 有 760 KB 预算，入口 JS 有 100 KB 预算，主 Settings UI JS chunk 有 390 KB 预算，并且这些懒加载资源必须继续存在。继续优化时优先拆掉过期设置规则、懒加载低频设置子页，或者把重面板延后到用户进入对应子页，而不是提高预算或把设置样式合回首屏。
4. **评估必需语音模型运行时下载。** 如果要进一步瘦安装包，优先把 required Sherpa 模型从 `extraResources` 迁到首次运行下载，同时保留下载进度、失败降级、离线说明和 `package:dir:smoke` 覆盖。
5. **拆分供应商资源。** 若 WASM 或 vendor 继续增长，优先拆分 ORT/Live2D/OCR 的入口，而不是提高预算。
6. **记录真实安装包体积。** 任何策略变更后，除了 `performance:baseline`，还要记录平台安装包大小和 `package:dir:smoke` 结果；`dist/assets` 不足以代表最终 installer。

## 下一步验收

- 文档层：本文件、`docs/EXECUTABLE_OPTIMIZATION_TASKS.md`、`CHANGELOG.md` 必须同步。
- 审计层：`npm run distribution:audit` 必须检查本清单存在并包含基线命令、重资源和延迟下载边界。
- 改打包策略时：必须额外跑 `npm run package:dir:smoke`，并在 PR 说明中写出 installer 体积变化、启动路径变化和用户降级体验。
