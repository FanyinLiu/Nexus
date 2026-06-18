#!/usr/bin/env node

import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

export const M2_DISTRIBUTION_TRUST_GATE = 'nexus-v1-m2-distribution-trust'
export const M2_PACKAGE_SMOKE_GATE = 'nexus-v1-m2-package-smoke'
export const DEFAULT_M2_DISTRIBUTION_TRUST_FILE = 'artifacts/v1/m2-distribution-trust.json'
export const DEFAULT_M2_PACKAGE_SMOKE_DIR = 'artifacts/v1'
export const REQUIRED_M2_PACKAGE_SMOKE_PLATFORMS = ['windows', 'macos', 'linux']

const PACKAGE_JSON_PATH = 'package.json'
const RELEASE_WORKFLOW_PATH = '.github/workflows/release.yml'
const RELEASING_DOC_PATH = 'docs/RELEASING.md'
const README_PATH = 'README.md'
const UPDATER_SERVICE_PATH = 'electron/services/updaterService.js'
const PRELOAD_PATH = 'electron/preload.js'

function printUsage(stream = process.stderr) {
  stream.write([
    'Usage: node scripts/m2-distribution-trust-audit.mjs [options]',
    '',
    'Builds a private-safe v1 M2 distribution, update, and signing-posture audit.',
    '',
    'Options:',
    '  --generated-at <iso>      Override report timestamp',
    `  --package-smoke-dir <path> Scan package smoke evidence dir (default: ${DEFAULT_M2_PACKAGE_SMOKE_DIR})`,
    '  --package-smoke-file <path>',
    '                            Additional package smoke JSON; repeatable',
    `  --output <path>           Write JSON report (default when omitted: stdout only)`,
    '  --require-ready           Exit non-zero unless distribution trust evidence is ready',
    '  --require-package-smoke   Also require Windows/macOS/Linux package smoke evidence',
    '  --help                    Show this help',
    '',
  ].join('\n'))
}

function cleanString(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim()
}

function normalizeIso(value = new Date()) {
  const parsed = Date.parse(String(value))
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : new Date().toISOString()
}

function splitOption(arg) {
  const eq = arg.indexOf('=')
  if (eq < 0) return [arg, null]
  return [arg.slice(0, eq), arg.slice(eq + 1)]
}

function readRequiredOptionValue(argv, index, inlineValue, optionName) {
  if (inlineValue !== null) return { value: inlineValue, nextIndex: index }
  const value = argv[index + 1]
  if (value === undefined || value.startsWith('--')) {
    throw new Error(`${optionName} requires a value`)
  }
  return { value, nextIndex: index + 1 }
}

export function parseM2DistributionTrustArgs(argv) {
  const options = {
    generatedAt: '',
    help: false,
    outputPath: '',
    packageSmokeDir: DEFAULT_M2_PACKAGE_SMOKE_DIR,
    packageSmokeFiles: [],
    requirePackageSmoke: false,
    requireReady: false,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--help' || arg === '-h') {
      options.help = true
      continue
    }
    if (arg === '--require-ready') {
      options.requireReady = true
      continue
    }
    if (arg === '--require-package-smoke') {
      options.requirePackageSmoke = true
      continue
    }
    if (arg.startsWith('--')) {
      const [name, inlineValue] = splitOption(arg)
      const parsed = readRequiredOptionValue(argv, index, inlineValue, name)
      if (name === '--generated-at') {
        options.generatedAt = parsed.value
      } else if (name === '--package-smoke-dir') {
        options.packageSmokeDir = parsed.value
      } else if (name === '--package-smoke-file') {
        options.packageSmokeFiles.push(parsed.value)
      } else if (name === '--output' || name === '--output-file') {
        options.outputPath = parsed.value
      } else {
        throw new Error(`Unknown option: ${name}`)
      }
      index = parsed.nextIndex
      continue
    }
    throw new Error(`Unexpected argument: ${arg}`)
  }

  return options
}

async function readTextStatus(filePath) {
  const target = cleanString(filePath)
  try {
    return {
      exists: true,
      path: target,
      text: await fs.readFile(path.resolve(process.cwd(), target), 'utf8'),
      error: null,
    }
  } catch (error) {
    return {
      exists: false,
      path: target,
      text: '',
      error: error?.code === 'ENOENT' ? 'missing' : 'read-failed',
    }
  }
}

async function readJsonStatus(filePath) {
  const source = await readTextStatus(filePath)
  if (!source.exists) {
    return { ...source, value: null }
  }
  try {
    return {
      ...source,
      value: JSON.parse(source.text),
      error: null,
    }
  } catch {
    return {
      ...source,
      value: null,
      error: 'invalid-json',
    }
  }
}

function hasScript(pkg, name) {
  return typeof pkg?.scripts?.[name] === 'string' && pkg.scripts[name].length > 0
}

function includesAll(text, terms) {
  return terms.every((term) => text.includes(term))
}

function checkSummary(id, label, pass, details = {}) {
  return {
    id,
    label,
    status: pass ? 'pass' : 'fail',
    pass,
    ...details,
  }
}

function safeArray(value) {
  return Array.isArray(value) ? value : []
}

function unique(values) {
  return [...new Set(values.filter(Boolean))]
}

async function readJsonFile(filePath) {
  const target = cleanString(filePath)
  const result = {
    path: target,
    exists: false,
    error: null,
    raw: null,
  }
  if (!target) {
    result.error = 'missing-path'
    return result
  }
  try {
    const text = await fs.readFile(path.resolve(process.cwd(), target), 'utf8')
    result.exists = true
    result.raw = JSON.parse(text)
  } catch (error) {
    result.error = error?.code === 'ENOENT' ? 'missing' : 'invalid-json'
  }
  return result
}

async function listPackageSmokeFiles(packageSmokeDir, explicitFiles) {
  const files = [...safeArray(explicitFiles).map(cleanString).filter(Boolean)]
  const normalizedDir = cleanString(packageSmokeDir)
  if (normalizedDir) {
    try {
      const entries = await fs.readdir(path.resolve(process.cwd(), normalizedDir))
      for (const entry of entries) {
        if (/^m2-package-smoke.*\.json$/i.test(entry)) {
          files.push(path.join(normalizedDir, entry))
        }
      }
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }
  }
  return unique(files)
}

function summarizePackageSmokeRecord(source) {
  const raw = source.raw
  const platform = cleanString(raw?.platform).toLowerCase() || 'unknown'

  return {
    path: source.path,
    exists: source.exists,
    error: source.error,
    gateOk: raw?.gate === M2_PACKAGE_SMOKE_GATE,
    ok: raw?.ok === true,
    platform,
    status: cleanString(raw?.status) || (source.exists ? 'unknown' : 'missing'),
    executableFound: raw?.executableFound === true,
    executableKind: cleanString(raw?.executableKind) || 'unknown',
    releaseDir: cleanString(raw?.releaseDir) || null,
    timeoutMs: Number.isFinite(Number(raw?.timeoutMs)) ? Number(raw.timeoutMs) : null,
  }
}

function buildPackageSmokeCoverage(records) {
  return REQUIRED_M2_PACKAGE_SMOKE_PLATFORMS.map((platform) => {
    const matches = records.filter((record) => record.platform === platform)
    const passing = matches.filter((record) => record.exists && record.gateOk && record.ok && record.executableFound)
    const best = passing[0] ?? matches[0] ?? null
    return {
      platform,
      pass: passing.length > 0,
      status: passing.length > 0 ? 'pass' : 'missing',
      evidenceFiles: matches.map((record) => record.path),
      executableKind: best?.executableKind ?? null,
      releaseDir: best?.releaseDir ?? null,
      nextActions: passing.length > 0 ? [] : [`run-${platform}-package-smoke`],
    }
  })
}

async function summarizePackageSmokeEvidence(options) {
  const files = await listPackageSmokeFiles(options.packageSmokeDir, options.packageSmokeFiles)
  const sources = await Promise.all(files.map((filePath) => readJsonFile(filePath)))
  const records = sources.map(summarizePackageSmokeRecord)
  const platformCoverage = buildPackageSmokeCoverage(records)
  const missingPlatformIds = platformCoverage
    .filter((coverage) => !coverage.pass)
    .map((coverage) => coverage.platform)

  return {
    required: Boolean(options.requirePackageSmoke),
    scannedDir: cleanString(options.packageSmokeDir) || null,
    totalRecordCount: records.length,
    passingRecordCount: records.filter((record) => record.ok && record.gateOk).length,
    invalidRecordCount: records.filter((record) => record.exists && !record.gateOk).length,
    records,
    platformCoverage,
    missingPlatformIds,
    ready: missingPlatformIds.length === 0,
    nextActions: missingPlatformIds.map((platform) => `run-${platform}-package-smoke`),
  }
}

function summarizePackageScripts(pkg) {
  const required = [
    'package:win',
    'package:mac',
    'package:linux',
    'package:dir:smoke',
    'distribution:audit',
    'prerelease-check',
    'verify:release',
    'm2:distribution:trust',
  ]
  const missing = required.filter((scriptName) => !hasScript(pkg, scriptName))
  return checkSummary('package-scripts', 'Package scripts cover build, smoke, and release gates', missing.length === 0, {
    required,
    missing,
  })
}

function summarizeBuilderTargets(pkg) {
  const winTargets = Array.isArray(pkg?.build?.win?.target) ? pkg.build.win.target : []
  const macTargets = Array.isArray(pkg?.build?.mac?.target) ? pkg.build.mac.target : []
  const linuxTargets = Array.isArray(pkg?.build?.linux?.target) ? pkg.build.linux.target : []
  const publish = Array.isArray(pkg?.build?.publish) ? pkg.build.publish[0] : null
  const missing = [
    ...(!winTargets.includes('nsis') ? ['win.nsis'] : []),
    ...(!macTargets.includes('dmg') ? ['mac.dmg'] : []),
    ...(!macTargets.includes('zip') ? ['mac.zip'] : []),
    ...(!linuxTargets.includes('AppImage') ? ['linux.AppImage'] : []),
    ...(!linuxTargets.includes('deb') ? ['linux.deb'] : []),
    ...(publish?.provider !== 'github' ? ['publish.github'] : []),
    ...(publish?.owner !== 'FanyinLiu' ? ['publish.owner'] : []),
    ...(publish?.repo !== 'Nexus' ? ['publish.repo'] : []),
    ...(!pkg?.dependencies?.['electron-updater'] ? ['electron-updater'] : []),
  ]

  return checkSummary('builder-targets', 'Electron Builder targets and GitHub updater metadata are configured', missing.length === 0, {
    missing,
    targets: {
      windows: winTargets,
      macos: macTargets,
      linux: linuxTargets,
    },
    publish: publish
      ? {
          provider: cleanString(publish.provider),
          owner: cleanString(publish.owner),
          repo: cleanString(publish.repo),
        }
      : null,
  })
}

function summarizeReleaseWorkflow(workflowText) {
  const requiredTerms = [
    "tags:\n      - 'v*.*.*'",
    'workflow_dispatch:',
    'preflight:',
    'npm run prerelease-check --',
    'needs: [ensure-release, preflight]',
    'release/latest.yml',
    'release/latest-mac.yml',
    'release/latest-linux*.yml',
    'SHA256SUMS',
    'GPG_PRIVATE_KEY',
    'Published release $TAG already exists',
  ]
  const missing = requiredTerms.filter((term) => !workflowText.includes(term))
  const deletesPublishedRelease = workflowText.includes('gh release delete')

  return checkSummary('release-workflow', 'Release workflow builds all platforms and protects published releases', missing.length === 0 && !deletesPublishedRelease, {
    missing,
    deletesPublishedRelease,
  })
}

function summarizeUpdaterRuntime(updaterText, preloadText) {
  const requiredUpdaterTerms = [
    'autoUpdater.autoDownload = true',
    'autoUpdater.autoInstallOnAppQuit = true',
    'autoUpdater.allowDowngrade = false',
    '!app.isPackaged',
  ]
  const requiredPreloadApis = [
    'updaterCheck',
    'updaterStatus',
    'updaterInstall',
    'subscribeUpdaterEvent',
  ]
  const missing = [
    ...requiredUpdaterTerms.filter((term) => !updaterText.includes(term)).map((term) => `updater:${term}`),
    ...requiredPreloadApis.filter((api) => !preloadText.includes(api)).map((api) => `preload:${api}`),
  ]

  return checkSummary('updater-runtime', 'Auto-updater runtime is wired with downgrade protection and renderer status APIs', missing.length === 0, {
    missing,
  })
}

function summarizeUnsignedFallback({ pkg, workflowText, releasingText, readmeText }) {
  const windowsWorkflowUnsigned = workflowText.includes('--config.win.signAndEditExecutable=false')
  const macWorkflowUnsigned = workflowText.includes('CSC_IDENTITY_AUTO_DISCOVERY')
    && workflowText.includes('false')
  const macBuilderUnsigned = pkg?.build?.mac?.hardenedRuntime === false
    && pkg?.build?.mac?.gatekeeperAssess === false
  const readmeFallback = includesAll(readmeText, ['xattr -dr', 'SmartScreen'])
  const releasingFallback = includesAll(releasingText, ['unsigned-build caveats', 'xattr/SmartScreen'])
  const linuxIntegrity = workflowText.includes('sha256sum *.AppImage *.deb *.tar.gz > SHA256SUMS')
    && workflowText.includes('gpg --batch --import')
  const missing = [
    ...(!windowsWorkflowUnsigned ? ['windows-unsigned-posture'] : []),
    ...(!macWorkflowUnsigned ? ['macos-workflow-unsigned-posture'] : []),
    ...(!macBuilderUnsigned ? ['macos-builder-unsigned-posture'] : []),
    ...(!readmeFallback ? ['readme-unsigned-fallback'] : []),
    ...(!releasingFallback ? ['releasing-unsigned-fallback'] : []),
    ...(!linuxIntegrity ? ['linux-integrity-path'] : []),
  ]

  return checkSummary('signing-and-integrity-posture', 'Signing posture is explicit and unsigned fallback is documented', missing.length === 0, {
    missing,
    platforms: {
      windows: {
        status: windowsWorkflowUnsigned && readmeFallback ? 'unsigned-fallback-documented' : 'needs-signing-or-docs',
        signed: false,
      },
      macos: {
        status: macWorkflowUnsigned && macBuilderUnsigned && readmeFallback ? 'unsigned-fallback-documented' : 'needs-signing-or-docs',
        signed: false,
      },
      linux: {
        status: linuxIntegrity ? 'sha256-ready-gpg-optional' : 'needs-integrity-path',
        signed: false,
        detachedSignature: workflowText.includes('GPG_PRIVATE_KEY')
          ? 'optional-when-secret-configured'
          : 'not-configured',
      },
    },
  })
}

function summarizePlatformReadiness(checks) {
  const builder = checks.find((item) => item.id === 'builder-targets')
  const workflow = checks.find((item) => item.id === 'release-workflow')
  const signing = checks.find((item) => item.id === 'signing-and-integrity-posture')
  const updater = checks.find((item) => item.id === 'updater-runtime')
  const signingPlatforms = signing?.platforms ?? {}

  return ['windows', 'macos', 'linux'].map((platform) => {
    const ready = Boolean(builder?.pass && workflow?.pass && updater?.pass && signing?.pass)
    return {
      platform,
      ready,
      status: ready ? 'ready' : 'needs-distribution-work',
      installTarget: platform === 'windows' ? 'nsis' : platform === 'macos' ? 'dmg+zip' : 'AppImage+deb',
      updateMetadata: platform === 'windows'
        ? 'latest.yml'
        : platform === 'macos'
          ? 'latest-mac.yml'
          : 'latest-linux*.yml',
      signingStatus: signingPlatforms[platform]?.status ?? 'unknown',
    }
  })
}

export async function buildM2DistributionTrustReport(options = {}, generatedAt = new Date().toISOString()) {
  const [
    packageSource,
    workflowSource,
    releasingSource,
    readmeSource,
    updaterSource,
    preloadSource,
  ] = await Promise.all([
    readJsonStatus(PACKAGE_JSON_PATH),
    readTextStatus(RELEASE_WORKFLOW_PATH),
    readTextStatus(RELEASING_DOC_PATH),
    readTextStatus(README_PATH),
    readTextStatus(UPDATER_SERVICE_PATH),
    readTextStatus(PRELOAD_PATH),
  ])

  const pkg = packageSource.value ?? {}
  const checks = [
    summarizePackageScripts(pkg),
    summarizeBuilderTargets(pkg),
    summarizeReleaseWorkflow(workflowSource.text),
    summarizeUpdaterRuntime(updaterSource.text, preloadSource.text),
    summarizeUnsignedFallback({
      pkg,
      workflowText: workflowSource.text,
      releasingText: releasingSource.text,
      readmeText: readmeSource.text,
    }),
  ]
  const missingSourceIds = [
    packageSource,
    workflowSource,
    releasingSource,
    readmeSource,
    updaterSource,
    preloadSource,
  ].filter((source) => !source.exists || source.error).map((source) => source.path)
  const failingCheckIds = checks.filter((item) => !item.pass).map((item) => item.id)
  const platformReadiness = summarizePlatformReadiness(checks)
  const packageSmoke = await summarizePackageSmokeEvidence(options)
  const packageSmokeBlockingIds = options.requirePackageSmoke && !packageSmoke.ready
    ? packageSmoke.missingPlatformIds.map((platform) => `missing-package-smoke:${platform}`)
    : []
  const ok = missingSourceIds.length === 0
    && failingCheckIds.length === 0
    && packageSmokeBlockingIds.length === 0

  return {
    schemaVersion: 1,
    gate: M2_DISTRIBUTION_TRUST_GATE,
    generatedAt: normalizeIso(options.generatedAt || generatedAt),
    ok,
    overallStatus: ok ? 'ready-with-documented-unsigned-fallback' : 'needs-distribution-trust-work',
    targetMilestone: 'M2',
    sourceFiles: [
      packageSource,
      workflowSource,
      releasingSource,
      readmeSource,
      updaterSource,
      preloadSource,
    ].map((source) => ({
      path: source.path,
      exists: source.exists,
      error: source.error,
    })),
    checks,
    platformReadiness,
    packageSmoke,
    blockingIssueIds: [
      ...missingSourceIds.map((id) => `missing-source:${id}`),
      ...failingCheckIds.map((id) => `failing-check:${id}`),
      ...packageSmokeBlockingIds,
    ],
    nextActions: missingSourceIds.length === 0 && failingCheckIds.length === 0
      ? packageSmokeBlockingIds.length > 0
        ? packageSmoke.nextActions
        : ['capture-real-package-smoke-evidence-per-platform']
      : [
          ...missingSourceIds.map((id) => `restore-${id}`),
          ...failingCheckIds.map((id) => `fix-${id}`),
        ],
    privacy: {
      artifactContentsCopied: false,
      privateFieldsOmitted: [
        'Apple Developer ID identities',
        'Windows signing certificates',
        'GPG private key material',
        'GitHub tokens',
        'release operator names and notes',
      ],
    },
  }
}

async function writeReportFile(report, outputPath) {
  const target = cleanString(outputPath)
  if (!target) return
  const resolved = path.resolve(process.cwd(), target)
  await fs.mkdir(path.dirname(resolved), { recursive: true })
  await fs.writeFile(resolved, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
}

export async function runM2DistributionTrustCli(argv = process.argv.slice(2)) {
  const options = parseM2DistributionTrustArgs(argv)
  if (options.help) {
    printUsage(process.stdout)
    return 0
  }
  const report = await buildM2DistributionTrustReport(options)
  await writeReportFile(report, options.outputPath)
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  return (options.requireReady || options.requirePackageSmoke) && !report.ok ? 1 : 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  runM2DistributionTrustCli().then((code) => {
    process.exitCode = code
  }).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
