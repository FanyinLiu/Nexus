/**
 * Pure key-vault policy decisions.
 *
 * Kept separate from keyVault.js so the security rules can be tested without
 * Electron. Two rules fail closed:
 *   1. SMOKE_TEST never enables plaintext storage in a packaged build. Only an
 *      unpackaged dev run or the smoke build's baked flag may do that.
 *   2. A packaged Linux app with a non-keyring safeStorage backend
 *      (basic_text/unknown) must refuse writes instead of storing secrets in
 *      effective plaintext.
 */

/** safeStorage Linux backends that are backed by a real system keyring. */
export const SECURE_LINUX_STORAGE_BACKENDS = Object.freeze([
  'gnome_libsecret',
  'kwallet',
  'kwallet5',
  'kwallet6',
])

/**
 * @param {unknown} backend
 * @returns {boolean}
 */
export function isSecureLinuxStorageBackend(backend) {
  return typeof backend === 'string'
    && SECURE_LINUX_STORAGE_BACKENDS.includes(backend)
}

/**
 * Plaintext storage is allowed only for unpackaged development or a packaged
 * build that baked the smoke flag into its own package.json. Environment
 * variables deliberately do not participate.
 * @param {{ isPackaged: boolean, smokeBuild: boolean }} input
 * @returns {boolean}
 */
export function isPlaintextModeAllowed({ isPackaged, smokeBuild }) {
  return !isPackaged || smokeBuild === true
}

/**
 * Decide whether vault writes may use safeStorage.
 * @param {{
 *   plaintextMode: boolean,
 *   platform: string,
 *   storageBackend: string,
 *   encryptionAvailable: boolean,
 * }} input
 * @returns {boolean}
 */
export function isEncryptionWritable({
  plaintextMode,
  platform,
  storageBackend,
  encryptionAvailable,
}) {
  if (plaintextMode) return true
  if (!encryptionAvailable) return false
  if (platform === 'linux') return isSecureLinuxStorageBackend(storageBackend)
  return true
}
