#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildIpcContractReport, summarizeIpcContractReport } from './ipc-contract-audit.mjs'
import { buildReleaseTrustReport, summarizeReleaseTrustReport } from './release-trust-audit.mjs'
import { buildStorageContractReport } from './storage-contract-audit.mjs'
import { buildHeavyModuleAuditReport } from './heavy-module-audit.mjs'
import { buildCompanionBoundaryReport } from './companion-boundary-audit.mjs'
import { buildArchitectureBoundaryReport } from './architecture-boundary-audit.mjs'
import { buildSourceSizeReport } from './source-size-audit.mjs'
import { buildMessagePrivacyReport } from './message-privacy-audit.mjs'
import { buildDesktopContextPrivacyReport } from './desktop-context-privacy-audit.mjs'
import { buildVaultSecurityReport } from './vault-security-audit.mjs'
import { buildErrorRedactionReport } from './error-redaction-audit.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

const checks = []

function readText(path) {
  return readFileSync(join(ROOT, path), 'utf8')
}

function readJson(path) {
  return JSON.parse(readText(path))
}

function check(label, fn) {
  checks.push({ label, fn })
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function hasScript(pkg, name) {
  return typeof pkg.scripts?.[name] === 'string' && pkg.scripts[name].length > 0
}

const pkg = readJson('package.json')
const ciWorkflow = readText('.github/workflows/ci.yml')
const releaseWorkflow = readText('.github/workflows/release.yml')
const updaterService = readText('electron/services/updaterService.js')
const preload = readText('electron/preload.js')
const releasingDoc = readText('docs/RELEASING.md')
const readme = readText('README.md')
const roadmap = readText('docs/ROADMAP.md')
const upgradePlan = readText('docs/NEXUS_UPGRADE_INTEGRATION_PLAN.md')
const featureInventory = readText('FEATURES.md')
const documentationConsistencyDoc = readText('docs/DOCUMENTATION_CONSISTENCY.md')
const packageStartupOptimizationDoc = readText('docs/PACKAGE_STARTUP_OPTIMIZATION.md')
const localizedReadmes = {
  'docs/README.zh-CN.md': readText('docs/README.zh-CN.md'),
  'docs/README.zh-TW.md': readText('docs/README.zh-TW.md'),
  'docs/README.ja.md': readText('docs/README.ja.md'),
  'docs/README.ko.md': readText('docs/README.ko.md'),
}
const desktopShortcutInstaller = readText('scripts/install-desktop-shortcut.ps1')
const hiddenLauncher = readText('scripts/launch-nexus-hidden.vbs')
const currentVersion = `v${pkg.version}`
const readmeFiles = {
  'README.md': readme,
  ...localizedReadmes,
}

check('desktop app stays private on npm', () => {
  assert(pkg.private === true, 'package.json should remain private until a separate CLI installer exists')
})

check('developer npm scripts cover run, package and release verification', () => {
  for (const name of [
    'electron:dev',
    'doctor',
    'package:mac',
    'package:win',
    'package:linux',
    'package:dir:smoke',
    'core-path:smoke',
    'core-path:smoke:built',
    'verify:release',
    'verify:pr',
    'ipc:audit',
    'storage:audit',
    'heavy:audit',
    'architecture:audit',
    'source-size:audit',
    'performance:baseline',
    'companion-boundary:audit',
    'message-privacy:audit',
    'desktop-context-privacy:audit',
    'sqlite:smoke',
    'sqlite:smoke:electron',
    'sqlite:smoke:all',
    'release:trust:audit',
    'release:signing:readiness',
    'release:signing:gate',
    'release:signing:gate:mac',
    'release:signing:gate:windows',
    'prerelease-check',
  ]) {
    assert(hasScript(pkg, name), `missing npm script: ${name}`)
  }
})

check('desktop installers are configured for all supported platforms', () => {
  assert(pkg.build?.productName === 'Nexus', 'build.productName must be Nexus')
  assert(pkg.build?.directories?.output === 'release', 'build output should be release/')
  assert(pkg.build?.win?.target?.includes('nsis'), 'Windows NSIS target missing')
  assert(pkg.build?.mac?.target?.includes('dmg'), 'macOS dmg target missing')
  assert(pkg.build?.mac?.target?.includes('zip'), 'macOS zip target missing for updater metadata')
  assert(pkg.build?.linux?.target?.includes('AppImage'), 'Linux AppImage target missing')
  assert(pkg.build?.linux?.target?.includes('deb'), 'Linux deb target missing')
})

check('GitHub publish target is configured for electron-updater', () => {
  const publish = pkg.build?.publish?.[0]
  assert(publish?.provider === 'github', 'publish.provider must be github')
  assert(publish?.owner === 'FanyinLiu', 'publish.owner must be FanyinLiu')
  assert(publish?.repo === 'Nexus', 'publish.repo must be Nexus')
  assert(pkg.dependencies?.['electron-updater'], 'electron-updater dependency missing')
})

check('release workflow builds and uploads updater metadata', () => {
  assert(releaseWorkflow.includes("tags:\n      - 'v*.*.*'"), 'release workflow must run on version tags')
  assert(releaseWorkflow.includes('workflow_dispatch:'), 'release workflow should support manual retry of draft releases')
  for (const artifact of ['release/latest.yml', 'release/latest-mac.yml', 'release/latest-linux*.yml']) {
    assert(releaseWorkflow.includes(artifact), `release workflow missing ${artifact}`)
  }
})

check('release workflow runs the pre-release gate before packaging', () => {
  assert(releaseWorkflow.includes('preflight:'), 'release workflow missing preflight job')
  assert(releaseWorkflow.includes('npm run sqlite:smoke'), 'release workflow must run sqlite:smoke before packaging')
  assert(releaseWorkflow.includes('npm run prerelease-check --'), 'release workflow must run prerelease-check')
  assert(releaseWorkflow.includes('--skip=A --quick'), 'release workflow should use the tag-safe prerelease-check mode')
  assert(releaseWorkflow.includes('npm run release:signing:readiness'), 'release workflow should report signing readiness before packaging')
  assert(releaseWorkflow.includes('needs: [ensure-release, preflight]'), 'build job must depend on preflight')
})

check('pre-release gate docs include packaged smoke', () => {
  assert(
    releasingDoc.includes('### Stage B — Code quality (6 checks)'),
    'RELEASING should keep Stage B count aligned with prerelease-check',
  )
  assert(
    releasingDoc.includes('`npm run package:dir:smoke`'),
    'RELEASING should document the packaged smoke gate',
  )
  assert(
    releasingDoc.includes('smoke, packaged smoke, coverage, benchmarks'),
    'RELEASING should document that --quick skips packaged smoke',
  )
  assert(
    releasingDoc.includes('package an unpacked app and launch it with') ||
      releasingDoc.includes('Packaged smoke'),
    'RELEASING should explain what the packaged smoke gate validates',
  )
})

check('core path smoke is release-gated and documented', () => {
  const corePathSmoke = readText('scripts/core-path-smoke.cjs')
  assert(pkg.scripts?.['core-path:smoke']?.includes('core-path:smoke:built'), 'core-path:smoke should build then run the built smoke')
  assert(pkg.scripts?.['core-path:smoke:built'] === 'electron scripts/core-path-smoke.cjs', 'core-path:smoke:built should run the Electron smoke script')
  assert(pkg.scripts?.['verify:release']?.includes('npm run core-path:smoke:built'), 'verify:release should include core path smoke')
  assert(ciWorkflow.includes('npm run core-path:smoke:built'), 'CI should run core path smoke after build')
  assert(ciWorkflow.includes('xvfb-run -a npm run core-path:smoke:built'), 'Linux CI should run core path smoke under xvfb')
  for (const phrase of [
    "view: 'panel'",
    'settings-home-card[data-section="model"]',
    'settings-page[data-section="model"]',
    'settings-model-test-button',
    'nexus.modelSetup.dismissedUntilRestart',
  ]) {
    assert(corePathSmoke.includes(phrase), `core path smoke missing phrase: ${phrase}`)
  }
  assert(releasingDoc.includes('npm run core-path:smoke'), 'RELEASING should document the core path smoke command')
  assert(
    releasingDoc.includes('without real microphone or provider calls'),
    'RELEASING should document that core path smoke avoids microphone/provider dependencies',
  )
})

check('release workflow refuses to mutate published releases', () => {
  assert(!releaseWorkflow.includes('gh release delete'), 'release workflow must not delete published releases')
  assert(
    releaseWorkflow.includes('Published release $TAG already exists') && releaseWorkflow.includes('exit 1'),
    'release workflow should fail when a published tag already exists',
  )
})

check('Linux release artifacts have integrity path', () => {
  assert(releaseWorkflow.includes('SHA256SUMS'), 'release workflow should produce SHA256SUMS')
  assert(releaseWorkflow.includes('GPG_PRIVATE_KEY'), 'release workflow should optionally sign Linux artifacts with GPG')
})

check('auto-updater is wired through main and preload', () => {
  assert(updaterService.includes('autoUpdater.autoDownload = true'), 'auto-updater should download updates in the background')
  assert(updaterService.includes('autoUpdater.allowDowngrade = false'), 'auto-updater should block downgrades')
  assert(updaterService.includes('!app.isPackaged'), 'auto-updater should explicitly skip dev mode')
  for (const api of ['updaterCheck', 'updaterStatus', 'updaterInstall', 'subscribeUpdaterEvent']) {
    assert(preload.includes(api), `preload missing ${api}`)
  }
})

check('release trust posture is explicit and documented', () => {
  const report = buildReleaseTrustReport(ROOT)
  const summary = summarizeReleaseTrustReport(report)
  assert(summary.error === 0, `release trust audit has ${summary.error} error(s); run npm run release:trust:audit`)
})

check('IPC bridge contract baseline is inventoried', () => {
  const report = buildIpcContractReport(ROOT)
  const summary = summarizeIpcContractReport(report)
  assert(summary.errors === 0, `IPC contract audit has ${summary.errors} error(s); run npm run ipc:audit`)
  assert(summary.warnings === 0, `IPC contract audit has ${summary.warnings} warning(s); run npm run ipc:audit`)
  assert(report.counts.preloadInvokeChannels > 0, 'IPC contract audit found no preload invoke channels')
  assert(report.counts.mainHandlerChannels > 0, 'IPC contract audit found no main handler channels')
})

check('renderer localStorage keys have a migration contract', () => {
  const report = buildStorageContractReport(ROOT)
  assert(report.summary.errors === 0, `storage contract audit has ${report.summary.errors} error(s); run npm run storage:audit`)
  assert(report.discoveredKeys === report.contracts, 'storage contract count should match unique discovered browser storage keys')
})

check('heavy renderer modules stay lazy-loaded', () => {
  const report = buildHeavyModuleAuditReport(ROOT)
  assert(report.summary.errors === 0, `heavy module audit has ${report.summary.errors} error(s); run npm run heavy:audit`)
})

check('renderer architecture boundaries do not invert', () => {
  const report = buildArchitectureBoundaryReport(ROOT)
  assert(report.summary.errors === 0, `architecture boundary audit has ${report.summary.errors} error(s); run npm run architecture:audit`)
})

check('source files stay below the large-file budget', () => {
  const report = buildSourceSizeReport(ROOT)
  assert(report.summary.errors === 0, `source size audit has ${report.summary.errors} error(s); run npm run source-size:audit`)
})

check('companion boundary is documented and guarded', () => {
  const report = buildCompanionBoundaryReport(ROOT)
  assert(report.summary.errors === 0, `companion boundary audit has ${report.summary.errors} error(s); run npm run companion-boundary:audit`)
})

check('message privacy boundary is guarded', () => {
  const report = buildMessagePrivacyReport(ROOT)
  assert(report.summary.errors === 0, `message privacy audit has ${report.summary.errors} error(s); run npm run message-privacy:audit`)
  assert(report.privacy.staticSourceOnly === true, 'message privacy audit must stay source-only')
  assert(report.privacy.readsMessageContent === false, 'message privacy audit must not read user messages')
})

check('desktop context privacy boundary is guarded', () => {
  const report = buildDesktopContextPrivacyReport(ROOT)
  assert(report.summary.errors === 0, `desktop context privacy audit has ${report.summary.errors} error(s); run npm run desktop-context-privacy:audit`)
  assert(report.privacy.staticSourceOnly === true, 'desktop context privacy audit must stay source-only')
  assert(report.privacy.readsUserData === false, 'desktop context privacy audit must not read user data')
  assert(report.privacy.readsClipboard === false, 'desktop context privacy audit must not read clipboard content')
  assert(report.privacy.readsScreenshots === false, 'desktop context privacy audit must not read screenshots')
  assert(report.privacy.readsActiveWindow === false, 'desktop context privacy audit must not read active-window content')
})

check('vault secret boundary is guarded', () => {
  const report = buildVaultSecurityReport(ROOT)
  assert(report.summary.errors === 0, `vault security audit has ${report.summary.errors} error(s); run npm run vault-security:audit`)
  assert(report.privacy.staticSourceOnly === true, 'vault security audit must stay source-only')
  assert(report.privacy.readsSecrets === false, 'vault security audit must not read secret values')
  assert(report.privacy.rendererReceivesPlaintextSecrets === false, 'renderer must not receive plaintext vault secrets')
})

check('network error redaction boundary is guarded', () => {
  const report = buildErrorRedactionReport(ROOT)
  assert(report.summary.errors === 0, `error redaction audit has ${report.summary.errors} error(s); run npm run error-redaction:audit`)
  assert(report.privacy.staticSourceOnly === true, 'error redaction audit must stay source-only')
  assert(report.privacy.readsSecrets === false, 'error redaction audit must not read secret values')
})

check('source desktop shortcut launches without a terminal window', () => {
  assert(desktopShortcutInstaller.includes('launch-nexus-hidden.vbs'), 'shortcut installer should use the hidden launcher')
  assert(desktopShortcutInstaller.includes("TargetPath = 'wscript.exe'"), 'shortcut target should be wscript.exe when hidden launcher exists')
  assert(hiddenLauncher.includes('powershell.exe -NoProfile -ExecutionPolicy Bypass -File'), 'hidden launcher should call the PowerShell source launcher')
  assert(/shell\.Run\s+command,\s*0,\s*False/i.test(hiddenLauncher), 'hidden launcher should run with window style 0')
})

check('release documentation separates installers from npm developer path', () => {
  assert(/GitHub\s+Releases?/i.test(releasingDoc), 'RELEASING should describe GitHub Releases')
  assert(releasingDoc.includes('npm'), 'RELEASING should document npm as a developer path')
  assert(readme.includes('普通用户'), 'README should explain the normal user install path')
  assert(readme.includes('npm 不是普通用户的安装主路径'), 'README should state npm is not the normal user install path')
  assert(!readme.includes('@fanyin/nexus'), 'README should not mention a future npm installer package')
  assert(!releasingDoc.includes('@fanyin/nexus'), 'RELEASING should not mention a future npm installer package')
  assert(!/\bnpx\s+[@\w-]/.test(readme), 'README should not recommend npx for end-user install')
  assert(!/\bnpx\s+[@\w-]/.test(releasingDoc), 'RELEASING should not recommend npx for end-user install')
  assert(!readme.includes('nexus-desktop'), 'README should not mention the rejected nexus-desktop name')
  assert(!releasingDoc.includes('nexus-desktop'), 'RELEASING should not mention the rejected nexus-desktop name')
})

check('README known limitations are visible before developer setup', () => {
  for (const phrase of [
    '## 已知限制与适用人群',
    '仍在活跃开发',
    '未签名安装包',
    '资源占用',
    'provider 联网',
    '桌面感知',
    '暂停或清理近期陪伴摘要',
    '本地开发',
  ]) {
    assert(readme.includes(phrase), `README missing known limitation phrase: ${phrase}`)
  }

  assert(
    readme.indexOf('## 已知限制与适用人群') < readme.indexOf('## 本地开发'),
    'README known limitations should appear before developer setup',
  )
})

check('README version framing follows package version', () => {
  for (const [file, text] of Object.entries(readmeFiles)) {
    assert(text.includes(currentVersion), `${file} missing current package version ${currentVersion}`)
    assert(!text.includes('v0.2.7'), `${file} should move v0.2.7 history to release notes or GitHub Releases`)
  }

  assert(readme.includes('当前代码版本'), 'README should label the package-aligned current code version')
  assert(localizedReadmes['docs/README.zh-CN.md'].includes('当前代码版本'), 'zh-CN README should label the current code version')
  assert(localizedReadmes['docs/README.zh-TW.md'].includes('目前程式碼版本'), 'zh-TW README should label the current code version')
  assert(localizedReadmes['docs/README.ja.md'].includes('現在のコードバージョン'), 'ja README should label the current code version')
  assert(localizedReadmes['docs/README.ko.md'].includes('현재 코드 버전'), 'ko README should label the current code version')
})

check('documentation consistency workflow is documented', () => {
  for (const phrase of [
    '每月一次',
    'package.json',
    currentVersion,
    'v0.3.6',
    'README.md',
    'docs/README.zh-CN.md',
    'docs/ROADMAP.md',
    'docs/NEXUS_UPGRADE_INTEGRATION_PLAN.md',
    'FEATURES.md',
    'npm run distribution:audit',
  ]) {
    assert(documentationConsistencyDoc.includes(phrase), `documentation consistency doc missing phrase: ${phrase}`)
  }

  assert(roadmap.includes(currentVersion), 'ROADMAP should mention the current package version boundary')
  assert(upgradePlan.includes('每月一次文档回看'), 'upgrade plan should keep the monthly documentation review checkpoint')
  assert(featureInventory.includes('broad capability inventory'), 'FEATURES should keep its capability-inventory framing')
})

check('unsigned install docs cover macOS and Windows trust prompts', () => {
  const requiredByFile = {
    'README.md': [
      '未签名安装提示',
      'GitHub Releases',
      '不要从镜像',
      'Gatekeeper',
      'xattr -dr com.apple.quarantine /Applications/Nexus.app',
      '右键',
      'SmartScreen',
      '详细信息',
      '仍要运行',
    ],
    'docs/README.zh-CN.md': [
      '未签名安装提示',
      'GitHub Releases',
      '不要从镜像',
      'Gatekeeper',
      'xattr -dr com.apple.quarantine /Applications/Nexus.app',
      '右键',
      'SmartScreen',
      '详细信息',
      '仍要运行',
    ],
    'docs/README.zh-TW.md': [
      '未簽署安裝提示',
      'GitHub Releases',
      '不要從鏡像',
      'Gatekeeper',
      'xattr -dr com.apple.quarantine /Applications/Nexus.app',
      '右鍵',
      'SmartScreen',
      '其他資訊',
      '仍要執行',
    ],
    'docs/README.ja.md': [
      '未署名インストール時の注意',
      'GitHub Releases',
      'ミラー',
      'Gatekeeper',
      'xattr -dr com.apple.quarantine /Applications/Nexus.app',
      '右クリック',
      'SmartScreen',
      '詳細情報',
      '実行',
    ],
    'docs/README.ko.md': [
      '미서명 설치 안내',
      'GitHub Releases',
      '미러',
      'Gatekeeper',
      'xattr -dr com.apple.quarantine /Applications/Nexus.app',
      '우클릭',
      'SmartScreen',
      '추가 정보',
      '실행',
    ],
  }

  for (const [file, requiredPhrases] of Object.entries(requiredByFile)) {
    const text = file === 'README.md' ? readme : localizedReadmes[file]
    for (const phrase of requiredPhrases) {
      assert(text.includes(phrase), `${file} missing unsigned install phrase: ${phrase}`)
    }
  }
})

check('package size and startup optimization inventory is documented', () => {
  for (const phrase of [
    'npm run performance:baseline',
    'npm run heavy:audit',
    'npm run source-size:audit',
    'npm run distribution:audit',
    'npm run package:dir:smoke',
    'ort-wasm-simd-threaded.jsep.wasm',
    '@huggingface/transformers',
    'tesseract.js',
    'Live2D',
    'sherpa-models',
    'Silero VAD',
    'download-models.mjs --skip-asr',
    '首次运行下载',
    '可选模型不进安装包',
  ]) {
    assert(packageStartupOptimizationDoc.includes(phrase), `package startup optimization doc missing phrase: ${phrase}`)
  }

  for (const scriptName of ['prepackage:win', 'prepackage:win:signed', 'prepackage:mac', 'prepackage:linux']) {
    assert(
      pkg.scripts?.[scriptName]?.includes('download-models.mjs --skip-asr'),
      `${scriptName} should keep optional voice models out of the default package path`,
    )
  }
})

let failed = 0

console.log('Distribution audit')

for (const item of checks) {
  process.stdout.write(`- ${item.label} ... `)
  try {
    item.fn()
    console.log('OK')
  } catch (error) {
    failed += 1
    console.log('FAIL')
    console.log(`  ${error.message}`)
  }
}

if (failed > 0) {
  console.error(`\n${failed} distribution check${failed === 1 ? '' : 's'} failed.`)
  process.exit(1)
}

console.log('\nAll distribution checks passed.')
