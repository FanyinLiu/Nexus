/**
 * Path resolution for bundled Python voice sidecars.
 *
 * Packaged builds must use `app.asar.unpacked` because `child_process`
 * bypasses Electron's asar shim and can only execute real files; development
 * builds read the repository copy. Keeping the rule here lets packaging tests
 * exercise the exact logic without booting Electron.
 */

import path from 'node:path'

// `app.asar.unpacked` is a real sibling directory, not an archive, so only a
// segment that ends in `.asar` marks a path as being inside the archive.
const ASAR_ARCHIVE_SEGMENT_PATTERN = /\.asar$/iu

/**
 * Detect a path that lives inside an asar archive.
 *
 * Electron patches `fs` so `existsSync` reports true for archive members, but
 * `child_process` receives the raw path and cannot execute a file that only
 * exists inside the archive. Both separator styles are accepted so Windows
 * install paths are classified correctly on any host.
 *
 * @param {unknown} filePath
 * @returns {boolean}
 */
export function isPathInsideAsar(filePath) {
  if (typeof filePath !== 'string' || filePath.length === 0) return false
  return filePath
    .split(/[\\/]+/u)
    .some((segment) => ASAR_ARCHIVE_SEGMENT_PATTERN.test(segment))
}

/**
 * Resolve a bundled Python sidecar script for the current build shape.
 *
 * An `existsSync` hit inside an asar archive is not runnable, so it resolves
 * to `null` (and reports an actionable warning) exactly like a missing file.
 *
 * @param {{
 *   isPackaged: boolean,
 *   resourcesPath: string,
 *   appRoot: string,
 *   relativePath: string,
 *   existsSync: (filePath: string) => boolean,
 *   warn?: (message: string) => void,
 * }} deps
 * @returns {string | null}
 */
export function resolveVoiceSidecarScriptPath(deps) {
  const existsSync = deps.existsSync
  if (deps.isPackaged) {
    const unpacked = path.join(deps.resourcesPath, 'app.asar.unpacked', deps.relativePath)
    if (existsSync(unpacked) && !isPathInsideAsar(unpacked)) return unpacked
  }
  const candidate = path.join(deps.appRoot, deps.relativePath)
  if (!existsSync(candidate)) return null
  if (isPathInsideAsar(candidate)) {
    deps.warn?.(
      `[VoiceSidecar] ${deps.relativePath} was found inside an asar archive, which child_process cannot execute. `
      + `Repackage so build.asarUnpack includes ${deps.relativePath} and the script lands in app.asar.unpacked.`,
    )
    return null
  }
  return candidate
}
