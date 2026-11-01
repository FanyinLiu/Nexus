// Small filesystem helpers shared by the main-process services.
// readJsonFile tolerates a UTF-8 BOM because several callers parse
// user-supplied files (pet packages, Live2D models).

import fs from 'node:fs/promises'

/**
 * @param {import('node:fs').PathLike} targetPath
 * @returns {Promise<boolean>}
 */
export async function pathExists(targetPath) {
  try {
    await fs.access(targetPath)
    return true
  } catch {
    return false
  }
}

/**
 * @param {import('node:fs').PathLike} filePath
 * @returns {Promise<unknown>}
 */
export async function readJsonFile(filePath) {
  const rawFile = await fs.readFile(filePath, 'utf8')
  return JSON.parse(rawFile.replace(/^\uFEFF/, ''))
}
