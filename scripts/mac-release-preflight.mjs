#!/usr/bin/env node

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..')

export const FORBIDDEN_MAC_SIGNING_ENV = [
  'APPLE_ID',
  'APPLE_APP_SPECIFIC_PASSWORD',
  'APPLE_TEAM_ID',
  'APPLE_API_KEY',
  'APPLE_API_KEY_ID',
  'APPLE_API_ISSUER',
  'APPLE_KEYCHAIN_PROFILE',
  'CSC_LINK',
  'CSC_KEY_PASSWORD',
  'CSC_NAME',
]

const REQUIRED_MAC_RESOURCES = Object.freeze([
  Object.freeze({ from: 'sherpa-models', to: 'sherpa-models' }),
  Object.freeze({ from: 'public/vendor/vad/silero_vad_v5.onnx', to: 'silero_vad_v5.onnx' }),
])

const REQUIRED_ELECTRON_FUSES = Object.freeze({
  runAsNode: false,
  enableCookieEncryption: true,
  enableNodeOptionsEnvironmentVariable: false,
  enableNodeCliInspectArguments: false,
  enableEmbeddedAsarIntegrityValidation: true,
  onlyLoadAppFromAsar: true,
})

export function validateMacReleaseEnvironment(env = process.env) {
  const configuredSigningEnvironment = FORBIDDEN_MAC_SIGNING_ENV.filter((name) => String(env[name] ?? '').trim())
  const errors = []
  const autoDiscovery = String(env.CSC_IDENTITY_AUTO_DISCOVERY ?? '').trim().toLowerCase()

  if (configuredSigningEnvironment.length) {
    errors.push(`unsigned macOS release must not receive signing/notarization environment: ${configuredSigningEnvironment.join(', ')}`)
  }
  if (autoDiscovery && autoDiscovery !== 'false') {
    errors.push('CSC_IDENTITY_AUTO_DISCOVERY must be false when provided for an unsigned macOS release')
  }
  if (String(env.SMOKE_TEST ?? '').trim() === '1') {
    errors.push('SMOKE_TEST=1 is only valid for the separate packaged smoke path')
  }

  return { ok: errors.length === 0, configuredSigningEnvironment, errors }
}

export function validateMacBuildConfig(pkg) {
  const build = pkg?.build ?? {}
  const mac = build.mac ?? {}
  const errors = []

  if (build.productName !== 'Nexus') errors.push('build.productName must be Nexus')
  if (build.appId !== 'ai.factory.desktoppet') errors.push('build.appId must be ai.factory.desktoppet')
  if (build.forceCodeSigning !== false) errors.push('build.forceCodeSigning must be false')
  if (mac.identity !== '-') errors.push("build.mac.identity must be '-' for an explicit ad-hoc signature")
  if (mac.hardenedRuntime !== false) errors.push('build.mac.hardenedRuntime must be false')
  if (mac.gatekeeperAssess !== false) errors.push('build.mac.gatekeeperAssess must be false')
  if (mac.notarize !== false) errors.push('build.mac.notarize must be false')
  const extraResources = Array.isArray(mac.extraResources) ? mac.extraResources : []
  for (const requiredResource of REQUIRED_MAC_RESOURCES) {
    const matches = extraResources.filter(
      (resource) => resource?.from === requiredResource.from && resource?.to === requiredResource.to,
    )
    if (matches.length !== 1) {
      errors.push(
        `build.mac.extraResources must contain exactly one ${requiredResource.from} -> ${requiredResource.to} mapping`,
      )
    }
  }

  for (const [fuseName, requiredValue] of Object.entries(REQUIRED_ELECTRON_FUSES)) {
    if (build.electronFuses?.[fuseName] !== requiredValue) {
      errors.push(`build.electronFuses.${fuseName} must be ${requiredValue}`)
    }
  }

  return { ok: errors.length === 0, errors }
}

export function runMacReleasePreflight(root = ROOT, env = process.env) {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  const environment = validateMacReleaseEnvironment(env)
  const build = validateMacBuildConfig(pkg)
  const errors = [...environment.errors, ...build.errors]

  if (errors.length) {
    console.error('macOS unsigned release preflight failed')
    for (const error of errors) console.error(`- ${error}`)
    console.error('No installer was built; production identity and the smoke path remain isolated.')
    return { ok: false, errors }
  }

  console.log('macOS unsigned release preflight passed')
  console.log('- production Nexus identity and runtime resources preserved')
  console.log('- ad-hoc identity forced; hardened runtime, Gatekeeper assessment, and notarization disabled')
  console.log('- signing and notarization secrets absent')
  return { ok: true, errors: [] }
}

const isMain = process.argv[1]
  && pathToFileURL(fileURLToPath(import.meta.url)).href === pathToFileURL(process.argv[1]).href

if (isMain) process.exit(runMacReleasePreflight().ok ? 0 : 1)
