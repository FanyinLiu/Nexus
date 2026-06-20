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
const releaseWorkflow = readText('.github/workflows/release.yml')
const updaterService = readText('electron/services/updaterService.js')
const preload = readText('electron/preload.js')
const releasingDoc = readText('docs/RELEASING.md')
const readme = readText('README.md')
const desktopShortcutInstaller = readText('scripts/install-desktop-shortcut.ps1')
const hiddenLauncher = readText('scripts/launch-nexus-hidden.vbs')

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
