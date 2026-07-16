#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { basename, dirname, join, resolve } from 'node:path'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import {
  requiredPackagedResources,
  verifyPackagedResources,
} from './release-resource-verifier.mjs'

const OFFICIAL_BUNDLE_ID = 'ai.factory.desktoppet'
const OFFICIAL_APP_NAME = 'Nexus.app'
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

export function requiredMacReleaseResources(appPath) {
  const resourcesRoot = join(appPath, 'Contents', 'Resources')
  return requiredPackagedResources(resourcesRoot)
}

export function parseCodeSignatureDetails(output) {
  const teamIdentifier = output.match(/^TeamIdentifier=(.+)$/m)?.[1]?.trim() ?? ''
  const authorities = [...output.matchAll(/^Authority=(.+)$/gm)].map((match) => match[1].trim())
  const isAdHoc = /^Signature=adhoc$/m.test(output) || /^CodeDirectory .*\(adhoc(?:[,)]|$)/m.test(output)
  return {
    teamIdentifier,
    authorities,
    isAdHoc,
    isDeveloperId: authorities.some((authority) => authority.startsWith('Developer ID Application:'))
      && teamIdentifier !== ''
      && teamIdentifier !== 'not set',
  }
}

export function parseArchitectures(output) {
  return [...new Set(String(output).trim().split(/\s+/).filter(Boolean))]
}

function run(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  return {
    ok: result.status === 0,
    output: [result.stdout, result.stderr].filter(Boolean).join('\n'),
    status: result.status,
    executed: !result.error,
    error: result.error?.message ?? '',
  }
}

function commandExecuted(result) {
  return result?.executed !== false && !result?.error
}

export function isExplicitGatekeeperRejection(result) {
  return commandExecuted(result) && result.ok === false && /(?:^|\s)rejected(?:\s|$)/i.test(String(result.output ?? ''))
}

export function isExplicitMissingStapledTicket(result) {
  return commandExecuted(result) && result.ok === false && /does not have a ticket stapled to it/i.test(String(result.output ?? ''))
}

function readPlistValue(plistPath, key, runCommand) {
  const result = runCommand('plutil', ['-extract', key, 'raw', '-o', '-', plistPath])
  return result.ok ? result.output.trim() : ''
}

export function verifyMacRelease(appPath, options = {}) {
  const {
    expectUnsigned = false,
    expectedVersion = null,
    runCommand = run,
    pathExists = existsSync,
    fileSize = (path) => statSync(path).size,
    resourceVerifier = verifyPackagedResources,
    resourceVerifierOptions = {},
  } = options
  const errors = []

  if (!appPath || !pathExists(appPath)) {
    return { ok: false, errors: [`app bundle not found: ${appPath || '<missing>'}`] }
  }
  if (basename(appPath) !== OFFICIAL_APP_NAME) {
    errors.push(`formal release bundle must be named ${OFFICIAL_APP_NAME}`)
  }

  const plistPath = join(appPath, 'Contents', 'Info.plist')
  if (!pathExists(plistPath)) errors.push('Info.plist is missing from the app bundle')

  const bundleIdentifier = readPlistValue(plistPath, 'CFBundleIdentifier', runCommand)
  const bundleVersion = readPlistValue(plistPath, 'CFBundleShortVersionString', runCommand)
  const executableName = readPlistValue(plistPath, 'CFBundleExecutable', runCommand)
  const bundleName = readPlistValue(plistPath, 'CFBundleName', runCommand)

  if (bundleIdentifier !== OFFICIAL_BUNDLE_ID) {
    errors.push(`bundle identifier must be ${OFFICIAL_BUNDLE_ID} (got ${bundleIdentifier || '<missing>'})`)
  }
  if (!expectedVersion) {
    errors.push('expected package version is required')
  } else if (bundleVersion !== expectedVersion) {
    errors.push(`bundle version must be ${expectedVersion} (got ${bundleVersion || '<missing>'})`)
  }
  if (bundleName !== 'Nexus' || executableName !== 'Nexus') {
    errors.push('bundle name and executable must use the formal Nexus identity')
  }
  if ([appPath, bundleIdentifier, bundleName, executableName].some((value) => /smoke/i.test(value))) {
    errors.push('smoke identity must not appear in a formal release bundle')
  }

  const resourcesRoot = join(appPath, 'Contents', 'Resources')
  const requiredResources = requiredMacReleaseResources(appPath)
  const resourceReport = resourceVerifier(resourcesRoot, {
    pathExists,
    fileSize,
    ...resourceVerifierOptions,
  })
  if (!resourceReport?.ok) {
    const resourceErrors = Array.isArray(resourceReport?.errors) && resourceReport.errors.length > 0
      ? resourceReport.errors
      : ['packaged resource verifier returned an ambiguous result']
    errors.push(...resourceErrors)
  }

  const executablePath = executableName ? join(appPath, 'Contents', 'MacOS', executableName) : ''
  if (!executablePath || !pathExists(executablePath)) errors.push('formal Nexus executable is missing')
  const architecture = executablePath
    ? runCommand('lipo', ['-archs', executablePath])
    : { ok: false, output: '' }
  const architectures = architecture.ok ? parseArchitectures(architecture.output) : []
  if (!architecture.ok) errors.push('failed to inspect executable architecture')
  if (architectures.length !== 1 || architectures[0] !== 'arm64') {
    errors.push(`formal macOS release must be arm64 only (got ${architectures.join(', ') || '<unknown>'})`)
  }

  const signature = runCommand('codesign', ['--verify', '--deep', '--strict', '--verbose=2', appPath])
  if (!signature.ok) errors.push('codesign verification failed')

  const details = runCommand('codesign', ['-dv', '--verbose=4', appPath])
  const parsedDetails = parseCodeSignatureDetails(details.output)
  if (!details.ok && !details.output) errors.push('failed to inspect code signature details')

  const gatekeeper = runCommand('spctl', ['--assess', '--type', 'execute', '--verbose=4', appPath])
  const notarization = runCommand('xcrun', ['stapler', 'validate', appPath])

  if (expectUnsigned) {
    if (!parsedDetails.isAdHoc) errors.push('unsigned release must carry an explicit ad-hoc signature')
    if (parsedDetails.isDeveloperId || (parsedDetails.teamIdentifier && parsedDetails.teamIdentifier !== 'not set')) {
      errors.push('unsigned release must not carry a Developer ID TeamIdentifier')
    }
    if (parsedDetails.authorities.length > 0) errors.push('unsigned release must not contain certificate authorities')
    if (gatekeeper.ok) {
      errors.push('unsigned release unexpectedly passed Gatekeeper assessment')
    } else if (!isExplicitGatekeeperRejection(gatekeeper)) {
      errors.push('Gatekeeper did not produce an explicit rejection; assessment may have failed to execute')
    }
    if (notarization.ok) {
      errors.push('unsigned release unexpectedly contains a stapled notarization ticket')
    } else if (!isExplicitMissingStapledTicket(notarization)) {
      errors.push('stapler did not explicitly report a missing ticket; validation may have failed to execute')
    }
  } else {
    if (!parsedDetails.isDeveloperId) errors.push('app is not signed by a Developer ID Application identity')
    if (!gatekeeper.ok) errors.push('spctl Gatekeeper assessment failed')
    if (!notarization.ok) errors.push('notarization ticket validation failed')
  }

  return {
    ok: errors.length === 0,
    errors,
    mode: expectUnsigned ? 'unsigned' : 'signed',
    bundleIdentifier,
    bundleVersion,
    executableName,
    architectures,
    teamIdentifier: parsedDetails.teamIdentifier,
    authorities: parsedDetails.authorities,
    isAdHoc: parsedDetails.isAdHoc,
    gatekeeperAccepted: gatekeeper.ok,
    notarizationTicketPresent: notarization.ok,
    requiredResources: requiredResources.map((resource) => resource.modelId),
  }
}

function parseArgs(argv) {
  return {
    expectUnsigned: argv.includes('--expect-unsigned'),
    appPath: argv.find((arg) => !arg.startsWith('--')) ?? '',
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null
if (invokedPath && resolve(fileURLToPath(import.meta.url)) === invokedPath) {
  const args = parseArgs(process.argv.slice(2))
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
  const result = verifyMacRelease(args.appPath, {
    expectUnsigned: args.expectUnsigned,
    expectedVersion: pkg.version,
  })
  if (!result.ok) {
    console.error(`macOS ${result.mode ?? (args.expectUnsigned ? 'unsigned' : 'signed')} release verification failed`)
    for (const error of result.errors) console.error(`- ${error}`)
    process.exit(1)
  }
  console.log(`macOS ${result.mode} release verification passed`)
  console.log(`- bundle: ${result.bundleIdentifier} ${result.bundleVersion}`)
  console.log(`- architectures: ${result.architectures.join(', ')}`)
  if (result.mode === 'unsigned') {
    console.log('- ad-hoc signature present; Gatekeeper rejected; no stapled notarization ticket')
  } else {
    console.log(`- TeamIdentifier: ${result.teamIdentifier}`)
    console.log('- codesign, Gatekeeper, and notarization ticket validation passed')
  }
}
