// Gate that lets an electron-updater `update-available` event download only
// after the channel manifest signature verified. The gate also remembers the
// verified version so the explicit install path can refuse a downloaded update
// that was never verified in this process.
//
// Dependency-injected and side-effect free so the security decision can be
// unit-tested without Electron or a network.

/**
 * @typedef {{ ok: true } | { ok: false, reason?: string }} ManifestVerifyResult
 * @typedef {{
 *   verifyManifest: (input: {
 *     updateInfo: unknown,
 *     tag: string | null,
 *     platform: string,
 *     arch: string,
 *   }) => Promise<ManifestVerifyResult>,
 *   downloadUpdate: () => Promise<unknown>,
 *   onRefused?: (input: { version: string | null, reason: string }) => void,
 *   onDownloadError?: (error: unknown) => void,
 *   platform?: string,
 *   arch?: string,
 * }} VerifiedUpdateGateDeps
 */

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function normalizeVersion(value) {
  if (typeof value !== 'string') return null
  const text = value.trim()
  return text ? text : null
}

/**
 * Build the verify-before-download gate used by the updater service.
 * @param {VerifiedUpdateGateDeps} deps
 */
export function createVerifiedUpdateGate(deps) {
  if (!deps || typeof deps.verifyManifest !== 'function' || typeof deps.downloadUpdate !== 'function') {
    throw new Error('createVerifiedUpdateGate requires verifyManifest and downloadUpdate')
  }
  const platform = typeof deps.platform === 'string' ? deps.platform : process.platform
  const arch = typeof deps.arch === 'string' ? deps.arch : process.arch
  /** @type {string | null} */
  let verifiedVersion = null
  let generation = 0

  /**
   * Verify one available update, then start the download only on success.
   * A newer event invalidates an older in-flight verification.
   * @param {{ version?: unknown, tag?: unknown } | null | undefined} updateInfo
   */
  async function handleUpdateAvailable(updateInfo) {
    const version = normalizeVersion(updateInfo?.version)
    const currentGeneration = ++generation
    if (!version) {
      verifiedVersion = null
      deps.onRefused?.({ version: null, reason: 'missing-version' })
      return { ok: false, reason: 'missing-version' }
    }

    let result
    try {
      result = await deps.verifyManifest({
        updateInfo,
        tag: normalizeVersion(updateInfo?.tag),
        platform,
        arch,
      })
    } catch {
      result = { ok: false, reason: 'verification-error' }
    }

    if (currentGeneration !== generation) return { ok: false, reason: 'superseded' }
    if (!result || result.ok !== true) {
      verifiedVersion = null
      const reason = typeof result?.reason === 'string' && result.reason
        ? result.reason
        : 'verification-failed'
      deps.onRefused?.({ version, reason })
      return { ok: false, reason }
    }

    verifiedVersion = version
    try {
      await deps.downloadUpdate()
    } catch (error) {
      verifiedVersion = null
      deps.onDownloadError?.(error)
      return { ok: false, reason: 'download-failed' }
    }
    return { ok: true, version }
  }

  /**
   * @param {unknown} version
   */
  function isVerified(version) {
    const normalized = normalizeVersion(version)
    return normalized !== null && normalized === verifiedVersion
  }

  function reset() {
    verifiedVersion = null
    generation += 1
  }

  return {
    handleUpdateAvailable,
    isVerified,
    reset,
    getVerifiedVersion: () => verifiedVersion,
  }
}
