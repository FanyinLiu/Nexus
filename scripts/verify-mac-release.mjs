#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'

export function parseCodeSignatureDetails(output) {
  const teamIdentifier = output.match(/^TeamIdentifier=(.+)$/m)?.[1]?.trim() ?? ''
  const authorities = [...output.matchAll(/^Authority=(.+)$/gm)].map((match) => match[1].trim())
  return {
    teamIdentifier,
    authorities,
    isDeveloperId: authorities.some((authority) => authority.startsWith('Developer ID Application:'))
      && teamIdentifier !== ''
      && teamIdentifier !== 'not set',
  }
}

function run(command, args) {
  try {
    return { ok: true, output: execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) }
  } catch (error) {
    const output = [error.stdout, error.stderr].filter(Boolean).join('\n')
    return { ok: false, output }
  }
}

export function verifyMacRelease(appPath) {
  const errors = []
  if (!appPath || !existsSync(appPath)) {
    return { ok: false, errors: [`app bundle not found: ${appPath || '<missing>'}`] }
  }

  const signature = run('codesign', ['--verify', '--deep', '--strict', '--verbose=2', appPath])
  if (!signature.ok) errors.push('codesign verification failed')

  const details = run('codesign', ['-dv', '--verbose=4', appPath])
  const parsedDetails = parseCodeSignatureDetails(details.output)
  if (!parsedDetails.isDeveloperId) {
    errors.push('app is not signed by a Developer ID Application identity')
  }

  const gatekeeper = run('spctl', ['--assess', '--type', 'execute', '--verbose=4', appPath])
  if (!gatekeeper.ok) errors.push('spctl Gatekeeper assessment failed')

  const notarization = run('xcrun', ['stapler', 'validate', appPath])
  if (!notarization.ok) errors.push('notarization ticket validation failed')

  return {
    ok: errors.length === 0,
    errors,
    teamIdentifier: parsedDetails.teamIdentifier,
    authorities: parsedDetails.authorities,
  }
}

if (process.argv[1] && process.argv[1].endsWith('verify-mac-release.mjs')) {
  const result = verifyMacRelease(process.argv[2])
  if (!result.ok) {
    console.error('macOS release verification failed')
    for (const error of result.errors) console.error(`- ${error}`)
    process.exit(1)
  }
  console.log('macOS release verification passed')
  console.log(`- TeamIdentifier: ${result.teamIdentifier}`)
  console.log('- codesign, spctl, and notarization ticket validation passed')
}
