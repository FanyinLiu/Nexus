// electron-rebuild only skips compiling libuiohook when it sees
// node.napi[.armvN].node. Those files are copies of uiohook-napi.node.
// Electron's require.addon (what node-gyp-build uses inside the app) loads
// node.napi.node. afterPack drops the other name so the installer does not
// ship the same binary twice. The source tree keeps both, because the next
// rebuild still looks for the napi alias.

const { readdirSync, realpathSync, rmSync, statSync } = require('node:fs')
const { join } = require('node:path')

const ALIAS_NAME = /^node\.napi(?:\.armv[78])?\.node$/

/**
 * @param {string} dir
 * @param {string[]} found
 * @param {number} depth
 * @param {Set<string>} seen
 */
function findPrebuildDirs(dir, found, depth = 0, seen = new Set()) {
  if (depth > 10) return
  let real
  try {
    real = realpathSync(dir)
  } catch {
    return
  }
  if (seen.has(real)) return
  seen.add(real)
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const next = join(dir, entry.name)
    if (entry.name === 'prebuilds' && dir.endsWith(`${join('uiohook-napi')}`)) {
      found.push(next)
      continue
    }
    findPrebuildDirs(next, found, depth + 1, seen)
  }
}

/**
 * @param {string} prebuildsDir
 * @returns {string[]}
 */
function stripAliasCopies(prebuildsDir) {
  const removed = []
  let platforms
  try {
    platforms = readdirSync(prebuildsDir, { withFileTypes: true })
  } catch {
    return removed
  }
  for (const platform of platforms) {
    if (!platform.isDirectory()) continue
    const dir = join(prebuildsDir, platform.name)
    let files
    try {
      files = readdirSync(dir)
    } catch {
      continue
    }
    const alias = files.find((file) => ALIAS_NAME.test(file))
    if (!alias || !files.includes('uiohook-napi.node')) continue
    const target = join(dir, 'uiohook-napi.node')
    try {
      if (!statSync(target).isFile()) continue
      rmSync(target)
      removed.push(target)
    } catch {
      // A file that disappears mid-pack is not a reason to fail the build.
    }
  }
  return removed
}

/**
 * @param {{ appOutDir?: string }} context
 */
async function afterPack(context) {
  const root = context?.appOutDir
  if (!root) return
  const prebuildDirs = []
  findPrebuildDirs(root, prebuildDirs)
  const removed = prebuildDirs.flatMap((dir) => stripAliasCopies(dir))
  console.log(`[uiohook] removed ${removed.length} duplicate prebuild ${removed.length === 1 ? 'name' : 'names'}`)
}

module.exports = afterPack
module.exports.stripAliasCopies = stripAliasCopies
module.exports.ALIAS_NAME = ALIAS_NAME
