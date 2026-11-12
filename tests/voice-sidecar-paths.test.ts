import assert from 'node:assert/strict'
import path from 'node:path'
import test from 'node:test'

import { VOICE_SIDECAR_DEFINITIONS } from '../electron/services/voiceSidecarService.js'
import {
  isPathInsideAsar,
  resolveVoiceSidecarScriptPath,
} from '../electron/services/voiceSidecarPaths.js'

const QWEN3_SCRIPT = 'scripts/qwen3_tts_server.py'
const SIDECAR_SCRIPTS = Object.values(VOICE_SIDECAR_DEFINITIONS).map((definition) => definition.script)

function packagedLayout() {
  const resourcesPath = path.join(path.sep, 'Applications', 'Nexus.app', 'Contents', 'Resources')
  return {
    resourcesPath,
    appRoot: path.join(resourcesPath, 'app.asar'),
  }
}

/**
 * Electron's patched fs reports archive members as existing even though
 * child_process cannot execute them, so an asar hit must not win over the
 * real unpacked file (or over "missing").
 */
test('isPathInsideAsar recognizes POSIX and Windows archive segments', () => {
  assert.equal(
    isPathInsideAsar(path.posix.join('/Applications/Nexus.app/Contents/Resources', 'app.asar', 'scripts', 'qwen3_tts_server.py')),
    true,
  )
  assert.equal(
    isPathInsideAsar(path.win32.join('C:\\Program Files\\Nexus\\resources', 'app.asar', 'scripts', 'qwen3_tts_server.py')),
    true,
  )
  assert.equal(isPathInsideAsar('C:/Program Files/Nexus/resources/app.asar/scripts/qwen3_tts_server.py'), true)
  assert.equal(isPathInsideAsar('/Applications/Nexus.app/Contents/Resources/app.ASAR/scripts/qwen3_tts_server.py'), true)
})

test('isPathInsideAsar keeps app.asar.unpacked runnable', () => {
  assert.equal(
    isPathInsideAsar(path.posix.join('/Applications/Nexus.app/Contents/Resources', 'app.asar.unpacked', 'scripts', 'qwen3_tts_server.py')),
    false,
  )
  assert.equal(
    isPathInsideAsar(path.win32.join('C:\\Program Files\\Nexus\\resources', 'app.asar.unpacked', 'scripts', 'qwen3_tts_server.py')),
    false,
  )
  assert.equal(isPathInsideAsar(path.join(path.sep, 'repo', 'scripts', 'qwen3_tts_server.py')), false)
})

test('packaged resolution treats an asar-only sidecar as missing', () => {
  const { resourcesPath, appRoot } = packagedLayout()
  const unpacked = path.join(resourcesPath, 'app.asar.unpacked', QWEN3_SCRIPT)
  const asarPath = path.join(appRoot, QWEN3_SCRIPT)
  const checked: string[] = []

  const resolved = resolveVoiceSidecarScriptPath({
    isPackaged: true,
    resourcesPath,
    appRoot,
    relativePath: QWEN3_SCRIPT,
    // Mirrors a packaged install where only the archive member "exists".
    existsSync: (filePath: string) => {
      checked.push(filePath)
      return filePath === asarPath
    },
  })

  assert.equal(resolved, null)
  assert.deepEqual(checked, [unpacked, asarPath])
})

test('packaged resolution warns with an actionable asarUnpack hint', () => {
  const { resourcesPath, appRoot } = packagedLayout()
  const asarPath = path.join(appRoot, QWEN3_SCRIPT)
  const warnings: string[] = []

  const resolved = resolveVoiceSidecarScriptPath({
    isPackaged: true,
    resourcesPath,
    appRoot,
    relativePath: QWEN3_SCRIPT,
    existsSync: (filePath: string) => filePath === asarPath,
    warn: (message: string) => warnings.push(message),
  })

  assert.equal(resolved, null)
  assert.equal(warnings.length, 1)
  assert.match(warnings[0], /qwen3_tts_server\.py/u)
  assert.match(warnings[0], /app\.asar\.unpacked/u)
  assert.match(warnings[0], /asarUnpack/u)
})

/**
 * The warning is written to a log the user may share, so it must name the
 * script by its bundled relative path instead of leaking the install location
 * (which embeds the user's home directory on macOS and Windows).
 */
test('asar warning names the sidecar by relative path only', () => {
  const resourcesPath = path.join(path.sep, 'Users', 'synthetic-user', 'Applications', 'Nexus.app', 'Contents', 'Resources')
  const appRoot = path.join(resourcesPath, 'app.asar')
  const asarPath = path.join(appRoot, QWEN3_SCRIPT)
  const warnings: string[] = []

  const resolved = resolveVoiceSidecarScriptPath({
    isPackaged: true,
    resourcesPath,
    appRoot,
    relativePath: QWEN3_SCRIPT,
    existsSync: (filePath: string) => filePath === asarPath,
    warn: (message: string) => warnings.push(message),
  })

  assert.equal(resolved, null)
  assert.equal(warnings.length, 1)
  const warning = warnings[0]

  assert.ok(warning.includes(QWEN3_SCRIPT), 'warning must still point at the failing script')
  for (const leaked of [resourcesPath, appRoot, asarPath, path.dirname(asarPath), 'synthetic-user']) {
    assert.equal(warning.includes(leaked), false, `warning leaked an absolute path: ${leaked}`)
  }
  for (const token of warning.split(/\s+/u)) {
    assert.equal(path.posix.isAbsolute(token), false, `warning contains absolute path token: ${token}`)
    assert.equal(/^[A-Za-z]:[\\/]/u.test(token), false, `warning contains absolute path token: ${token}`)
  }
})

test('packaged resolution prefers app.asar.unpacked when both copies exist', () => {
  const { resourcesPath, appRoot } = packagedLayout()
  const unpacked = path.join(resourcesPath, 'app.asar.unpacked', QWEN3_SCRIPT)
  const asarPath = path.join(appRoot, QWEN3_SCRIPT)
  const warnings: string[] = []

  const resolved = resolveVoiceSidecarScriptPath({
    isPackaged: true,
    resourcesPath,
    appRoot,
    relativePath: QWEN3_SCRIPT,
    existsSync: (filePath: string) => filePath === unpacked || filePath === asarPath,
    warn: (message: string) => warnings.push(message),
  })

  assert.equal(resolved, unpacked)
  assert.deepEqual(warnings, [])
})

test('packaged resolution rejects an asar fallback for every bundled sidecar', () => {
  const { resourcesPath, appRoot } = packagedLayout()

  for (const relativePath of SIDECAR_SCRIPTS) {
    const asarPath = path.join(appRoot, relativePath)
    const resolved = resolveVoiceSidecarScriptPath({
      isPackaged: true,
      resourcesPath,
      appRoot,
      relativePath,
      existsSync: (filePath: string) => filePath === asarPath,
    })
    assert.equal(resolved, null, `${relativePath} must not resolve inside app.asar`)
  }
})

test('development resolution keeps using the repository copy', () => {
  const appRoot = path.join(path.sep, 'repo')
  const expected = path.join(appRoot, QWEN3_SCRIPT)
  const warnings: string[] = []

  const resolved = resolveVoiceSidecarScriptPath({
    isPackaged: false,
    resourcesPath: path.join(path.sep, 'Applications', 'Nexus.app', 'Contents', 'Resources'),
    appRoot,
    relativePath: QWEN3_SCRIPT,
    existsSync: (filePath: string) => filePath === expected,
    warn: (message: string) => warnings.push(message),
  })

  assert.equal(resolved, expected)
  assert.deepEqual(warnings, [])
})

test('development resolution also refuses a repository path inside an asar archive', () => {
  const appRoot = path.join(path.sep, 'tmp', 'bundle', 'app.asar')
  const asarPath = path.join(appRoot, QWEN3_SCRIPT)
  const warnings: string[] = []

  const resolved = resolveVoiceSidecarScriptPath({
    isPackaged: false,
    resourcesPath: path.join(path.sep, 'Applications', 'Nexus.app', 'Contents', 'Resources'),
    appRoot,
    relativePath: QWEN3_SCRIPT,
    existsSync: (filePath: string) => filePath === asarPath,
    warn: (message: string) => warnings.push(message),
  })

  assert.equal(resolved, null)
  assert.equal(warnings.length, 1)
})
