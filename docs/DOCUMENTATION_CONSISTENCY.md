# Documentation Consistency Check

每月一次，并且每次稳定版发布前，都按这份清单回看文档是否和代码状态一致。

## 当前锚点

- 当前公开稳定版是 v0.5.0；README 把稳定入口指向 v0.5.0，上一公开版本为 v0.4.8。`v0.5.0` 于 2026-11-05 经版本范围维护者例外直接晋升，豁免 beta 窗口；不声称多日对话证据或跨平台真机验收。下一次 beta 可以是 `0.5.1-beta.N`，但 README 稳定入口不得提前移动。
- 本版已发布：小本子、提醒要点、提醒小条、鼠标靠近看一眼、打字时保持安静、离开计数、每日记录文案。声纹唤醒留给 0.6，摄像头留给 0.7。签名安装包不在本版。Minecraft / Factorio 仍然隐藏。
- v0.4.8 走标准 beta 流程晋升（2026-10-29）：视线跟随与打字感知、三种外观、面板消息卡片、按需启动的本地语音服务、记忆 v2 与未完成约定、五个简单设置页，以及 2026 年 10 月模型目录。`v0.4.8-beta.1` 于 2026-10-15 预发布；计划中的 `0.4.8-beta.2` 已取消。发布记录见 `RELEASING.md`。
- v0.4.7 经维护者例外直接晋升为稳定版（2026-08-27）：形象兼容诊断、分层立绘 v4、Grok 语音与 Qwen 3.8-max / GLM-5.3 目录默认。例外记录见 `RELEASING.md`。`v0.4.7-beta.1` 的 2026-08-10 准备记录只作历史，不描述本棵树。
- v0.4.6 走标准 beta 流程晋升（v0.4.6-beta.1 于 2026-08-10 预发布，验证窗口关闭后于 2026-08-21 稳定）：形象运行时可靠性切片。
- v0.4.5 走标准 beta 流程晋升（v0.4.5-beta.1 于 2026-08-03 预发布，验证窗口 2026-08-03 → 2026-08-06，无维护者例外）：记忆可信度切片（矛盾检测、迁移默认开）+ presence 管道 + 维护加固。
- v0.5.0 采用明确的未签名发行策略，签名准备度不是这个版本的阻塞项；v0.4.4 / v0.4.7 / v0.5.0 的维护者例外仅属对应版本，不影响后续默认流程。2026-11-06 音梵额外允许 v0.5.0 在缺少 `NEXUS_UPDATE_SIGNING_KEY` 时使用 `unsigned-manual` 更新通道：Windows/Linux 不发布 `latest*.yml` 及 `.sig`，因此本版没有自动更新，需手动从 GitHub Releases 下载；installers 与各平台 `SHA256SUMS` 照常发布，tag、preflight、prerelease-check、校验和与远端闭合门禁不得跳过。该例外仅限 v0.5.0，后续版本须恢复签名清单或另记版本范围例外。
- 官方 GitHub Releases 是唯一二进制来源；平台范围固定为 macOS arm64、Windows x64、Linux x64。
- v0.3.6 这类更早历史只作为归档 release note / changelog 节点保留。
- 更早历史放在 GitHub Releases 和 `docs/RELEASE-NOTES-v*.md`，不在 README 顶部继续滚动维护旧版本号。

## 检查范围

| 文档 | 检查重点 |
|---|---|
| `README.md` | 顶部稳定入口必须指向公开 v0.5.0；beta package 只增加候选提示，不得冒充稳定版。 |
| `docs/README.zh-CN.md` / `docs/README.zh-TW.md` / `docs/README.ja.md` / `docs/README.ko.md` | 多语言稳定入口必须指向公开 v0.5.0；beta 候选提示需保持同一版本和非稳定语义。 |
| `docs/ROADMAP.md` | 近期版本边界、0.4.x 历史、已发布的 v0.5.0 范围必须和当前发行说明一致。 |
| `docs/NEXUS_UPGRADE_INTEGRATION_PLAN.md` | Phase 1 / P0-P3 范围和 README 的短期边界不能冲突。 |
| `FEATURES.md` | 继续保持“能力库存”定位，不能被读成当前稳定版承诺全部交付。 |

## 未签名发行语义

以下两个英文标题必须同时出现在主 README、发布说明和发布流程中，方便自动审计跨语言文档：

- `macOS unsigned auto-update limitation`：macOS 仅 arm64；ad-hoc 不等于 Apple Developer ID 信任或公证；Gatekeeper 提示可预期；更新只打开官方 release 页面并由用户手动下载替换。
- `Windows unsigned installer limitation`：Windows 仅 x64；安装器为 `NotSigned`；SmartScreen 提示可预期；绕过提示不是安全背书。

Linux x64 资产必须在同一官方 GitHub Release 附带 `SHA256SUMS`。任何文档出现 macOS x64 / universal、把 ad-hoc 写成 Apple 信任、把 SmartScreen 绕过写成安全保证，或把镜像写成下载来源，都视为一致性失败。

## 执行方式

1. 运行 `npm run distribution:audit`，先让自动检查拦住 README / `package.json` 版本漂移。
2. 人工扫一遍 ROADMAP、升级计划、FEATURES 和 README 的短期边界。
3. 如果发现 README 还在主叙述里维护过旧版本号，把旧号移到 GitHub Releases 或对应 release note。
4. Beta 准备阶段允许 package 指向候选、README 稳定入口停在上一稳定版；稳定晋升前 package version、tag、GitHub Release 与 README 稳定入口必须一致，否则不发版本。
5. Beta 文档可以说明当前处于准备/验证阶段；Stable 推进前必须把阶段性描述替换为真实发布事实，同时保留未签名平台限制。
