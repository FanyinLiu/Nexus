# Documentation Consistency Check

每月一次，并且每次稳定版发布前，都按这份清单回看文档是否和代码状态一致。

## 当前锚点

- 当前代码候选来自 `package.json`：v0.4.3。
- 最新公开稳定版是 v0.4.1；README 同时说明本地代码候选 v0.4.3，并把稳定入口指向 v0.4.1。
- v0.4.3 采用明确的未签名发行策略，并继续走 Beta → Validation → Stable；签名准备度不是这个版本的阻塞项。
- 官方 GitHub Releases 是唯一二进制来源；平台范围固定为 macOS arm64、Windows x64、Linux x64。
- v0.3.6 这类更早历史只作为归档 release note / changelog 节点保留。
- 更早历史放在 GitHub Releases 和 `docs/RELEASE-NOTES-v*.md`，不在 README 顶部继续滚动维护旧版本号。

## 检查范围

| 文档 | 检查重点 |
|---|---|
| `README.md` | 顶部当前代码候选必须和 `package.json` 一致，最新公开稳定入口必须指向 v0.4.1。 |
| `docs/README.zh-CN.md` / `docs/README.zh-TW.md` / `docs/README.ja.md` / `docs/README.ko.md` | 多语言顶部代码候选必须和 `package.json` 一致，稳定入口必须指向公开 v0.4.1，旧版本记录不能继续点名维护过旧版本号。 |
| `docs/ROADMAP.md` | 近期版本边界、0.4.x draft stack、0.5.0 方向必须和当前规划一致。 |
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
4. 发布前如果 package version、tag、GitHub Release、README 当前入口不一致，先修文档，不发版本。
5. Beta 文档可以说明当前处于准备/验证阶段；Stable 推进前必须把阶段性描述替换为真实发布事实，同时保留未签名平台限制。
