# Documentation Consistency Check

每月一次，并且每次稳定版发布前，都按这份清单回看文档是否和代码状态一致。

## 当前锚点

- 当前代码版本来自 `package.json`：v0.4.0。
- README 当前入口保留 v0.4.0 和上一稳定入口 v0.3.6。
- 更早历史放在 GitHub Releases 和 `docs/RELEASE-NOTES-v*.md`，不在 README 顶部继续滚动维护旧版本号。

## 检查范围

| 文档 | 检查重点 |
|---|---|
| `README.md` | 顶部当前代码版本必须和 `package.json` 一致，当前更新入口必须清楚。 |
| `docs/README.zh-CN.md` / `docs/README.zh-TW.md` / `docs/README.ja.md` / `docs/README.ko.md` | 多语言顶部版本锚点必须和 `package.json` 一致，旧版本记录不能继续点名维护过旧版本号。 |
| `docs/ROADMAP.md` | 近期版本边界、0.4.x draft stack、0.5.0 方向必须和当前规划一致。 |
| `docs/NEXUS_UPGRADE_INTEGRATION_PLAN.md` | Phase 1 / P0-P3 范围和 README 的短期边界不能冲突。 |
| `FEATURES.md` | 继续保持“能力库存”定位，不能被读成当前稳定版承诺全部交付。 |

## 执行方式

1. 运行 `npm run distribution:audit`，先让自动检查拦住 README / `package.json` 版本漂移。
2. 人工扫一遍 ROADMAP、升级计划、FEATURES 和 README 的短期边界。
3. 如果发现 README 还在主叙述里维护过旧版本号，把旧号移到 GitHub Releases 或对应 release note。
4. 发布前如果 package version、tag、GitHub Release、README 当前入口不一致，先修文档，不发版本。
