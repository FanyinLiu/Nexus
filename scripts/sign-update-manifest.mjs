#!/usr/bin/env node

// Sign or verify detached Ed25519 signatures on electron-updater channel
// manifests (`latest.yml`, `latest-linux*.yml`).
//
// The private key is read only from NEXUS_UPDATE_SIGNING_KEY and is never
// printed, echoed, or written to disk. Verification uses the public key
// embedded in electron/services/updateSigningKey.js so CI and the runtime
// share one trust root.

import { createPrivateKey, sign } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { verifyDetachedManifestSignature } from '../electron/services/updateManifestSignature.js'
import { UPDATE_SIGNING_PUBLIC_KEY_PEM } from '../electron/services/updateSigningKey.js'

/** Environment variable that carries the Ed25519 PKCS8 private key. */
export const UPDATE_SIGNING_KEY_ENV = 'NEXUS_UPDATE_SIGNING_KEY'

/**
 * @param {string} manifestPath
 * @returns {string}
 */
function signaturePathFor(manifestPath) {
  return `${manifestPath}.sig`
}

/**
 * @param {unknown} privateKeyPem
 * @returns {import('node:crypto').KeyObject}
 */
function parsePrivateKey(privateKeyPem) {
  if (privateKeyPem && typeof privateKeyPem === 'object' && privateKeyPem.type === 'private') {
    const key = /** @type {import('node:crypto').KeyObject} */ (privateKeyPem)
    if (key.asymmetricKeyType !== 'ed25519') {
      throw new Error(`${UPDATE_SIGNING_KEY_ENV} must be an Ed25519 private key.`)
    }
    return key
  }
  if (typeof privateKeyPem !== 'string' || !privateKeyPem.trim()) {
    throw new Error(`${UPDATE_SIGNING_KEY_ENV} is missing or empty; refusing to sign update manifests.`)
  }
  if (!privateKeyPem.includes('-----BEGIN PRIVATE KEY-----')) {
    throw new Error(`${UPDATE_SIGNING_KEY_ENV} must be an unencrypted PKCS8 PEM private key.`)
  }
  let key
  try {
    key = createPrivateKey({ key: privateKeyPem, format: 'pem', type: 'pkcs8' })
  } catch {
    throw new Error(`${UPDATE_SIGNING_KEY_ENV} is not a valid PKCS8 PEM private key.`)
  }
  if (key.asymmetricKeyType !== 'ed25519') {
    throw new Error(`${UPDATE_SIGNING_KEY_ENV} must be an Ed25519 private key.`)
  }
  return key
}

/**
 * Read the signing key from an environment bag, without ever exposing it.
 * @param {Record<string, string | undefined>} [env]
 * @returns {import('node:crypto').KeyObject}
 */
export function readSigningKeyFromEnv(env = process.env) {
  return parsePrivateKey(env?.[UPDATE_SIGNING_KEY_ENV])
}

/**
 * Sign raw manifest bytes and return the single-line base64 signature.
 * @param {Buffer | Uint8Array | ArrayBuffer} manifestBytes
 * @param {unknown} privateKeyPem
 * @returns {string}
 */
export function signManifestBytes(manifestBytes, privateKeyPem) {
  const key = parsePrivateKey(privateKeyPem)
  const bytes = Buffer.isBuffer(manifestBytes)
    ? manifestBytes
    : manifestBytes instanceof Uint8Array
      ? Buffer.from(manifestBytes)
      : Buffer.from(manifestBytes)
  return sign(null, bytes, key).toString('base64')
}

/**
 * Write `<manifest>.sig` next to the manifest.
 * @param {string} manifestPath
 * @param {unknown} privateKeyPem
 * @returns {{ signaturePath: string, signature: string }}
 */
export function signManifestFile(manifestPath, privateKeyPem) {
  const signature = signManifestBytes(readFileSync(manifestPath), privateKeyPem)
  const signaturePath = signaturePathFor(manifestPath)
  writeFileSync(signaturePath, `${signature}\n`)
  return { signaturePath, signature }
}

/**
 * Verify `<manifest>.sig` with the embedded public key by default.
 * @param {string} manifestPath
 * @param {unknown} [publicKeyPem]
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
export function verifyManifestFile(manifestPath, publicKeyPem = UPDATE_SIGNING_PUBLIC_KEY_PEM) {
  let signatureBase64
  try {
    signatureBase64 = readFileSync(signaturePathFor(manifestPath), 'utf8')
  } catch {
    return { ok: false, reason: 'missing-signature' }
  }
  return verifyDetachedManifestSignature({
    manifestBytes: readFileSync(manifestPath),
    signatureBase64,
    publicKeyPem,
  })
}

/**
 * @param {string[]} argv
 * @returns {{ verify: boolean, manifests: string[] }}
 */
export function parseSignUpdateManifestArgs(argv) {
  let verify = false
  const manifests = []
  for (const argument of argv) {
    if (argument === '--verify') {
      if (verify) throw new Error('--verify may only be provided once')
      verify = true
    } else if (argument.startsWith('--')) {
      throw new Error(`unknown argument: ${argument}`)
    } else if (argument.trim()) {
      manifests.push(argument)
    }
  }
  if (manifests.length === 0) throw new Error('at least one manifest path is required')
  return { verify, manifests }
}

function main(argv) {
  let args
  try {
    args = parseSignUpdateManifestArgs(argv)
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 2
    return
  }

  if (args.verify) {
    let failures = 0
    for (const manifestPath of args.manifests) {
      const result = verifyManifestFile(resolve(manifestPath))
      if (result.ok) {
        console.log(`Verified ${manifestPath}`)
      } else {
        console.error(`Verification failed for ${manifestPath}: ${result.reason}`)
        failures += 1
      }
    }
    if (failures > 0) process.exitCode = 1
    return
  }

  let privateKey
  try {
    privateKey = readSigningKeyFromEnv()
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
    return
  }

  for (const manifestPath of args.manifests) {
    try {
      signManifestFile(resolve(manifestPath), privateKey)
      console.log(`Signed ${manifestPath}`)
    } catch (error) {
      console.error(`Could not sign ${manifestPath}: ${error instanceof Error ? error.message : String(error)}`)
      process.exitCode = 1
    }
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null
if (invokedPath && resolve(fileURLToPath(import.meta.url)) === invokedPath) {
  main(process.argv.slice(2))
}
