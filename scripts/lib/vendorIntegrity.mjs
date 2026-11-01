/**
 * Integrity helpers for files fetched by scripts/setup-vendor.mjs.
 *
 * The Cubism Core download is the only runtime vendor asset that comes from a
 * remote origin, so its exact bytes are pinned here. A mismatch is a hard
 * failure: the caller deletes the file and exits non-zero rather than shipping
 * an unverified Live2D runtime.
 */

import { createHash } from 'node:crypto'
import { readFileSync, statSync } from 'node:fs'

/** SHA-256 of the official live2dcubismcore.min.js this repository pins. */
export const CUBISM_CORE_SHA256 = '25ae938cb4fe282ce189b357bcc97e603d1e1f7ec78bf04150d401c23cdc792f'

export class VendorIntegrityError extends Error {
  /**
   * @param {string} message
   * @param {{ expectedSha256: string, actualSha256: string, fileLabel: string }} details
   */
  constructor(message, details) {
    super(message)
    this.name = 'VendorIntegrityError'
    this.expectedSha256 = details.expectedSha256
    this.actualSha256 = details.actualSha256
    this.fileLabel = details.fileLabel
  }
}

/**
 * @param {Buffer | Uint8Array | string} contents
 * @returns {string}
 */
export function sha256Contents(contents) {
  return createHash('sha256').update(contents).digest('hex')
}

/**
 * @param {string} filePath
 * @returns {string}
 */
export function sha256File(filePath) {
  return sha256Contents(readFileSync(filePath))
}

/**
 * Compare a buffer's digest with the pinned Cubism Core digest.
 * @param {Buffer | Uint8Array | string} contents
 * @param {string} [expectedSha256]
 * @returns {{ ok: boolean, actualSha256: string, expectedSha256: string }}
 */
export function checkCubismCoreContents(contents, expectedSha256 = CUBISM_CORE_SHA256) {
  const actualSha256 = sha256Contents(contents)
  return {
    ok: actualSha256 === expectedSha256,
    actualSha256,
    expectedSha256,
  }
}

/**
 * Compare an existing file's digest with the pinned Cubism Core digest.
 * @param {string} filePath
 * @param {string} [expectedSha256]
 * @returns {{ ok: boolean, actualSha256: string, expectedSha256: string, sizeBytes: number }}
 */
export function checkCubismCoreFile(filePath, expectedSha256 = CUBISM_CORE_SHA256) {
  const stats = statSync(filePath)
  return {
    ...checkCubismCoreContents(readFileSync(filePath), expectedSha256),
    sizeBytes: stats.size,
  }
}

/**
 * Build the actionable error text printed when a pinned vendor file does not
 * match. Kept separate from the throw so callers can include the file path.
 * @param {{ fileLabel: string, expectedSha256: string, actualSha256: string }} details
 * @returns {string}
 */
export function cubismCoreMismatchMessage({ fileLabel, expectedSha256, actualSha256 }) {
  return [
    `[vendor] ✗ ${fileLabel} SHA-256 mismatch`,
    `  expected: ${expectedSha256}`,
    `  actual:   ${actualSha256}`,
    '  The unverified file was deleted; refusing to ship an unverified Live2D runtime.',
    '  If Live2D published a new official build, update CUBISM_CORE_SHA256 in',
    '  scripts/lib/vendorIntegrity.mjs, then re-run: node scripts/setup-vendor.mjs',
  ].join('\n')
}

/**
 * Assert that a buffer matches the pin, throwing a VendorIntegrityError.
 * @param {Buffer | Uint8Array | string} contents
 * @param {string} fileLabel
 * @param {string} [expectedSha256]
 * @returns {{ ok: true, actualSha256: string, expectedSha256: string }}
 */
export function assertCubismCoreContents(contents, fileLabel, expectedSha256 = CUBISM_CORE_SHA256) {
  const result = checkCubismCoreContents(contents, expectedSha256)
  if (!result.ok) {
    throw new VendorIntegrityError(
      cubismCoreMismatchMessage({ fileLabel, ...result }),
      { fileLabel, expectedSha256, actualSha256: result.actualSha256 },
    )
  }
  return { ok: true, actualSha256: result.actualSha256, expectedSha256 }
}

/**
 * Assert that an existing file matches the pin, throwing a VendorIntegrityError.
 * @param {string} filePath
 * @param {string} fileLabel
 * @param {string} [expectedSha256]
 * @returns {{ ok: true, actualSha256: string, expectedSha256: string, sizeBytes: number }}
 */
export function assertCubismCoreFile(filePath, fileLabel, expectedSha256 = CUBISM_CORE_SHA256) {
  const result = checkCubismCoreFile(filePath, expectedSha256)
  if (!result.ok) {
    throw new VendorIntegrityError(
      cubismCoreMismatchMessage({ fileLabel, ...result }),
      { fileLabel, expectedSha256, actualSha256: result.actualSha256 },
    )
  }
  return { ...result, ok: true }
}
