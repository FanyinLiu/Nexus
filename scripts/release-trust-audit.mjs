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

function anyPresent(text, values) {
  return values.some((value) => text.includes(value))
}

const ALL_SIGNING_SECRET_NAMES = [
  ...MAC_SIGNING_SECRET_NAMES,
  ...WINDOWS_CERT_SIGNING_SECRET_NAMES,
  ...WINDOWS_CLOUD_SIGNING_SECRET_NAMES,
]

function classifyMacSigning(pkg, releaseWorkflow, releasingDoc) {
  const build = pkg.build ?? {}
  const mac = pkg.build?.mac ?? {}
  const macPackagePreflight = pkg.scripts?.['prepackage:mac'] ?? ''
  const targets = Array.isArray(mac.target) ? mac.target : []
  const explicitUnsigned =
    build.forceCodeSigning === false &&
    mac.identity === '-' &&
    mac.hardenedRuntime === false &&
    mac.gatekeeperAssess === false &&
    mac.notarize === false &&
    releaseWorkflow.includes('CSC_IDENTITY_AUTO_DISCOVERY') &&
    releaseWorkflow.includes('false') &&
    releaseWorkflow.includes('--config.mac.identity=-') &&
    !anyPresent(releaseWorkflow, ALL_SIGNING_SECRET_NAMES.map((name) => `secrets.${name}`)) &&
    !releaseWorkflow.includes('NEXUS_MAC_AUTO_UPDATE_MODE')
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
    /current unsigned release\s+posture|unsigned macOS|macOS[\s\S]{0,80}unsigned/i.test(releasingDoc) &&
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
    identity: mac.identity ?? null,
    forceCodeSigning: build.forceCodeSigning ?? null,
    hardenedRuntime: mac.hardenedRuntime ?? null,
    gatekeeperAssess: mac.gatekeeperAssess ?? null,
    notarize: mac.notarize ?? null,
    workflowDisablesAutoDiscovery: releaseWorkflow.includes('CSC_IDENTITY_AUTO_DISCOVERY'),
    docsCurrentUnsigned,
    docsSigningPrereqs,
  }
}

function classifyWindowsSigning(pkg, releaseWorkflow, releasingDoc) {
  const build = pkg.build ?? {}
  const win = build.win ?? {}
  const unsignedPackageScript = pkg.scripts?.['package:win'] ?? ''
  const targets = Array.isArray(pkg.build?.win?.target) ? pkg.build.win.target : []
  const verifierCommand = 'node scripts/verify-windows-release.mjs --expect-unsigned'
  const packageCommandIndex = releaseWorkflow.indexOf('electron-builder --win')
  const verifierCommandIndex = releaseWorkflow.indexOf(verifierCommand)
  const verifiesUnsignedArtifacts =
    verifierCommandIndex > packageCommandIndex &&
    packageCommandIndex >= 0
  const explicitUnsigned =
    build.forceCodeSigning === false &&
    win.signAndEditExecutable === true &&
    unsignedPackageScript.includes('CSC_IDENTITY_AUTO_DISCOVERY=false') &&
    unsignedPackageScript.includes('--config.forceCodeSigning=false') &&
    unsignedPackageScript.includes('--config.win.signAndEditExecutable=true') &&
    releaseWorkflow.includes('--config.forceCodeSigning=false') &&
    releaseWorkflow.includes('--config.win.signAndEditExecutable=true') &&
    releaseWorkflow.includes("CSC_IDENTITY_AUTO_DISCOVERY: 'false'") &&
    verifiesUnsignedArtifacts &&
    !anyPresent(releaseWorkflow, ALL_SIGNING_SECRET_NAMES.map((name) => `secrets.${name}`))
  const hasSignedScript = hasScript(pkg, 'package:win:signed')
  const docsCurrentUnsigned =
    /current unsigned release\s+posture|unsigned Windows|Windows[\s\S]{0,80}unsigned/i.test(releasingDoc) &&
    /SmartScreen/i.test(releasingDoc)
  const signedReady = !explicitUnsigned && /WINDOWS_|AZURE_|TRUSTED_SIGNING|CSC_LINK/i.test(releaseWorkflow)

  return {
    targets,
    posture: signedReady ? 'signed-ready' : explicitUnsigned ? 'unsigned-explicit' : 'ambiguous',
    explicitUnsigned,
    verifiesUnsignedArtifacts,
    packageScriptPreservesMetadata:
      unsignedPackageScript.includes('--config.win.signAndEditExecutable=true'),
    forceCodeSigning: build.forceCodeSigning ?? null,
    signAndEditExecutable: win.signAndEditExecutable ?? null,
    requestedExecutionLevel: win.requestedExecutionLevel ?? null,
    hasSignedScript,
    docsCurrentUnsigned,
  }
}

function classifyLinuxIntegrity(releaseWorkflow) {
  const checksumFiles = [
    'SHA256SUMS-windows.txt',
    'SHA256SUMS-macos.txt',
    'SHA256SUMS-linux.txt',
  ]
  return {
    sha256Sums: checksumFiles.every((name) => releaseWorkflow.includes(name)),
    checksumFiles,
    gpgRemoved:
      !releaseWorkflow.includes('GPG_PRIVATE_KEY') &&
      !releaseWorkflow.includes('GPG_PASSPHRASE') &&
      !releaseWorkflow.includes('--detach-sign'),
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
  const signedPackageScript = pkg.scripts?.['package:win:signed'] ?? ''

  if (!hasScript(pkg, 'package:win:signed')) {
    blockers.push('package.json must keep package:win:signed for signed Windows packaging')
  }
  if (
    hasScript(pkg, 'package:win:signed') &&
    (!signedPackageScript.includes('--config.forceCodeSigning=true') ||
      !signedPackageScript.includes('--config.win.signAndEditExecutable=true') ||
      signedPackageScript.includes('CSC_IDENTITY_AUTO_DISCOVERY=false'))
  ) {
    blockers.push('package:win:signed must require code signing, keep metadata editing enabled, and permit certificate discovery')
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

function buildFormalReleaseIdentity(pkg, releaseWorkflow) {
  const build = pkg.build ?? {}
  const forbiddenSmokeWiring = [
    'electron-builder.smoke',
    'Nexus Smoke',
    'SMOKE_TEST=1',
    'ai.factory.desktoppet.smoke',
  ]
  const blockers = []

  if (pkg.name !== 'nexus') blockers.push('package name must remain nexus')
  if (build.productName !== 'Nexus') blockers.push('build.productName must remain Nexus')
  if (build.appId !== 'ai.factory.desktoppet') blockers.push('build.appId must remain ai.factory.desktoppet')
  if (typeof pkg.description !== 'string' || !pkg.description.trim()) blockers.push('package description must remain present for Windows VersionInfo')
  if (build.win?.icon !== 'public/nexus.ico') blockers.push('build.win.icon must remain the formal Nexus ICO resource')
  if (build.win?.requestedExecutionLevel !== 'asInvoker') blockers.push('build.win.requestedExecutionLevel must remain asInvoker')
  if (!Array.isArray(build.mac?.extraResources) || build.mac.extraResources.length === 0) {
    blockers.push('build.mac.extraResources must preserve production runtime resources')
  }
  if (!Array.isArray(build.win?.extraResources) || build.win.extraResources.length === 0) {
    blockers.push('build.win.extraResources must preserve production runtime resources')
  }
  if (build.electronFuses?.onlyLoadAppFromAsar !== true || build.electronFuses?.enableEmbeddedAsarIntegrityValidation !== true) {
    blockers.push('production Electron Fuse isolation must remain enabled')
  }
  if (anyPresent(releaseWorkflow, forbiddenSmokeWiring)) {
    blockers.push('release workflow must not reference the smoke identity or smoke builder config')
  }

  return { ready: blockers.length === 0, blockers }
}

function buildUnsignedWorkflowReadiness(pkg, releaseWorkflow) {
  const blockers = []
  const windowsPackageScript = pkg.scripts?.['package:win'] ?? ''
  const checksumFiles = [
    'SHA256SUMS-windows.txt',
    'SHA256SUMS-macos.txt',
    'SHA256SUMS-linux.txt',
  ]

  if (!hasScript(pkg, 'release:unsigned:gate')) {
    blockers.push('package.json must define release:unsigned:gate')
  }
  if (pkg.build?.forceCodeSigning !== false) {
    blockers.push('package.json must keep build.forceCodeSigning=false for the explicit unsigned release profile')
  }
  if (!releaseWorkflow.includes('npm run release:unsigned:gate')) {
    blockers.push('release workflow preflight must run release:unsigned:gate')
  }
  if (!releaseWorkflow.includes('--config.forceCodeSigning=false')) {
    blockers.push('release workflow must force code signing off at package time')
  }
  if (!releaseWorkflow.includes('--config.mac.identity=-')) {
    blockers.push("release workflow must force macOS identity '-' at package time")
  }
  if (pkg.build?.win?.signAndEditExecutable !== true) {
    blockers.push('package.json must keep build.win.signAndEditExecutable=true so icon and VersionInfo metadata are embedded')
  }
  if (pkg.build?.win?.requestedExecutionLevel !== 'asInvoker') {
    blockers.push('package.json must keep the Windows execution level at asInvoker')
  }
  if (
    !windowsPackageScript.includes('CSC_IDENTITY_AUTO_DISCOVERY=false') ||
    !windowsPackageScript.includes('--config.forceCodeSigning=false') ||
    !windowsPackageScript.includes('--config.win.signAndEditExecutable=true')
  ) {
    blockers.push('package:win must disable certificate discovery while preserving Windows metadata editing')
  }
  if (!releaseWorkflow.includes('--config.win.signAndEditExecutable=true')) {
    blockers.push('release workflow must preserve Windows executable metadata editing at package time')
  }
  if (!releaseWorkflow.includes('electron-builder --win nsis --x64')) {
    blockers.push('release workflow must build the formal Windows x64 package')
  }
  const windowsPackageIndex = releaseWorkflow.indexOf('electron-builder --win')
  const windowsVerifierIndex = releaseWorkflow.indexOf('node scripts/verify-windows-release.mjs --expect-unsigned')
  if (windowsPackageIndex < 0 || windowsVerifierIndex <= windowsPackageIndex) {
    blockers.push('release workflow must verify unsigned Windows Authenticode and VersionInfo after packaging')
  }
  if (!releaseWorkflow.includes('CSC_IDENTITY_AUTO_DISCOVERY') || !releaseWorkflow.includes('false')) {
    blockers.push('release workflow must disable certificate identity auto-discovery')
  }
  for (const name of checksumFiles) {
    if (!releaseWorkflow.includes(name)) blockers.push(`release workflow must upload ${name}`)
  }
  for (const secretName of ALL_SIGNING_SECRET_NAMES) {
    if (releaseWorkflow.includes(`secrets.${secretName}`)) {
      blockers.push(`release workflow must not wire signing secret secrets.${secretName}`)
    }
  }
  if (releaseWorkflow.includes('NEXUS_MAC_AUTO_UPDATE_MODE')) {
    blockers.push('unsigned macOS workflow must not enable the signed auto-update mode')
  }
  if (releaseWorkflow.includes('GPG_PRIVATE_KEY') || releaseWorkflow.includes('GPG_PASSPHRASE') || releaseWorkflow.includes('--detach-sign')) {
    blockers.push('release workflow must use SHA256 metadata without the optional GPG branch')
  }
  if (!releaseWorkflow.includes('PACKAGE_VERSION=$(node -p') || !releaseWorkflow.includes('v$PACKAGE_VERSION')) {
    blockers.push('release workflow must fail when the tag does not match package.json version')
  }

  return { ready: blockers.length === 0, blockers, checksumFiles }
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

function normalizeRequiredUnsignedProfile(value) {
  return value === 'mac' || value === 'windows' || value === 'all' ? value : null
}

export function buildReleaseTrustReport(root = DEFAULT_ROOT, options = {}) {
  const requiredSignedProfile = normalizeRequiredSignedProfile(options.requireSigned)
  const requiredUnsignedProfile = normalizeRequiredUnsignedProfile(options.requireUnsigned)
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
  const formalIdentity = buildFormalReleaseIdentity(pkg, releaseWorkflow)
  const unsignedWorkflow = buildUnsignedWorkflowReadiness(pkg, releaseWorkflow)

  const publish = pkg.build?.publish?.[0] ?? {}
  addCheck(
    checks,
    'release.formal-identity',
    'Production release identity is isolated from packaged smoke',
    formalIdentity.ready ? 'ok' : 'error',
    formalIdentity.ready
      ? 'Nexus product name, app id, runtime resources, and Electron Fuses are preserved'
      : `not ready: ${formalIdentity.blockers.join('; ')}`,
  )
  addCheck(
    checks,
    'release.unsigned-workflow',
    'Release workflow is explicitly unsigned and checksum-backed',
    unsignedWorkflow.ready ? 'ok' : 'error',
    unsignedWorkflow.ready
      ? 'signing secrets are absent, package flags are explicit, tag/version match is enforced, and every platform uploads SHA256 metadata'
      : `not ready: ${unsignedWorkflow.blockers.join('; ')}`,
  )

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
  } else if (mac.posture === 'unsigned-explicit' && mac.docsCurrentUnsigned) {
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

  if (requiredUnsignedProfile === 'mac' || requiredUnsignedProfile === 'all') {
    const ready = mac.posture === 'unsigned-explicit'
    addCheck(
      checks,
      'mac.unsigned-gate',
      'macOS release must use the explicit unsigned profile',
      ready ? 'ok' : 'error',
      ready
        ? "forceCodeSigning=false, identity='-', hardened runtime/Gatekeeper/notarization disabled, and CI auto-discovery disabled"
        : 'macOS release configuration is not the explicit unsigned profile',
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
      'certificate discovery is disabled; metadata editing stays enabled and post-package verification requires NotSigned binaries',
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

  if (requiredUnsignedProfile === 'windows' || requiredUnsignedProfile === 'all') {
    const ready = windows.posture === 'unsigned-explicit'
    addCheck(
      checks,
      'windows.unsigned-gate',
      'Windows release must use the explicit unsigned profile',
      ready ? 'ok' : 'error',
      ready
        ? 'forceCodeSigning=false, metadata editing, x64 packaging, and post-package NotSigned verification are enforced'
        : 'Windows release configuration is not the explicit unsigned profile',
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
    linux.sha256Sums && linux.gpgRemoved ? 'ok' : 'error',
    linux.sha256Sums && linux.gpgRemoved
      ? 'Windows, macOS, and Linux SHA256 checksum files are wired without an optional GPG branch'
      : 'per-platform SHA256 checksum files are missing or the obsolete optional GPG branch remains',
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
    releaseProfile: {
      formalIdentity,
      unsignedWorkflow,
      requiredUnsignedProfile,
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

function parseRequiredProfile(value, flag, normalize) {
  const normalized = normalize(value)
  if (!normalized) {
    throw new Error(`${flag} requires one of: mac, windows, all`)
  }
  return normalized
}

export function parseReleaseTrustArgs(argv) {
  const options = {
    json: false,
    includeSigningReadiness: false,
    requireSigned: null,
    requireUnsigned: null,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--json' || arg === '--format=json') {
      options.json = true
    } else if (arg === '--signed-readiness') {
      options.includeSigningReadiness = true
    } else if (arg === '--require-signed') {
      if (options.requireSigned) throw new Error('--require-signed may only be provided once')
      options.requireSigned = parseRequiredProfile(argv[index + 1], '--require-signed', normalizeRequiredSignedProfile)
      index += 1
    } else if (arg.startsWith('--require-signed=')) {
      if (options.requireSigned) throw new Error('--require-signed may only be provided once')
      options.requireSigned = parseRequiredProfile(
        arg.slice('--require-signed='.length),
        '--require-signed',
        normalizeRequiredSignedProfile,
      )
    } else if (arg === '--require-unsigned') {
      if (options.requireUnsigned) throw new Error('--require-unsigned may only be provided once')
      options.requireUnsigned = parseRequiredProfile(argv[index + 1], '--require-unsigned', normalizeRequiredUnsignedProfile)
      index += 1
    } else if (arg.startsWith('--require-unsigned=')) {
      if (options.requireUnsigned) throw new Error('--require-unsigned may only be provided once')
      options.requireUnsigned = parseRequiredProfile(
        arg.slice('--require-unsigned='.length),
        '--require-unsigned',
        normalizeRequiredUnsignedProfile,
      )
    } else {
      throw new Error(`unknown argument: ${arg}`)
    }
  }

  if (options.requireSigned && options.requireUnsigned) {
    throw new Error('--require-signed and --require-unsigned are mutually exclusive')
  }
  if (options.requireSigned) {
    options.includeSigningReadiness = true
  }

  return options
}

function main(argv) {
  let options
  try {
    options = parseReleaseTrustArgs(argv)
  } catch (error) {
    console.error(`Release trust audit argument error: ${error instanceof Error ? error.message : String(error)}`)
    process.exit(2)
  }
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
