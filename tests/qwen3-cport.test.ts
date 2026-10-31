import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  PARENT_DEATH_GUARD_SCRIPT,
  buildParentDeathGuardLaunch,
  buildQwen3CportArgs,
  buildQwen3CportBaseUrl,
  buildQwen3CportEnv,
  mapQwen3CportLanguage,
  resolveQwen3CportConfig,
} from '../electron/services/qwen3CportService.js'
import { buildQwen3CportRequestPayload } from '../electron/services/qwen3TtsPayload.js'
import { resolveQwen3TtsSeed } from '../electron/services/ttsSeed.js'

const HOME = '/Users/tester'

function existsIn(paths: string[]) {
  return (filePath: string) => paths.includes(filePath)
}

test('C engine is preferred only when both the binary and the checkpoint exist', () => {
  const binary = path.join(HOME, 'Models', 'qwen3-tts-c', 'src', 'qwen_tts')
  const model = path.join(HOME, 'Models', 'qwen3-tts', 'Qwen3-TTS-12Hz-1.7B-CustomVoice')

  const ready = resolveQwen3CportConfig({
    env: {},
    homedir: () => HOME,
    existsSync: existsIn([binary, model]),
  })
  assert.equal(ready.available, true)
  assert.equal(ready.binaryPath, binary)
  assert.equal(ready.modelDir, model)
  assert.deepEqual(ready.ports, [8003, 8004, 8005])

  const missingModel = resolveQwen3CportConfig({
    env: {},
    homedir: () => HOME,
    existsSync: existsIn([binary]),
  })
  assert.equal(missingModel.available, false)
  assert.match(String(missingModel.reason), /model/u)

  const disabled = resolveQwen3CportConfig({
    env: { NEXUS_QWEN3_CPORT_DISABLE: '1' },
    homedir: () => HOME,
    existsSync: () => true,
  })
  assert.equal(disabled.available, false)
  assert.match(String(disabled.reason), /disabled/u)

  const overridden = resolveQwen3CportConfig({
    env: {
      NEXUS_QWEN3_CPORT_BIN: '/custom/qwen_tts',
      NEXUS_QWEN3_CPORT_MODEL: '/custom/model',
      NEXUS_QWEN3_CPORT_PORT: '9000',
    },
    homedir: () => HOME,
    existsSync: () => true,
  })
  assert.equal(overridden.binaryPath, '/custom/qwen_tts')
  assert.equal(overridden.modelDir, '/custom/model')
  assert.deepEqual(overridden.ports, [9000])
})

test('C launch uses the fast Metal int4 resident-server recipe on loopback', () => {
  const config = { modelDir: '/models/qwen3' }
  assert.deepEqual(buildQwen3CportArgs(config, 8003), [
    '-d', '/models/qwen3',
    '--int4',
    '--backend', 'metal',
    '--serve', '8003',
    '--seed', '42',
  ])
  assert.equal(buildQwen3CportEnv({ PATH: '/bin' }).QWEN_METAL_FUSED_TALKER, '1')
  assert.equal(buildQwen3CportBaseUrl(8003), 'http://127.0.0.1:8003/v1')
})

test('language tags map to the C server full names, unknown tags stay absent', () => {
  assert.equal(mapQwen3CportLanguage('zh-CN'), 'Chinese')
  assert.equal(mapQwen3CportLanguage('zh-TW'), 'Chinese')
  assert.equal(mapQwen3CportLanguage('en-US'), 'English')
  assert.equal(mapQwen3CportLanguage('ja'), 'Japanese')
  assert.equal(mapQwen3CportLanguage('ko-KR'), 'Korean')
  assert.equal(mapQwen3CportLanguage('fr-FR'), 'French')
  assert.equal(mapQwen3CportLanguage('xx-YY'), undefined)
  assert.equal(mapQwen3CportLanguage(''), undefined)
})

test('parent-death guard is claimed only on POSIX', () => {
  const direct = buildParentDeathGuardLaunch('/bin/true', ['--x'], { platform: 'win32' })
  assert.deepEqual(direct, { command: '/bin/true', args: ['--x'], guarded: false })

  const guarded = buildParentDeathGuardLaunch('/bin/true', ['--x'], { platform: 'linux' })
  assert.equal(guarded.guarded, true)
  assert.equal(guarded.command, '/bin/sh')
})

test('C request body carries the whole text, one speaker, one seed, and a mild instruct', () => {
  const body = buildQwen3CportRequestPayload({
    voice: 'serena',
    characterId: 'char-a',
    instructions: '语气轻快一点。',
    language: 'zh-CN',
    rate: 1.2,
  }, '你好呀。今天天气不错。')

  assert.deepEqual(body, {
    text: '你好呀。今天天气不错。',
    speaker: 'serena',
    seed: resolveQwen3TtsSeed('char-a', 'serena'),
    language: 'Chinese',
    instruct: '语气轻快一点。',
  })
  // The named emotion recipe is intentionally not used for the C path.
  assert.equal('emotion' in body, false)
  assert.equal('input' in body, false)
})

test('parent-death guard kills the server when the parent pipe closes', {
  // The guard is a /bin/sh construct; Windows launches the server unguarded,
  // so there is no pipe to close and nothing to observe here.
  skip: process.platform === 'win32'
    ? 'POSIX-only /bin/sh parent-death guard; Windows has no guard yet'
    : false,
}, async () => {
  assert.match(PARENT_DEATH_GUARD_SCRIPT, /cat >\/dev\/null/u)

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-cport-guard-'))
  const pidFile = path.join(dir, 'server.pid')
  const fakeServer = "require('node:fs').writeFileSync(process.argv[1], String(process.pid)); setInterval(() => {}, 1000)"
  const launch = buildParentDeathGuardLaunch(process.execPath, ['-e', fakeServer, pidFile])

  const guard = spawn(launch.command, launch.args, {
    stdio: ['pipe', 'ignore', 'ignore'],
  })

  const waitFor = async (predicate: () => boolean, timeoutMs = 3_000) => {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      if (predicate()) return true
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
    return false
  }

  try {
    assert.equal(await waitFor(() => fs.existsSync(pidFile)), true, 'fake server did not start')
    const serverPid = Number(fs.readFileSync(pidFile, 'utf8'))
    assert.ok(Number.isInteger(serverPid) && serverPid > 0)
    assert.doesNotThrow(() => process.kill(serverPid, 0))

    // Closing the parent side of the pipe is what an Electron crash does.
    guard.stdin.end()

    assert.equal(await waitFor(() => {
      try {
        process.kill(serverPid, 0)
        return false
      } catch {
        return true
      }
    }), true, 'guarded server survived the parent')
  } finally {
    try { guard.kill('SIGKILL') } catch { /* already gone */ }
    try {
      const serverPid = Number(fs.readFileSync(pidFile, 'utf8'))
      process.kill(serverPid, 'SIGKILL')
    } catch { /* already gone */ }
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
