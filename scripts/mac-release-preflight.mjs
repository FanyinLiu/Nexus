#!/usr/bin/env node

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..')
export const REQUIRED_MAC_RELEASE_ENV = [
  'CSC_LINK',
  'CSC_KEY_PASSWORD',
  'APPLE_API_KEY',
  'APPLE_API_KEY_ID',
  'APPLE_API_ISSUER',
]

export function validateMacReleaseEnvironment(env = process.env) {
  const missing = REQUIRED_MAC_RELEASE_ENV.filter((name) => !String(env[name] ?? '').trim())
  const errors = []

  if (missing.length) {
    errors.push(`missing required signing/notarization environment: ${missing.join(', ')}`)
  }
  if (String(env.CSC_IDENTITY_AUTO_DISCOVERY ?? '').trim().toLowerCase() === 'false') {
    errors.push('CSC_IDENTITY_AUTO_DISCOVERY=false is forbidden for a signed macOS release')
  }
  if (String(env.SMOKE_TEST ?? '').trim() === '1') {
    errors.push('SMOKE_TEST=1 is only valid for the unsigned packaged smoke path')
  }

  return { ok: errors.length === 0, missing, errors }
}

export function validateMacBuildConfig(pkg) {
  const mac = pkg?.build?.mac ?? {}
  const errors = []
  if (mac.hardenedRuntime !== true) errors.push('build.mac.hardenedRuntime must be true')
  if (mac.gatekeeperAssess === false) errors.push('build.mac.gatekeeperAssess must not be false')
  if (mac.notarize !== true) errors.push('build.mac.notarize must be true')
  return { ok: errors.length === 0, errors }
}

export function runMacReleasePreflight(root = ROOT, env = process.env) {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  const environment = validateMacReleaseEnvironment(env)
  const build = validateMacBuildConfig(pkg)
  const errors = [...environment.errors, ...build.errors]

  if (errors.length) {
    console.error('macOS release preflight failed')
    for (const error of errors) console.error(`- ${error}`)
    console.error('No installer was built; the unsigned smoke path is separate.')
    return { ok: false, errors }
  }

  console.log('macOS release preflight passed')
  console.log(`- signing environment present: ${REQUIRED_MAC_RELEASE_ENV.join(', ')}`)
  console.log('- hardened runtime, Gatekeeper assessment, and notarization enabled')
  return { ok: true, errors: [] }
}

const isMain = process.argv[1]
  && pathToFileURL(fileURLToPath(import.meta.url)).href === pathToFileURL(process.argv[1]).href

if (isMain) process.exit(runMacReleasePreflight().ok ? 0 : 1)
