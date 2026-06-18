#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

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
const prereleaseCheck = readText('scripts/prerelease-check.mjs')
const updaterService = readText('electron/services/updaterService.js')
const preload = readText('electron/preload.js')
const releasingDoc = readText('docs/RELEASING.md')
const readme = readText('README.md')
const desktopShortcutInstaller = readText('scripts/install-desktop-shortcut.ps1')
const hiddenLauncher = readText('scripts/launch-nexus-hidden.vbs')
const packagedSmoke = readText('scripts/packaged-smoke.mjs')

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
    'prerelease-check',
    'companion:readiness:report',
    'memory:map:report',
    'privacy:safety:report',
    'v04:readiness:status',
    'v04:completion:audit',
    'v04:release:gate',
    'm1:first-run:audit',
    'm1:first-run:record',
    'm1:first-run:status',
    'm2:distribution:trust',
    'm2:package-smoke:current',
    'm3:ipc:audit',
    'v04:message:smoke:local',
    'v04:message:bridge:trace',
    'v04:message:live:session',
    'v04:message:live:template',
    'v04:message:live:record',
    'v04:message:gate:live',
    'v04:message:status:release',
    'v04:message:merge:release',
    'v04:message:gate:release',
    'v04:message:release:redact',
    'v04:message:finalize',
  ]) {
    assert(hasScript(pkg, name), `missing npm script: ${name}`)
  }
})

check('v0.4 release evidence gate is packaged for diagnostics', () => {
  assert(
    pkg.scripts?.['v04:release:gate']?.includes('verify:release')
      && pkg.scripts?.['v04:release:gate']?.includes('v04:readiness:status')
      && pkg.scripts?.['v04:release:gate']?.includes('v04:completion:audit'),
    'v04:release:gate must chain release verification, v0.4 readiness status, and v0.4 completion audit',
  )
  assert(
    pkg.scripts?.['v04:message:live:session']?.includes('message-awareness-live-session.md'),
    'v04 message live session script should write the private-safe Markdown operator packet',
  )
  assert(pkg.build?.files?.includes('scripts/v04-readiness-status.mjs'), 'build.files missing v04 readiness status script')
  assert(pkg.build?.files?.includes('scripts/companion-readiness-report.mjs'), 'build.files missing companion readiness report script')
  assert(pkg.build?.files?.includes('scripts/memory-map-report.mjs'), 'build.files missing memory map report script')
  assert(pkg.build?.files?.includes('scripts/privacy-safety-report.mjs'), 'build.files missing privacy safety report script')
  assert(pkg.build?.files?.includes('scripts/v04-completion-audit.mjs'), 'build.files missing v04 completion audit script')
  assert(pkg.build?.files?.includes('scripts/m1-first-run-audit.mjs'), 'build.files missing m1 first-run audit script')
  assert(pkg.build?.files?.includes('scripts/m1-first-run-record.mjs'), 'build.files missing m1 first-run record script')
  assert(pkg.build?.files?.includes('scripts/m1-first-run-status.mjs'), 'build.files missing m1 first-run status script')
  assert(pkg.build?.files?.includes('scripts/m2-distribution-trust-audit.mjs'), 'build.files missing m2 distribution trust audit script')
  assert(pkg.build?.files?.includes('scripts/m3-ipc-security-audit.mjs'), 'build.files missing m3 ipc security audit script')
  assert(pkg.build?.files?.includes('scripts/v04-message-release-finalize.mjs'), 'build.files missing v04 message release finalize script')
  assert(pkg.build?.files?.includes('scripts/v04-message-bridge-trace.mjs'), 'build.files missing v04 message bridge trace script')
  assert(pkg.build?.files?.includes('scripts/v04-message-live-session.mjs'), 'build.files missing v04 message live session script')
  assert(pkg.build?.asarUnpack?.includes('scripts/v04-readiness-status.mjs'), 'asarUnpack missing v04 readiness status script')
  assert(pkg.build?.asarUnpack?.includes('scripts/companion-readiness-report.mjs'), 'asarUnpack missing companion readiness report script')
  assert(pkg.build?.asarUnpack?.includes('scripts/memory-map-report.mjs'), 'asarUnpack missing memory map report script')
  assert(pkg.build?.asarUnpack?.includes('scripts/privacy-safety-report.mjs'), 'asarUnpack missing privacy safety report script')
  assert(pkg.build?.asarUnpack?.includes('scripts/v04-completion-audit.mjs'), 'asarUnpack missing v04 completion audit script')
  assert(pkg.build?.asarUnpack?.includes('scripts/m1-first-run-audit.mjs'), 'asarUnpack missing m1 first-run audit script')
  assert(pkg.build?.asarUnpack?.includes('scripts/m1-first-run-record.mjs'), 'asarUnpack missing m1 first-run record script')
  assert(pkg.build?.asarUnpack?.includes('scripts/m1-first-run-status.mjs'), 'asarUnpack missing m1 first-run status script')
  assert(pkg.build?.asarUnpack?.includes('scripts/m2-distribution-trust-audit.mjs'), 'asarUnpack missing m2 distribution trust audit script')
  assert(pkg.build?.asarUnpack?.includes('scripts/m3-ipc-security-audit.mjs'), 'asarUnpack missing m3 ipc security audit script')
  assert(pkg.build?.asarUnpack?.includes('scripts/v04-message-release-finalize.mjs'), 'asarUnpack missing v04 message release finalize script')
  assert(pkg.build?.asarUnpack?.includes('scripts/v04-message-bridge-trace.mjs'), 'asarUnpack missing v04 message bridge trace script')
  assert(pkg.build?.asarUnpack?.includes('scripts/v04-message-live-session.mjs'), 'asarUnpack missing v04 message live session script')
  assert(!readText('scripts/v04-readiness-status.mjs').includes('../src/'), 'packaged v04 readiness script must not import unpackaged src files')
  assert(releasingDoc.includes('npm run v04:readiness:status'), 'RELEASING should document the v0.4 readiness status command')
  assert(releasingDoc.includes('npm run v04:completion:audit'), 'RELEASING should document the v0.4 completion audit command')
  assert(releasingDoc.includes('npm run v04:release:gate'), 'RELEASING should document the v0.4 release gate command')
  assert(releasingDoc.includes('npm run v04:message:status:release'), 'RELEASING should document the v0.4 message evidence status command')
  assert(releasingDoc.includes('npm run v04:message:finalize'), 'RELEASING should document the v0.4 message evidence finalize command')
  assert(releasingDoc.includes('message-awareness-live-session.md'), 'RELEASING should document the v0.4 message live session Markdown packet')
  assert(releasingDoc.includes('readiness evidence is complete'), 'RELEASING should describe the v0.4 readiness Stage F check')
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
  assert(releaseWorkflow.includes('npm run prerelease-check --'), 'release workflow must run prerelease-check')
  assert(releaseWorkflow.includes('--skip=A --quick'), 'release workflow should use the tag-safe prerelease-check mode')
  assert(releaseWorkflow.includes('needs: [ensure-release, preflight]'), 'build job must depend on preflight')
  assert(prereleaseCheck.includes('requiresV04ReadinessGate'), 'prerelease-check must route v0.4 tags through the v0.4 readiness gate')
  assert(prereleaseCheck.includes('scripts/v04-readiness-status.mjs --require-ready'), 'prerelease-check must require v0.4 readiness evidence')
  assert(prereleaseCheck.includes('scripts/v04-completion-audit.mjs --require-complete'), 'prerelease-check must require v0.4 completion evidence')
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

check('source desktop shortcut launches without a terminal window', () => {
  assert(desktopShortcutInstaller.includes('launch-nexus-hidden.vbs'), 'shortcut installer should use the hidden launcher')
  assert(desktopShortcutInstaller.includes("TargetPath = 'wscript.exe'"), 'shortcut target should be wscript.exe when hidden launcher exists')
  assert(hiddenLauncher.includes('powershell.exe -NoProfile -ExecutionPolicy Bypass -File'), 'hidden launcher should call the PowerShell source launcher')
  assert(/shell\.Run\s+command,\s*0,\s*False/i.test(hiddenLauncher), 'hidden launcher should run with window style 0')
})

check('packaged smoke can write private-safe M2 evidence', () => {
  assert(packagedSmoke.includes('PACKAGED_SMOKE_EVIDENCE_FILE'), 'packaged smoke missing M2 evidence output env')
  assert(packagedSmoke.includes('nexus-v1-m2-package-smoke'), 'packaged smoke missing M2 package smoke gate id')
  assert(packagedSmoke.includes('absolute executable path'), 'packaged smoke evidence should omit absolute executable paths')
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
