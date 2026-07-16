import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'

import {
  buildReleaseTrustReport,
  summarizeReleaseTrustReport,
} from '../scripts/release-trust-audit.mjs'

const BASELINE_PACKAGE = {
  name: 'nexus',
  version: '0.4.0',
  description: 'Nexus desktop AI companion.',
  private: true,
  scripts: {
    'release:unsigned:gate': 'node scripts/release-trust-audit.mjs --require-unsigned all',
    'prepackage:mac': 'node scripts/mac-release-preflight.mjs',
    'package:win': 'CSC_IDENTITY_AUTO_DISCOVERY=false electron-builder --win nsis --config.forceCodeSigning=false --config.win.signAndEditExecutable=true',
    'package:win:signed': 'electron-builder --win nsis --config.forceCodeSigning=true --config.win.signAndEditExecutable=true',
  },
  dependencies: {
    'electron-updater': '^6.8.3',
  },
  build: {
    appId: 'ai.factory.desktoppet',
    productName: 'Nexus',
    forceCodeSigning: false,
    publish: [
      {
        provider: 'github',
        owner: 'FanyinLiu',
        repo: 'Nexus',
      },
    ],
    mac: {
      target: ['dmg', 'zip'],
      identity: '-',
      hardenedRuntime: false,
      gatekeeperAssess: false,
      notarize: false,
      extraResources: [{ from: 'models', to: 'models' }],
    },
    win: {
      target: ['nsis'],
      icon: 'public/nexus.ico',
      signAndEditExecutable: true,
      requestedExecutionLevel: 'asInvoker',
      extraResources: [{ from: 'models', to: 'models' }],
    },
    electronFuses: {
      onlyLoadAppFromAsar: true,
      enableEmbeddedAsarIntegrityValidation: true,
    },
  },
}

const BASELINE_RELEASE_WORKFLOW = `
jobs:
  release:
    steps:
      - name: Validate release tag matches package version
        run: |
          PACKAGE_VERSION=$(node -p "require('./package.json').version")
          test "$TAG" = "v$PACKAGE_VERSION"
      - run: npm run release:trust:audit
      - run: npm run release:unsigned:gate
      - run: configure release
        env:
          CSC_IDENTITY_AUTO_DISCOVERY: 'false'
      - run: CSC_IDENTITY_AUTO_DISCOVERY=false electron-builder --mac --config.forceCodeSigning=false --config.mac.identity=-
      - run: electron-builder --win nsis --x64 --config.forceCodeSigning=false --config.win.signAndEditExecutable=true
      - run: node scripts/verify-windows-release.mjs --expect-unsigned
      - run: upload SHA256SUMS-windows.txt
      - run: upload SHA256SUMS-macos.txt
      - run: upload SHA256SUMS-linux.txt
`

const BASELINE_RELEASING_DOC = `
# Releasing

Run npm run release:trust:audit before release.

## macOS unsigned auto-update limitation

Current unsigned macOS builds use manual update downloads.

Future signing requires APPLE_API_KEY, APPLE_API_KEY_ID, APPLE_API_ISSUER, CSC_LINK, and CSC_KEY_PASSWORD.
Signed macOS verification will use spctl -a -vv and must document the unsigned to signed transition.

## Windows unsigned installer limitation

Current Windows builds are unsigned and must explain SmartScreen behavior.
Windows code-signing path is selected before signed Windows release.
`

const BASELINE_FILES: Record<string, string> = {
  'package.json': `${JSON.stringify(BASELINE_PACKAGE, null, 2)}\n`,
  '.github/workflows/release.yml': BASELINE_RELEASE_WORKFLOW,
  'docs/RELEASING.md': BASELINE_RELEASING_DOC,
  'docs/UPDATER_SURVEY.md': '# Updater survey\n',
  'docs/APPLE_SIGNING_CHECKLIST.md': '# Apple signing checklist\n',
  'electron/services/updaterService.js': `
// check-only release downloads
autoUpdater.autoDownload = true
autoUpdater.allowDowngrade = false
if (!app.isPackaged) {
  throw new Error('skip updater in dev')
}

function openReleasePage(shell) {
  return shell.openExternal('https://github.com/FanyinLiu/Nexus/releases/latest')
}
`,
  'electron/services/updatePolicy.js': `
export const mode = 'manual-download'
export const envName = 'NEXUS_MAC_AUTO_UPDATE_MODE'
`,
  'README.md': `
# Nexus

macOS users on unsigned builds use manual downloads for updates.
`,
}

function createReleaseTrustFixture(overrides: Record<string, string> = {}) {
  const root = mkdtempSync(join(tmpdir(), 'nexus-release-trust-audit-'))
  const files = { ...BASELINE_FILES, ...overrides }

  for (const [relativePath, source] of Object.entries(files)) {
    const absolutePath = join(root, relativePath)
    mkdirSync(dirname(absolutePath), { recursive: true })
    writeFileSync(absolutePath, source)
  }

  return root
}

function withReleaseTrustFixture<T>(
  overrides: Record<string, string>,
  callback: (root: string) => T,
): T {
  const root = createReleaseTrustFixture(overrides)
  try {
    return callback(root)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

function findCheck(report: ReturnType<typeof buildReleaseTrustReport>, id: string) {
  return report.checks.find((check) => check.id === id)
}

test('release trust audit accepts the documented unsigned baseline without errors', () => {
  withReleaseTrustFixture({}, (root) => {
    const report = buildReleaseTrustReport(root)
    const summary = summarizeReleaseTrustReport(report)

    assert.equal(summary.error, 0)
    assert.equal(report.updateChannel.provider, 'github')
    assert.equal(report.platforms.mac.signing.posture, 'unsigned-explicit')
    assert.equal(report.platforms.windows.signing.posture, 'unsigned-explicit')
    assert.equal(findCheck(report, 'mac.signing')?.status, 'warning')
    assert.equal(findCheck(report, 'windows.signing')?.status, 'warning')
    assert.equal(findCheck(report, 'mac.unsigned-runtime')?.status, 'ok')
    assert.equal(findCheck(report, 'linux.integrity')?.status, 'ok')
    assert.equal(findCheck(report, 'docs.trust-posture')?.status, 'ok')
  })
})

test('release trust audit rejects unsigned macOS builds without manual-update runtime fallback', () => {
  withReleaseTrustFixture({
    'electron/services/updaterService.js': `
export function installUpdate(autoUpdater) {
  return autoUpdater.quitAndInstall()
}
`,
  }, (root) => {
    const report = buildReleaseTrustReport(root)
    const summary = summarizeReleaseTrustReport(report)

    assert.ok(summary.error > 0)
    assert.equal(findCheck(report, 'mac.unsigned-runtime')?.status, 'error')
  })
})

test('release trust audit rejects release workflows without all platform integrity metadata', () => {
  withReleaseTrustFixture({
    '.github/workflows/release.yml': BASELINE_RELEASE_WORKFLOW
      .replace('      - run: upload SHA256SUMS-macos.txt\n', ''),
  }, (root) => {
    const report = buildReleaseTrustReport(root)
    const summary = summarizeReleaseTrustReport(report)

    assert.ok(summary.error > 0)
    assert.equal(findCheck(report, 'linux.integrity')?.status, 'error')
  })
})

test('release trust unsigned gate rejects ambiguous signing and smoke identity', () => {
  const invalidPackage = structuredClone(BASELINE_PACKAGE)
  invalidPackage.build.productName = 'Nexus Smoke'
  invalidPackage.build.mac.identity = 'Developer ID Application'
  invalidPackage.build.win.signAndEditExecutable = false
  invalidPackage.build.win.requestedExecutionLevel = 'requireAdministrator'

  withReleaseTrustFixture({
    'package.json': `${JSON.stringify(invalidPackage, null, 2)}\n`,
  }, (root) => {
    const report = buildReleaseTrustReport(root, { requireUnsigned: 'all' })
    const summary = summarizeReleaseTrustReport(report)

    assert.ok(summary.error >= 3)
    assert.equal(findCheck(report, 'release.formal-identity')?.status, 'error')
    assert.equal(findCheck(report, 'mac.unsigned-gate')?.status, 'error')
    assert.equal(findCheck(report, 'windows.unsigned-gate')?.status, 'error')
  })
})

test('release trust signed gate reports fixture blockers without serializing secret values', () => {
  withReleaseTrustFixture({}, (root) => {
    const report = buildReleaseTrustReport(root, { requireSigned: 'all' })
    const summary = summarizeReleaseTrustReport(report)
    const reportText = JSON.stringify(report)

    assert.ok(summary.error >= 2)
    assert.equal(findCheck(report, 'mac.signed-readiness')?.status, 'error')
    assert.equal(findCheck(report, 'windows.signed-readiness')?.status, 'error')
    assert.match(reportText, /APPLE_API_KEY_ID/)
    assert.match(reportText, /WINDOWS_SIGNING_CLIENT_SECRET/)
    assert.doesNotMatch(reportText, /sk-[A-Za-z0-9]/)
    assert.doesNotMatch(reportText, /-----BEGIN PRIVATE KEY-----/)
  })
})
