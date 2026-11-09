/**
 * Path resolution for bundled Python voice sidecars.
 *
 * Packaged builds must use `app.asar.unpacked` because `child_process`
 * bypasses Electron's asar shim and can only execute real files; development
 * builds read the repository copy. Keeping the rule here lets packaging tests
 * exercise the exact logic without booting Electron.
 */

import path from 'node:path'

/**
 * Resolve a bundled Python sidecar script for the current build shape.
 *
 * @param {{
 *   isPackaged: boolean,
 *   resourcesPath: string,
 *   appRoot: string,
 *   relativePath: string,
 *   existsSync: (filePath: string) => boolean,
 * }} deps
 * @returns {string | null}
 */
export function resolveVoiceSidecarScriptPath(deps) {
  const existsSync = deps.existsSync
  if (deps.isPackaged) {
    const unpacked = path.join(deps.resourcesPath, 'app.asar.unpacked', deps.relativePath)
    if (existsSync(unpacked)) return unpacked
  }
  const devCandidate = path.join(deps.appRoot, deps.relativePath)
  return existsSync(devCandidate) ? devCandidate : null
}
