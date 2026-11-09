import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { VOICE_SIDECAR_DEFINITIONS } from '../electron/services/voiceSidecarService.js'
import { resolveVoiceSidecarScriptPath } from '../electron/services/voiceSidecarPaths.js'

const QWEN3_SCRIPT = 'scripts/qwen3_tts_server.py'

/**
 * The packaged Python fallback can only start when the sidecar script is both
 * collected into the app and unpacked from asar. Python syntax tests prove the
 * file is valid, not that it ships.
 */
test('qwen3_tts_server.py ships in files and asarUnpack', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  const files: unknown = pkg?.build?.files
  const asarUnpack: unknown = pkg?.build?.asarUnpack
  assert.ok(Array.isArray(files), 'build.files must be an array')
  assert.ok(Array.isArray(asarUnpack), 'build.asarUnpack must be an array')
  assert.ok(files.includes(QWEN3_SCRIPT), 'build.files must collect qwen3_tts_server.py')
  assert.ok(asarUnpack.includes(QWEN3_SCRIPT), 'build.asarUnpack must unpack qwen3_tts_server.py')
})

test('the qwen3 sidecar definition names a script that exists in the repo', () => {
  assert.equal(VOICE_SIDECAR_DEFINITIONS.qwen3Tts.script, QWEN3_SCRIPT)
  assert.equal(existsSync(new URL(`../${QWEN3_SCRIPT}`, import.meta.url)), true)
})

test('packaged resolution reads app.asar.unpacked instead of the asar archive', () => {
  const resourcesPath = path.join(path.sep, 'Applications', 'Nexus.app', 'Contents', 'Resources')
  const expected = path.join(resourcesPath, 'app.asar.unpacked', QWEN3_SCRIPT)
  const checked: string[] = []

  const resolved = resolveVoiceSidecarScriptPath({
    isPackaged: true,
    resourcesPath,
    appRoot: path.join(path.sep, 'repo'),
    relativePath: QWEN3_SCRIPT,
    existsSync: (filePath: string) => {
      checked.push(filePath)
      return filePath === expected
    },
  })

  assert.equal(resolved, expected)
  assert.deepEqual(checked, [expected])
})

test('development resolution falls back to the repository copy', () => {
  const appRoot = path.join(path.sep, 'repo')
  const expected = path.join(appRoot, QWEN3_SCRIPT)

  const resolved = resolveVoiceSidecarScriptPath({
    isPackaged: false,
    resourcesPath: path.join(path.sep, 'Applications', 'Nexus.app', 'Contents', 'Resources'),
    appRoot,
    relativePath: QWEN3_SCRIPT,
    existsSync: (filePath: string) => filePath === expected,
  })

  assert.equal(resolved, expected)
})

test('a missing sidecar script resolves to null so the supervisor fails closed', () => {
  const resolved = resolveVoiceSidecarScriptPath({
    isPackaged: true,
    resourcesPath: path.join(path.sep, 'Applications', 'Nexus.app', 'Contents', 'Resources'),
    appRoot: path.join(path.sep, 'repo'),
    relativePath: QWEN3_SCRIPT,
    existsSync: () => false,
  })

  assert.equal(resolved, null)
})
