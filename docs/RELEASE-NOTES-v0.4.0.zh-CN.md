# Nexus v0.4.0 — 桌面陪伴感知地基

> **稳定版。** 这个版本开启 v0.4 的桌面陪伴感知线，先落地安静观察地基。
> 陪伴连续性路径保持隐私边界清楚，并且刻意不扩展到主动 check-in 或
> v0.5 桌宠行为。

## 用户会感受到什么

### Nexus 可以保持安静的陪伴连续性

当桌面上下文感知开启、Nexus 已打开、用户没有直接和 Nexus 聊天，而是在电脑
别处活动时，Nexus 可以保留一份短期的陪伴感知摘要。

这份摘要刻意保持很小：

- 大致活动类别
- 粗略时间桶
- 用户是否看起来在专注
- Nexus 是否应该保持安静

目标是陪伴连续性。Nexus 不应该像秒表、效率监控、屏幕记录器或自主工作
agent 一样行动。

### 摘要只属于当前应用会话

近期陪伴摘要绑定当前应用会话和当前 renderer 生命周期。如果摘要属于别的
会话、由之前的 renderer 生命周期写入、早于当前会话、超过 24 小时硬性安全
上限、看起来来自未来，或者格式校验失败，Nexus 会直接清理它。

这样可以避免之前某段桌面活动在之后被当成当前上下文重新使用。

### 设置页保持隐私边界可见

Memory 设置会说明：

- 桌面陪伴感知可以观察什么
- 本地保存什么
- 什么会进入模型
- 如何暂停陪伴感知
- 如何清理近期陪伴摘要

暂停陪伴感知、关闭上下文感知，或手动清理近期摘要，都会移除本地近期摘要。

## 隐私边界

允许：

- 脱敏后的陪伴摘要
- 大致活动类别
- 粗略时间桶
- 短期近期摘要元数据

不允许：

- 原始截图
- 完整 OCR 内容
- 完整剪贴板内容
- 私人消息正文
- 私人文件路径
- 精确计时或时间戳轨迹
- 隐藏活动日志
- 效率评分

## 不在本版本范围内

这个稳定版不包含：

- 主动 check-in 扩展
- 新的桌面感知来源
- 鼠标跟随、打字跟随或桌宠窗口控制
- 效率仪表盘或原始活动时间线
- 自动控制鼠标或键盘
- 在没有明确用户动作时读取文件、打开应用、发送消息或修改设置

## 分发说明

在 Nexus 拥有正式签名安装包和 macOS notarization 之前，手动安装仍可能遇到
系统信任提示：

- macOS 可能显示 Gatekeeper 或 quarantine 警告。如果你确认应用来自官方
  GitHub Release，只对这个下载的 app bundle 移除 quarantine。
- Windows 可能显示 SmartScreen 警告，因为安装包还没有足够的代码签名声誉。

不要从镜像站或别人重新打包的压缩包下载安装。

## 验证重点

这个稳定版按以下检查准备：

- `npm run verify:release`
- `npm run package:dir:smoke`
- `npm run desktop-context-privacy:audit`
- `npm run message-privacy:audit`
- `npm run error-redaction:audit`
- `npm run ipc:audit`
- `npm run distribution:audit`
- `npm run prerelease-check -- v0.4.0`

稳定版交接清单见
[Nexus v0.4.0 Stable Release Checklist](RELEASE-CANDIDATE-v0.4.0-STABLE.md)。
