/**
 * Build/version identity checks for packaged sustained-runtime evidence.
 *
 * A runtime report is only trustworthy when the source tree, dist stamp, and
 * selected packaged artifact all describe the same build inputs.
 */

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { extractFile } from '@electron/asar'

import {
  computeBuildInputFingerprint,
  isValidBuildInputFingerprint,
} from '../build-fingerprint.mjs'

export const BUILD_INTEGRITY_RELATIVE_PATH = 'dist/build-integrity.json'
export const PACKAGE_JSON_RELATIVE_PATH = 'package.json'

function normalizeRelativePath(relativePath) {
  return relativePath.replace(/^[/\\]+/, '').replace(/\\/g, '/')
}

function parseJsonBuffer(buffer, source) {
  try {
    return { ok: true, value: JSON.parse(buffer.toString('utf8')) }
  } catch (error) {
    return {
      ok: false,
      error: `${source}: invalid JSON (${error instanceof Error ? error.message : String(error)})`,
    }
  }
}

function readJsonFile(filePath) {
  try {
    return parseJsonBuffer(readFileSync(filePath), filePath)
  } catch (error) {
    return {
      ok: false,
      error: `${filePath}: ${error instanceof Error ? error.message : String(error)}`,
    }
  }
}

function packagedRoots(appPath) {
  const absoluteAppPath = path.resolve(appPath)
  if (absoluteAppPath.endsWith('.asar')) {
    return [{ kind: 'asar', path: absoluteAppPath }]
  }

  if (absoluteAppPath.endsWith('.app')) {
    const resources = path.join(absoluteAppPath, 'Contents', 'Resources')
    return [
      { kind: 'directory', path: path.join(resources, 'app') },
      { kind: 'asar', path: path.join(resources, 'app.asar') },
    ]
  }

  const resources = path.join(absoluteAppPath, 'resources')
  return [
    { kind: 'directory', path: path.join(resources, 'app') },
    { kind: 'asar', path: path.join(resources, 'app.asar') },
    { kind: 'directory', path: path.join(absoluteAppPath, 'app') },
  ]
}

/** Read one file from an unpacked app directory or an app.asar archive. */
export function readPackagedArtifactFile(appPath, relativePath) {
  const normalizedPath = normalizeRelativePath(relativePath)
  const attempts = []

  for (const root of packagedRoots(appPath)) {
    if (root.kind === 'directory') {
      const filePath = path.join(root.path, normalizedPath)
      if (!existsSync(filePath)) {
        attempts.push(`${filePath}: missing`)
        continue
      }
      try {
        return {
          ok: true,
          kind: 'directory',
          source: filePath,
          data: readFileSync(filePath),
        }
      } catch (error) {
        attempts.push(`${filePath}: ${error instanceof Error ? error.message : String(error)}`)
        continue
      }
    }

    if (!existsSync(root.path)) {
      attempts.push(`${root.path}: missing`)
      continue
    }

    try {
      return {
        ok: true,
        kind: 'asar',
        source: `${root.path}:${normalizedPath}`,
        data: extractFile(root.path, normalizedPath),
      }
    } catch (error) {
      attempts.push(`${root.path}:${normalizedPath}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  return {
    ok: false,
    source: null,
    attempts,
    error: `packaged artifact file missing: ${normalizedPath}`,
  }
}

function readPackagedJson(appPath, relativePath) {
  const file = readPackagedArtifactFile(appPath, relativePath)
  if (!file.ok) return file
  const parsed = parseJsonBuffer(file.data, file.source)
  return {
    ...parsed,
    kind: file.kind,
    source: file.source,
    attempts: file.attempts,
  }
}

function fingerprintFromIntegrityStamp(stamp) {
  if (!stamp || typeof stamp !== 'object') return null
  if (
    stamp.schemaVersion !== 1
    || typeof stamp.algorithm !== 'string'
    || !/^[a-f0-9]{64}$/.test(stamp.inputFingerprint || '')
    || !Number.isInteger(stamp.inputFileCount)
    || stamp.inputFileCount < 0
  ) {
    return null
  }
  return {
    schemaVersion: stamp.schemaVersion,
    algorithm: stamp.algorithm,
    digest: stamp.inputFingerprint,
    fileCount: stamp.inputFileCount,
  }
}

function fingerprintMatches(left, right) {
  return Boolean(
    left
      && right
      && left.schemaVersion === right.schemaVersion
      && left.algorithm === right.algorithm
      && left.digest === right.digest
      && left.fileCount === right.fileCount,
  )
}

function summarizeFingerprint(fingerprint) {
  if (!fingerprint) return null
  return {
    schemaVersion: fingerprint.schemaVersion,
    algorithm: fingerprint.algorithm,
    digest: fingerprint.digest,
    fileCount: fingerprint.fileCount,
  }
}

function compareFingerprint(label, expected, actual, errors) {
  if (!actual) {
    errors.push({
      metric: `${label}Fingerprint`,
      actual: 'missing_or_invalid',
      budget: summarizeFingerprint(expected) ?? 'valid',
    })
    return false
  }
  if (!expected || !fingerprintMatches(expected, actual)) {
    errors.push({
      metric: `${label}Fingerprint`,
      actual: summarizeFingerprint(actual),
      budget: summarizeFingerprint(expected) ?? 'valid_source_fingerprint',
    })
    return false
  }
  return true
}

function readSourcePackage(root, errors) {
  const packagePath = path.join(root, PACKAGE_JSON_RELATIVE_PATH)
  const result = readJsonFile(packagePath)
  if (!result.ok) {
    errors.push({ metric: 'sourcePackageJson', actual: result.error, budget: 'readable' })
    return { packagePath, packageJson: null }
  }
  return { packagePath, packageJson: result.value }
}

/**
 * Verify the identity that a packaged runtime report is about to measure.
 * This function is intentionally read-only and returns structured failures so
 * the harness can write a failed report without launching a stale package.
 */
export function verifyPackagedRuntimeIdentity({ root, appPath }) {
  const errors = []
  const { packagePath, packageJson: sourcePackageJson } = readSourcePackage(root, errors)

  let sourceFingerprint = null
  try {
    sourceFingerprint = computeBuildInputFingerprint(root)
  } catch (error) {
    errors.push({
      metric: 'sourceBuildFingerprint',
      actual: error instanceof Error ? error.message : String(error),
      budget: 'computable',
    })
  }
  if (!isValidBuildInputFingerprint(sourceFingerprint)) {
    errors.push({
      metric: 'sourceBuildFingerprint',
      actual: sourceFingerprint ?? 'missing_or_invalid',
      budget: 'valid',
    })
  }

  const distIntegrityPath = path.join(root, 'dist', BUILD_INTEGRITY_RELATIVE_PATH.replace(/^dist\//, ''))
  const distResult = readJsonFile(distIntegrityPath)
  if (!distResult.ok) {
    errors.push({ metric: 'distBuildIntegrity', actual: distResult.error, budget: 'readable' })
  }
  const distIntegrity = distResult.ok ? distResult.value : null
  const distFingerprint = fingerprintFromIntegrityStamp(distIntegrity)

  const packagedIntegrityResult = readPackagedJson(appPath, BUILD_INTEGRITY_RELATIVE_PATH)
  if (!packagedIntegrityResult.ok) {
    errors.push({
      metric: 'packagedBuildIntegrity',
      actual: packagedIntegrityResult.error,
      budget: 'readable',
    })
  }
  const packagedIntegrity = packagedIntegrityResult.ok ? packagedIntegrityResult.value : null
  const packagedFingerprint = fingerprintFromIntegrityStamp(packagedIntegrity)

  const packagedPackageResult = readPackagedJson(appPath, PACKAGE_JSON_RELATIVE_PATH)
  if (!packagedPackageResult.ok) {
    errors.push({
      metric: 'packagedPackageJson',
      actual: packagedPackageResult.error,
      budget: 'readable',
    })
  }
  const packagedPackageJson = packagedPackageResult.ok ? packagedPackageResult.value : null

  const expectedFingerprint = isValidBuildInputFingerprint(sourceFingerprint)
    ? sourceFingerprint
    : null
  const distMatches = compareFingerprint('distBuildIntegrity', expectedFingerprint, distFingerprint, errors)
  const packagedMatches = compareFingerprint('packagedBuildIntegrity', expectedFingerprint, packagedFingerprint, errors)
  const allFingerprintsMatch = Boolean(distMatches && packagedMatches)

  const sourceVersion = typeof sourcePackageJson?.version === 'string'
    ? sourcePackageJson.version.trim()
    : ''
  const packagedVersion = typeof packagedPackageJson?.version === 'string'
    ? packagedPackageJson.version.trim()
    : ''
  if (!sourceVersion) {
    errors.push({ metric: 'sourceProductVersion', actual: sourceVersion || 'missing', budget: 'package.json version' })
  }
  if (!packagedVersion) {
    errors.push({ metric: 'packagedProductVersion', actual: packagedVersion || 'missing', budget: 'packaged package.json version' })
  } else if (sourceVersion && sourceVersion !== packagedVersion) {
    errors.push({ metric: 'productVersion', actual: packagedVersion, budget: sourceVersion })
  }

  return {
    ok: errors.length === 0,
    productVersion: sourceVersion || null,
    source: {
      packageJsonPath: packagePath,
      packageJsonVersion: sourceVersion || null,
      fingerprint: summarizeFingerprint(sourceFingerprint),
    },
    dist: {
      path: distIntegrityPath,
      integrity: distIntegrity,
      fingerprint: distFingerprint,
    },
    packaged: {
      appPath,
      packageJsonSource: packagedPackageResult.source ?? null,
      packageJsonVersion: packagedVersion || null,
      integritySource: packagedIntegrityResult.source ?? null,
      integrity: packagedIntegrity,
      fingerprint: packagedFingerprint,
    },
    comparisons: {
      sourceToDist: distMatches,
      sourceToPackaged: packagedMatches,
      allFingerprintsMatch,
      versionsMatch: Boolean(sourceVersion && packagedVersion && sourceVersion === packagedVersion),
    },
    errors,
  }
}
