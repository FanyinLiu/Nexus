/**
 * Live2D import guard for private Codex application bundles.
 *
 * Community files and a user's own model folder stay allowed. The thrown
 * failure is a stable pet-import code so the renderer owns the copy.
 */
import path from 'node:path'
import {
  PET_IPC_ERROR_CODES,
  buildPetIpcError,
} from '../../shared/petErrorCodes.js'

const PRIVATE_CODEX_APP_PATH_PATTERNS = [
  /(?:^|\/)Codex\.app(?:\/|$)/iu,
  /(?:^|\/)app\.asar(?:\/|$)/iu,
  /(?:^|\/)app\.asar\.unpacked(?:\/|$)/iu,
  /(?:^|\/)codex-app(?:\/|$)/iu,
]

const EXTRACTED_CODEX_APP_ASSET_PATTERNS = [
  /^codex-spritesheet[-_.]/iu,
  /^codex-avatar[-_.]/iu,
  /^avatar-(?:mascot|overlay|options)[-_.]/iu,
  /^use-avatar-options[-_.]/iu,
]

/**
 * @param {unknown} value
 * @returns {string}
 */
function normalizePolicyPath(value) {
  return String(value ?? '').replaceAll('\\', '/')
}

/**
 * Explain why a path must not be copied, or return an empty string when it is allowed.
 * @param {unknown} sourcePath
 * @returns {string}
 */
export function getPrivateCodexPetSourceReason(sourcePath) {
  const normalizedPath = normalizePolicyPath(path.resolve(String(sourcePath ?? '')))
  const baseName = path.basename(normalizedPath)

  if (PRIVATE_CODEX_APP_PATH_PATTERNS.some((pattern) => pattern.test(normalizedPath))) {
    return 'source is inside a Codex application bundle or app.asar extraction'
  }

  if (EXTRACTED_CODEX_APP_ASSET_PATTERNS.some((pattern) => pattern.test(baseName))) {
    return 'source looks like an extracted Codex built-in pet asset'
  }

  return ''
}

/**
 * Reject a Live2D import whose source is a private Codex bundle or extracted built-in asset.
 * @param {unknown} sourcePath
 */
export function assertNotPrivateCodexPetSource(sourcePath) {
  if (getPrivateCodexPetSourceReason(sourcePath)) {
    throw buildPetIpcError(PET_IPC_ERROR_CODES.UNSUPPORTED_FILE)
  }
}
