# 接入新的 Live2D 人物模型

项目现在已经支持“自动发现模型”，默认不需要再手动改前端常量。

## 推荐方式

把完整的 Live2D 模型目录放到：

```text
public/live2d/<你的模型目录>/
```

目录内至少需要有这些文件：

- `*.model3.json`
- `*.moc3`
- 贴图文件
- 动作文件
- 表情文件

执行 `npm run build` 之后，这些资源会被复制到 `dist/live2d/`。

应用启动时会自动扫描当前可用的 `live2d` 目录，并把发现到的模型显示在设置面板里的“人物模型”下拉框中。

## 自动发现会帮你做什么

自动发现的模型会自动补出一份基础配置：

- `id`
- `label`
- `modelPath`
- 默认 `fallbackImagePath`
- 空的动作/表情/嘴型映射

运行时还会根据 `model3.json` 尝试自动推断：

- 常见待机动作组，例如 `Idle`
- 常见交互动作组，例如 `TapBody`、`Tap`
- 表情列表顺序
- `LipSync` 组里的嘴型参数

这意味着很多模型即使没有手工微调，也能先跑起来。

## 命名与顺序约定（决定“能不能自动对上”）

自动推断**不是语义识别，靠的是约定**。模型按下面来做，开箱即用的程度最高：

- **表情按“声明顺序”映射到情绪槽**（不是按名字）。`FileReferences.Expressions` 的顺序对应：

  | 序号 | 情绪槽 |
  |---|---|
  | 0 | idle（默认 / 待机脸） |
  | 1 | listening（聆听） |
  | 2 | thinking（思考） |
  | 3 | sleepy（困倦） |
  | 4 | speaking（说话） |
  | 5 | happy（开心，同时用作 touchBody） |
  | 6 | touchFace（摸脸） |
  | 7 | touchHead（摸头） |

  顺序不对不会报错，但情绪会“错位”（会动，但表情对不上）。所以**请按这个顺序声明表情**。

- **`surprised` / `confused` / `embarrassed` 没有位置默认**：想要这三个表情，必须在 `models.ts` 的 preset 里手写 `expressionMap`（运行时会保留它们）。
- **动作组按名字模糊匹配**：待机用 `Idle` / `idle` / `Main`，交互用 `TapBody` / `Tap` / `Touch` / `Action`；都没有就用声明的第一个组。
- **命名手势不会自动填**：`wave` / `nod` / `shake` / `tilt` / `point`（聊天里的 `[motion:wave]` 之类）只有在 preset 的 `motionGroups.gestures` 里手动映射后才会动，否则静默忽略。
- **标准 Cubism 参数即可用**：`ParamAngleX/Y/Z`（头部跟随）、`LipSync` 组的嘴型参数、`EyeBlink` 组的眨眼，命名标准就自动生效；非标准参数需在 preset 里写 `rigParams` / `mouthParams`。

> 一句话：动作和基础表情能“继承”，靠的是 **标准命名 + 正确的表情顺序** 这套约定，不是逐个模型去识别。命名规整的模型基本不用改代码；要精细控制再去 `models.ts` 加 preset。

## 什么时候需要手动加预设

如果你遇到这些情况，再去手动写 preset 会更合适：

- 自动选到的动作组不对
- 表情映射顺序不理想
- 嘴型参数不是默认推断出来的那组
- 你想单独为某个角色调尺寸、锚点和位置

手动预设文件在：

[`src/features/pet/models.ts`](src/features/pet/models.ts)

你可以在 `PET_MODEL_PRESETS` 里追加一个更精细的配置。只要 `id` 和自动发现的模型一致，手写配置会优先使用。

## 选择模型

运行应用后，在设置面板里打开：

- `人物模型`

切换后的选择会保存到本地设置。

## 调试建议

如果模型被发现了，但显示效果不对，优先检查这些点：

- `*.model3.json` 路径是否正确
- `FileReferences.Motions` 里有没有你期望的动作组
- `FileReferences.Expressions` 里是不是你想要的表情
- `Groups` 里有没有 `LipSync`
- 模型是否需要额外的尺寸和锚点调整

关键入口文件：

- 模型注册与运行时推断：
  [`src/features/pet/models.ts`](src/features/pet/models.ts)
- Live2D 渲染：
  [`src/features/pet/components/Live2DCanvas.tsx`](src/features/pet/components/Live2DCanvas.tsx)
- 设置面板模型选择：
  [`src/components/SettingsDrawer.tsx`](src/components/SettingsDrawer.tsx)
- 主进程模型扫描：
  [`electron/main.js`](electron/main.js)
