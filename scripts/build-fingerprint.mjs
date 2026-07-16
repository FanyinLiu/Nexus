#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

export const BUILD_FINGERPRINT_SCHEMA_VERSION = 1
export const BUILD_FINGERPRINT_ALGORITHM = 'sha256'

const SOURCE_DIRECTORIES = ['src', 'public', 'electron', 'scripts/communication-adapters']
const EXCLUDED_BUILD_INPUTS = new Set([
  // The downloader receipt contains an installation timestamp. The verified
  // model binary remains fingerprinted; its non-deterministic local receipt
  // must not make identical source/model inputs produce different provenance.
  'public/vendor/vad/.nexus-model.json',
])
const FIXED_BUILD_INPUTS = [
  'build/entitlements.mac.plist',
  'index.html',
  'vite.config.ts',
  'package.json',
  'package-lock.json',
  'scripts/build-fingerprint.mjs',
  'scripts/build.mjs',
  'scripts/minify-built-css.mjs',
  'scripts/electron-builder.smoke.cjs',
  'scripts/omnivoice_server.py',
  'scripts/glm_asr_server.py',
  'scripts/send-message-webhook.mjs',
]

function normalizePath(path) {
  return path.split('\\').join('/')
}

function walkFiles(root, relativeDirectory) {
  const absoluteDirectory = join(root, relativeDirectory)
  if (!existsSync(absoluteDirectory)) return []

  return readdirSync(absoluteDirectory, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name))
    .flatMap((entry) => {
      const relativePath = normalizePath(join(relativeDirectory, entry.name))
      if (entry.isDirectory()) return walkFiles(root, relativePath)
      return entry.isFile() && !EXCLUDED_BUILD_INPUTS.has(relativePath) ? [relativePath] : []
    })
}

export function collectBuildInputPaths(root = ROOT) {
  const paths = []

  for (const directory of SOURCE_DIRECTORIES) {
    paths.push(...walkFiles(root, directory))
  }

  for (const relativePath of FIXED_BUILD_INPUTS) {
    if (existsSync(join(root, relativePath))) paths.push(relativePath)
  }

  if (existsSync(root)) {
    paths.push(...readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isFile() && /^tsconfig.*\.json$/.test(entry.name))
      .map((entry) => entry.name))
  }

  return [...new Set(paths)].sort((left, right) => left.localeCompare(right))
}

export function computeBuildInputFingerprint(root = ROOT) {
  const inputPaths = collectBuildInputPaths(root)
  const hash = createHash(BUILD_FINGERPRINT_ALGORITHM)

  for (const relativePath of inputPaths) {
    const content = readFileSync(join(root, relativePath))
    hash.update(relativePath)
    hash.update('\0')
    hash.update(content)
    hash.update('\0')
  }

  return {
    schemaVersion: BUILD_FINGERPRINT_SCHEMA_VERSION,
    algorithm: BUILD_FINGERPRINT_ALGORITHM,
    digest: hash.digest('hex'),
    fileCount: inputPaths.length,
    inputPaths,
  }
}

export function isValidBuildInputFingerprint(value) {
  return Boolean(
    value
      && value.schemaVersion === BUILD_FINGERPRINT_SCHEMA_VERSION
      && value.algorithm === BUILD_FINGERPRINT_ALGORITHM
      && typeof value.digest === 'string'
      && /^[a-f0-9]{64}$/.test(value.digest)
      && Number.isInteger(value.fileCount)
      && value.fileCount >= 0,
  )
}

export function isBuildFingerprintStable(before, after) {
  return isValidBuildInputFingerprint(before)
    && isValidBuildInputFingerprint(after)
    && before.digest === after.digest
    && before.fileCount === after.fileCount
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null
if (invokedPath && resolve(fileURLToPath(import.meta.url)) === invokedPath) {
  const fingerprint = computeBuildInputFingerprint(ROOT)
  process.stdout.write(`${JSON.stringify(fingerprint, null, 2)}\n`)
}
