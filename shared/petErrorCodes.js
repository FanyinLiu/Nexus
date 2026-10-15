/**
 * Canonical pet-import IPC contract. Thrown failures carry a stable code
 * token because Electron drops `error.code`. Success results carry
 * `messageKey` + params so the renderer owns all user-facing copy.
 */

export const PET_IPC_ERROR_CODES = Object.freeze({
  ALREADY_IMPORTED: 'NEXUS_ERR_PET_ALREADY_IMPORTED',
  IMPORT_INCOMPLETE: 'NEXUS_ERR_PET_IMPORT_INCOMPLETE',
  UNSUPPORTED_FILE: 'NEXUS_ERR_PET_UNSUPPORTED_FILE',
  GALLERY_INPUT: 'NEXUS_ERR_PET_GALLERY_INPUT',
  GALLERY_FAILED: 'NEXUS_ERR_PET_GALLERY_FAILED',
  NETWORK: 'NEXUS_ERR_PET_NETWORK',
})

/** Success copy keys returned on pet-import IPC results. */
export const PET_IMPORT_MESSAGE_KEYS = Object.freeze({
  imported: 'settings.pet.success.imported',
  importedFrom: 'settings.pet.success.imported_from',
  sourceCommunityZip: 'settings.pet.success.source.community_zip',
})

const CODE_PATTERN = /NEXUS_ERR_PET_[A-Z_]+/

/** Build an Error whose message carries the stable pet-import code token. */
export function buildPetIpcError(code, { cause } = {}) {
  const error = new Error(code, cause ? { cause } : undefined)
  error.code = code
  return error
}

/** Pull the pet-import code token out of an IPC-wrapped or same-process error. */
export function extractPetIpcErrorCode(error) {
  const message = error instanceof Error ? error.message : String(error ?? '')
  const match = CODE_PATTERN.exec(message)
  return match ? match[0] : null
}
