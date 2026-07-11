#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const DEFAULT_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const MAC_SIGNING_SECRET_NAMES = [
  'APPLE_API_KEY',
  'APPLE_API_KEY_ID',
  'APPLE_API_ISSUER',
  'CSC_LINK',
  'CSC_KEY_PASSWORD',
]
const WINDOWS_CERT_SIGNING_SECRET_NAMES = [
  'WINDOWS_CSC_LINK',
  'WINDOWS_CSC_KEY_PASSWORD',
]
const WINDOWS_CLOUD_SIGNING_SECRET_NAMES = [
  'WINDOWS_SIGNING_TENANT_ID',
  'WINDOWS_SIGNING_CLIENT_ID',
  'WINDOWS_SIGNING_CLIENT_SECRET',
  'WINDOWS_SIGNING_ACCOUNT',
  'WINDOWS_SIGNING_CERTIFICATE_PROFILE',
]

function readText(root, path) {
  return readFileSync(join(root, path), 'utf8')
}

function readJson(root, path) {
  return JSON.parse(readText(root, path))
}

function hasScript(pkg, name) {
  return typeof pkg.scripts?.[name] === 'string' && pkg.scripts[name].length > 0
}

function addCheck(checks, id, label, status, detail) {
  checks.push({ id, label, status, detail })
}

function allPresent(text, values) {
  return values.every((value) => text.includes(value))
}

function classifyMacSigning(pkg, releaseWorkflow, releasingDoc) {
  const mac = pkg.build?.mac ?? {}
  const macPackagePreflight = pkg.scripts?.['prepackage:mac'] ?? ''
  const targets = Array.isArray(mac.target) ? mac.target : []
  const explicitUnsigned =
    mac.hardenedRuntime === false &&
    mac.gatekeeperAssess === false &&
    !mac.notarize &&
    releaseWorkflow.includes('CSC_IDENTITY_AUTO_DISCOVERY') &&
    releaseWorkflow.includes('false')
  const signedReady =
    mac.hardenedRuntime === true &&
    mac.notarize === true &&
    !releaseWorkflow.includes('CSC_IDENTITY_AUTO_DISCOVERY: false') &&
    allPresent(releaseWorkflow, [
      'APPLE_API_KEY',
      'APPLE_API_KEY_ID',
      'APPLE_API_ISSUER',
      'CSC_LINK',
      'CSC_KEY_PASSWORD',
    ]) && macPackagePreflight.includes('mac-release-preflight')
  const docsCurrentUnsigned =
    /macOS unsigned auto-update limitation/i.test(releasingDoc) &&
    /manual update downloads/i.test(releasingDoc)
  const docsSigningPrereqs =
    allPresent(releasingDoc, [
      'APPLE_API_KEY',
      'APPLE_API_KEY_ID',
      'APPLE_API_ISSUER',
      'CSC_LINK',
      'CSC_KEY_PASSWORD',
    ])

  return {
    targets,
    posture: signedReady ? 'signed-ready' : explicitUnsigned ? 'unsigned-explicit' : 'ambiguous',
    hardenedRuntime: mac.hardenedRuntime ?? null,
    gatekeeperAssess: mac.gatekeeperAssess ?? null,
    notarize: mac.notarize ?? null,
    workflowDisablesAutoDiscovery: releaseWorkflow.includes('CSC_IDENTITY_AUTO_DISCOVERY'),
    docsCurrentUnsigned,
    docsSigningPrereqs,
  }
}

function classifyWindowsSigning(pkg, releaseWorkflow, releasingDoc) {
  const targets = Array.isArray(pkg.build?.win?.target) ? pkg.build.win.target : []
  const ciDisablesSigning = releaseWorkflow.includes('--config.win.signAndEditExecutable=false')
  const hasSignedScript = hasScript(pkg, 'package:win:signed')
  const docsCurrentUnsigned =
    /Windows unsigned installer limitation/i.test(releasingDoc) &&
    /SmartScreen/i.test(releasingDoc)
  const signedReady = !ciDisablesSigning && /WINDOWS_|AZURE_|TRUSTED_SIGNING|CSC_LINK/i.test(releaseWorkflow)

  return {
    targets,
    posture: signedReady ? 'signed-ready' : ciDisablesSigning ? 'unsigned-explicit' : 'ambiguous',
    ciDisablesSigning,
    hasSignedScript,
    docsCurrentUnsigned,
  }
}

function classifyLinuxIntegrity(releaseWorkflow) {
  return {
    sha256Sums: releaseWorkflow.includes('SHA256SUMS'),
    optionalGpg:
      releaseWorkflow.includes('GPG_PRIVATE_KEY') &&
      releaseWorkflow.includes('GPG_PASSPHRASE') &&
      releaseWorkflow.includes('--detach-sign'),
  }
}

function buildMacSignedReadiness(pkg, releaseWorkflow, releasingDoc) {
  const mac = pkg.build?.mac ?? {}
  const macPackagePreflight = pkg.scripts?.['prepackage:mac'] ?? ''
  const blockers = []

  if (mac.hardenedRuntime !== true) {
    blockers.push('package.json build.mac.hardenedRuntime must be true')
  }
  if (mac.notarize !== true) {
    blockers.push('package.json build.mac.notarize must be true')
  }
  if (mac.gatekeeperAssess === false) {
    blockers.push('package.json build.mac.gatekeeperAssess must not be false for signed release verification')
  }
  if (releaseWorkflow.includes('CSC_IDENTITY_AUTO_DISCOVERY') && releaseWorkflow.includes('false')) {
    blockers.push('release workflow must stop forcing CSC_IDENTITY_AUTO_DISCOVERY=false for the macOS job')
  }
  if (!macPackagePreflight.includes('mac-release-preflight')) {
    blockers.push('package.json prepackage:mac must run scripts/mac-release-preflight.mjs')
  }
  for (const secretName of MAC_SIGNING_SECRET_NAMES) {
    if (!releaseWorkflow.includes(`secrets.${secretName}`)) {
      blockers.push(`release workflow must wire secrets.${secretName} into the macOS package step`)
    }
  }
  if (!releaseWorkflow.includes('NEXUS_MAC_AUTO_UPDATE_MODE') || !releaseWorkflow.includes('electron-updater')) {
    blockers.push('release workflow must set NEXUS_MAC_AUTO_UPDATE_MODE=electron-updater only for the signed macOS job')
  }
  if (!/spctl\s+-a\s+-vv/i.test(releasingDoc)) {
    blockers.push('RELEASING must require spctl -a -vv verification for signed macOS artifacts')
  }
  if (!/unsigned\s+to\s+signed|unsigned-to-signed|未签名.*签名/i.test(releasingDoc)) {
    blockers.push('RELEASING must document the unsigned to signed transition and manual-download recovery')
  }

  return {
    ready: blockers.length === 0,
    blockers,
    requiredSecrets: [...MAC_SIGNING_SECRET_NAMES],
  }
}

function hasCompleteSecretGroup(releaseWorkflow, secretNames) {
  return secretNames.every((secretName) => releaseWorkflow.includes(`secrets.${secretName}`))
}

function buildWindowsSignedReadiness(pkg, releaseWorkflow, releasingDoc) {
  const blockers = []
  const supportsCertificateFile = hasCompleteSecretGroup(releaseWorkflow, WINDOWS_CERT_SIGNING_SECRET_NAMES)
  const supportsCloudSigning = hasCompleteSecretGroup(releaseWorkflow, WINDOWS_CLOUD_SIGNING_SECRET_NAMES)

  if (!hasScript(pkg, 'package:win:signed')) {
    blockers.push('package.json must keep package:win:signed for signed Windows packaging')
  }
  if (releaseWorkflow.includes('--config.win.signAndEditExecutable=false')) {
    blockers.push('release workflow must stop passing --config.win.signAndEditExecutable=false for the Windows job')
  }
  if (!supportsCertificateFile && !supportsCloudSigning) {
    blockers.push('release workflow must wire one Windows signing secret group: WINDOWS_CSC_LINK/WINDOWS_CSC_KEY_PASSWORD or WINDOWS_SIGNING_* cloud signing secrets')
  }
  if (!/Windows code-signing path is selected/i.test(releasingDoc)) {
    blockers.push('RELEASING must require a selected Windows code-signing path')
  }
  if (!/SmartScreen/i.test(releasingDoc)) {
    blockers.push('RELEASING must require SmartScreen verification for signed Windows artifacts')
  }

  return {
    ready: blockers.length === 0,
    blockers,
    acceptedSecretGroups: {
      certificateFile: [...WINDOWS_CERT_SIGNING_SECRET_NAMES],
      cloudSigning: [...WINDOWS_CLOUD_SIGNING_SECRET_NAMES],
    },
    supportedByWorkflow: {
      certificateFile: supportsCertificateFile,
      cloudSigning: supportsCloudSigning,
    },
  }
}

export function summarizeReleaseTrustReport(report) {
  return report.checks.reduce(
    (summary, check) => {
      summary[check.status] += 1
      return summary
    },
    { ok: 0, warning: 0, error: 0 },
  )
}

function normalizeRequiredSignedProfile(value) {
  return value === 'mac' || value === 'windows' || value === 'all' ? value : null
}

export function buildReleaseTrustReport(root = DEFAULT_ROOT, options = {}) {
  const requiredSignedProfile = normalizeRequiredSignedProfile(options.requireSigned)
  const includeSigningReadiness = options.includeSigningReadiness === true || requiredSignedProfile !== null
  const pkg = readJson(root, 'package.json')
  const releaseWorkflow = readText(root, '.github/workflows/release.yml')
  const releasingDoc = readText(root, 'docs/RELEASING.md')
  const updaterService = readText(root, 'electron/services/updaterService.js')
  const updatePolicy = readText(root, 'electron/services/updatePolicy.js')
  const readme = readText(root, 'README.md')
  const checks = []

  const mac = classifyMacSigning(pkg, releaseWorkflow, releasingDoc)
  const windows = classifyWindowsSigning(pkg, releaseWorkflow, releasingDoc)
  const linux = classifyLinuxIntegrity(releaseWorkflow)
  const macSignedReadiness = buildMacSignedReadiness(pkg, releaseWorkflow, releasingDoc)
  const windowsSignedReadiness = buildWindowsSignedReadiness(pkg, releaseWorkflow, releasingDoc)

  const publish = pkg.build?.publish?.[0] ?? {}
  const githubPublish =
    publish.provider === 'github' &&
    publish.owner === 'FanyinLiu' &&
    publish.repo === 'Nexus' &&
    Boolean(pkg.dependencies?.['electron-updater'])
  addCheck(
    checks,
    'release.github-updater',
    'GitHub Releases remain the updater channel',
    githubPublish ? 'ok' : 'error',
    githubPublish
      ? 'publish config and electron-updater dependency are present'
      : 'package publish config or electron-updater dependency is missing',
  )

  const updaterRuntime =
    updaterService.includes('autoUpdater.autoDownload = true') &&
    updaterService.includes('autoUpdater.allowDowngrade = false') &&
    updaterService.includes('!app.isPackaged')
  addCheck(
    checks,
    'release.updater-runtime',
    'Updater runtime keeps safe defaults',
    updaterRuntime ? 'ok' : 'error',
    updaterRuntime
      ? 'background download, downgrade block, and dev-mode skip are wired'
      : 'updater runtime lost a required safety default',
  )

  const macTargets = mac.targets.includes('dmg') && mac.targets.includes('zip')
  addCheck(
    checks,
    'mac.targets',
    'macOS release includes install and update metadata artifacts',
    macTargets ? 'ok' : 'error',
    macTargets ? 'dmg and zip targets are present' : 'macOS dmg and zip targets are both required',
  )

  if (mac.posture === 'signed-ready') {
    addCheck(checks, 'mac.signing', 'macOS signing posture is ready', 'ok', 'hardened runtime, notarization, and signing secrets are wired')
  } else if (mac.posture === 'unsigned-explicit' && mac.docsCurrentUnsigned && mac.docsSigningPrereqs) {
    addCheck(
      checks,
      'mac.signing',
      'macOS unsigned posture is explicit and documented',
      'warning',
      'current builds are unsigned; docs require manual update downloads until Developer ID signing is enabled',
    )
  } else {
    addCheck(
      checks,
      'mac.signing',
      'macOS signing posture is explicit and documented',
      'error',
      'macOS config is neither signed-ready nor documented as explicit unsigned distribution',
    )
  }

  const macUnsignedRuntimeFallback =
    updatePolicy.includes('manual-download') &&
    updatePolicy.includes('NEXUS_MAC_AUTO_UPDATE_MODE') &&
    updaterService.includes('check-only release downloads') &&
    updaterService.includes('openExternal')
  addCheck(
    checks,
    'mac.unsigned-runtime',
    'macOS unsigned runtime uses manual update downloads',
    mac.posture === 'unsigned-explicit'
      ? (macUnsignedRuntimeFallback ? 'ok' : 'error')
      : 'ok',
    mac.posture === 'unsigned-explicit'
      ? (macUnsignedRuntimeFallback
          ? 'unsigned macOS builds check GitHub Releases and open the release page instead of auto-installing'
          : 'unsigned macOS builds must not use the full auto-install updater path')
      : 'signed-ready macOS builds may use the full auto-install updater path',
  )

  if (includeSigningReadiness) {
    const requireMacSigned = requiredSignedProfile === 'mac' || requiredSignedProfile === 'all'
    const status = macSignedReadiness.ready ? 'ok' : requireMacSigned ? 'error' : 'warning'
    addCheck(
      checks,
      'mac.signed-readiness',
      'macOS signed release readiness profile',
      status,
      macSignedReadiness.ready
        ? 'macOS signing, notarization, CI secrets, and signed updater mode are wired'
        : `not ready: ${macSignedReadiness.blockers.join('; ')}`,
    )
  }

  const windowsTargets = windows.targets.includes('nsis')
  addCheck(
    checks,
    'windows.targets',
    'Windows release uses NSIS installer',
    windowsTargets ? 'ok' : 'error',
    windowsTargets ? 'NSIS target is present' : 'Windows NSIS target is missing',
  )

  if (windows.posture === 'signed-ready') {
    addCheck(checks, 'windows.signing', 'Windows signing posture is ready', 'ok', 'CI no longer disables executable signing')
  } else if (windows.posture === 'unsigned-explicit' && windows.hasSignedScript && windows.docsCurrentUnsigned) {
    addCheck(
      checks,
      'windows.signing',
      'Windows unsigned posture is explicit and documented',
      'warning',
      'current CI disables executable signing; signed package script and SmartScreen docs remain present',
    )
  } else {
    addCheck(
      checks,
      'windows.signing',
      'Windows signing posture is explicit and documented',
      'error',
      'Windows config is neither signed-ready nor documented as explicit unsigned distribution',
    )
  }

  if (includeSigningReadiness) {
    const requireWindowsSigned = requiredSignedProfile === 'windows' || requiredSignedProfile === 'all'
    const status = windowsSignedReadiness.ready ? 'ok' : requireWindowsSigned ? 'error' : 'warning'
    addCheck(
      checks,
      'windows.signed-readiness',
      'Windows signed release readiness profile',
      status,
      windowsSignedReadiness.ready
        ? 'Windows signing provider, CI secrets, and signed installer verification are wired'
        : `not ready: ${windowsSignedReadiness.blockers.join('; ')}`,
    )
  }

  addCheck(
    checks,
    'linux.integrity',
    'Linux release artifacts have integrity metadata',
    linux.sha256Sums && linux.optionalGpg ? 'ok' : 'error',
    linux.sha256Sums && linux.optionalGpg
      ? 'SHA256SUMS and optional GPG detached signatures are wired'
      : 'Linux SHA256SUMS or optional GPG signing path is missing',
  )

  const docsExist =
    existsSync(join(root, 'docs/UPDATER_SURVEY.md')) &&
    existsSync(join(root, 'docs/APPLE_SIGNING_CHECKLIST.md')) &&
    /release:trust:audit/.test(releasingDoc) &&
    /macOS[\s\S]*(manual|手动)/i.test(readme)
  addCheck(
    checks,
    'docs.trust-posture',
    'Release trust docs describe current and future paths',
    docsExist ? 'ok' : 'error',
    docsExist
      ? 'RELEASING, README, updater survey, and Apple signing checklist are present'
      : 'release trust documentation is incomplete',
  )

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    repoRoot: root,
    package: {
      name: pkg.name,
      version: pkg.version,
      private: pkg.private === true,
    },
    updateChannel: {
      provider: publish.provider ?? null,
      owner: publish.owner ?? null,
      repo: publish.repo ?? null,
      dependency: pkg.dependencies?.['electron-updater'] ?? null,
    },
    platforms: {
      mac: {
        signing: mac,
        signedReadiness: macSignedReadiness,
      },
      windows: {
        signing: windows,
        signedReadiness: windowsSignedReadiness,
      },
      linux: {
        integrity: linux,
      },
    },
    privacy: {
      readsEnvironment: false,
      readsKeychain: false,
      readsUserData: false,
      serializesSecretValues: false,
      secretNamesOnly: [
        'APPLE_API_KEY',
        'APPLE_API_KEY_ID',
        'APPLE_API_ISSUER',
        'CSC_LINK',
        'CSC_KEY_PASSWORD',
        'WINDOWS_CSC_LINK',
        'WINDOWS_CSC_KEY_PASSWORD',
        'WINDOWS_SIGNING_TENANT_ID',
        'WINDOWS_SIGNING_CLIENT_ID',
        'WINDOWS_SIGNING_CLIENT_SECRET',
        'WINDOWS_SIGNING_ACCOUNT',
        'WINDOWS_SIGNING_CERTIFICATE_PROFILE',
        'GPG_PRIVATE_KEY',
        'GPG_PASSPHRASE',
      ],
    },
    checks,
  }
}

function formatHumanReport(report) {
  const summary = summarizeReleaseTrustReport(report)
  const lines = ['Release trust audit']
  for (const check of report.checks) {
    const label = check.status === 'ok' ? 'OK' : check.status === 'warning' ? 'WARN' : 'FAIL'
    lines.push(`- ${check.label} ... ${label}`)
    lines.push(`  ${check.detail}`)
  }
  lines.push('')
  lines.push(`Summary: ok=${summary.ok} warning=${summary.warning} error=${summary.error}`)
  return lines.join('\n')
}

function parseArgs(argv) {
  const options = {
    json: false,
    includeSigningReadiness: false,
    requireSigned: null,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--json' || arg === '--format=json') {
      options.json = true
    } else if (arg === '--signed-readiness') {
      options.includeSigningReadiness = true
    } else if (arg === '--require-signed') {
      options.requireSigned = normalizeRequiredSignedProfile(argv[index + 1])
      index += 1
    } else if (arg.startsWith('--require-signed=')) {
      options.requireSigned = normalizeRequiredSignedProfile(arg.slice('--require-signed='.length))
    }
  }

  if (options.requireSigned) {
    options.includeSigningReadiness = true
  }

  return options
}

function main(argv) {
  const options = parseArgs(argv)
  const report = buildReleaseTrustReport(DEFAULT_ROOT, options)
  const summary = summarizeReleaseTrustReport(report)

  if (options.json) {
    process.stdout.write(`${JSON.stringify({ ...report, summary }, null, 2)}\n`)
  } else {
    process.stdout.write(`${formatHumanReport(report)}\n`)
  }

  if (summary.error > 0) {
    process.exit(1)
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null
if (invokedPath && resolve(fileURLToPath(import.meta.url)) === invokedPath) {
  main(process.argv.slice(2))
}
