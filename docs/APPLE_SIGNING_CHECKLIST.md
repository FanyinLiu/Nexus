# Apple 签名 30 分钟接线清单（买完 $99 后照做）

> 背景与论证见 docs/UPDATER_SURVEY.md。结论：mac 自动更新唯一的硬前提是 Developer ID 签名
> （Squirrel.Mac 框架内校验，不可绕过）；签好后现有 electron-updater 链路立即真正可用，无需改代码。

## 0. 购买（只有 Klein 能做）
- https://developer.apple.com/programs/enroll/ — 个人户，$99/年，双因素 Apple ID + 本人信用卡 + 法定真名，当天可用

## 1. 证书与 API Key（一次性，~15 分钟）
1. developer.apple.com → Certificates → 新建 **Developer ID Application** 证书（用本机钥匙串生成 CSR）
2. appstoreconnect.apple.com → Users and Access → Integrations → App Store Connect API → 新建 Key（Developer 权限）
   - 记下 **Key ID**、**Issuer ID**，下载 `.p8` 私钥文件（只能下载一次）

## 2. 仓库配置（~10 分钟）
1. GitHub repo → Settings → Secrets and variables → Actions，新增：
   - `APPLE_API_KEY`（.p8 文件内容）
   - `APPLE_API_KEY_ID`
   - `APPLE_API_ISSUER`
   - `CSC_LINK` + `CSC_KEY_PASSWORD`（Developer ID 证书导出的 .p12 + 密码）
2. `package.json` build.mac：
   - 删 `"gatekeeperAssess": false`
   - `"hardenedRuntime": true`
   - `"notarize": true`
3. `.github/workflows/release.yml` mac job：
   - 删 `CSC_IDENTITY_AUTO_DISCOVERY: false`
   - env 注入上面 5 个 secrets
4. entitlements（`build/entitlements.mac.plist`）按 hardened runtime 复核（现有文件为 ad-hoc 写的，可能需去掉
   `disable-library-validation` 试打包；sherpa/sharp 原生模块若加载失败再加回并记录原因）

## 3. 验证（一个 beta 周期）
1. 出一个 beta tag → CI 构建 → `spctl -a -vv Nexus.app` 验证签名 + 公证
2. 装上一版（未签名）→ 升级到签名版：注意**换签名身份会断一次自动更新**——这次（无→有）用户需手动下载一次，
   release notes 里写明；之后的版本自动更新恢复正常
3. README/发版说明删掉 xattr/右键打开的 workaround 段落

## 4. 顺带收益
- Homebrew cask 资格（2026-09 起未签名 app 被禁）
- electron-updater ≥6.3 的 mac 差量更新自动生效
- 「屏幕录制/麦克风权限不出现在系统设置」的老问题随签名消失
