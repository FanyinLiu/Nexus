import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  openSidecarLog,
  SIDECAR_LOG_BACKUPS,
} from '../electron/services/sidecarLog.js'

function withTempDir(fn: (dir: string) => void) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-sidecar-log-'))
  try {
    fn(dir)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

test('a sidecar log rotates before it exceeds the byte cap', () => {
  withTempDir((dir) => {
    const logPath = path.join(dir, 'logs', 'voice-sidecar-qwen3Tts.log')
    fs.mkdirSync(path.dirname(logPath), { recursive: true })
    fs.writeFileSync(logPath, 'x'.repeat(64))

    const handle = openSidecarLog({ logPath, maxBytes: 32, backups: SIDECAR_LOG_BACKUPS })
    assert.ok(handle)
    handle.write('fresh')
    handle.close()

    assert.equal(fs.readFileSync(`${logPath}.1`, 'utf8'), 'x'.repeat(64))
    assert.equal(fs.readFileSync(logPath, 'utf8'), 'fresh')
  })
})

test('only the configured number of backups is kept', () => {
  withTempDir((dir) => {
    const logPath = path.join(dir, 'voice-sidecar-glmAsr.log')
    fs.writeFileSync(logPath, 'current')
    fs.writeFileSync(`${logPath}.1`, 'older-1')
    fs.writeFileSync(`${logPath}.2`, 'older-2')

    const handle = openSidecarLog({ logPath, maxBytes: 1, backups: 2 })
    assert.ok(handle)
    handle.close()

    assert.equal(fs.readFileSync(`${logPath}.1`, 'utf8'), 'current')
    assert.equal(fs.readFileSync(`${logPath}.2`, 'utf8'), 'older-1')
    assert.equal(fs.existsSync(`${logPath}.3`), false)
  })
})

test('the cap holds when a long-running sidecar keeps writing', () => {
  withTempDir((dir) => {
    const logPath = path.join(dir, 'voice-sidecar-omniVoice.log')
    const handle = openSidecarLog({ logPath, maxBytes: 8, backups: 2 })
    assert.ok(handle)

    handle.write('aaaa')
    handle.write('bbbb')
    handle.write('cccc')
    handle.write('dddd')
    handle.write('eeee')
    handle.close()

    assert.equal(fs.readFileSync(`${logPath}.2`, 'utf8'), 'aaaabbbb')
    assert.equal(fs.readFileSync(`${logPath}.1`, 'utf8'), 'ccccdddd')
    assert.equal(fs.readFileSync(logPath, 'utf8'), 'eeee')
    assert.equal(fs.existsSync(`${logPath}.3`), false)
  })
})

test('a writer that closed with the child ignores late stderr chunks', () => {
  withTempDir((dir) => {
    const logPath = path.join(dir, 'voice-sidecar-glmAsr.log')
    const handle = openSidecarLog({ logPath, maxBytes: 64 })
    assert.ok(handle)

    handle.write('before-exit')
    handle.close()
    handle.write('after-exit')

    assert.equal(fs.readFileSync(logPath, 'utf8'), 'before-exit')
  })
})

test('a write failure is swallowed so voice still starts', () => {
  withTempDir((dir) => {
    const logPath = path.join(dir, 'voice-sidecar-omniVoice.log')
    const fsImpl = {
      mkdirSync: fs.mkdirSync,
      statSync: fs.statSync,
      openSync: fs.openSync,
      closeSync: fs.closeSync,
      renameSync: fs.renameSync,
      unlinkSync: fs.unlinkSync,
      writeSync: () => { throw new Error('disk full') },
    } as unknown as typeof fs

    const handle = openSidecarLog({ logPath, maxBytes: 64, fsImpl })
    assert.ok(handle)
    assert.doesNotThrow(() => handle.write('diagnostic'))
    handle.close()
  })
})

test('a missing log path disables logging instead of blocking the sidecar', () => {
  assert.equal(openSidecarLog({ logPath: '' }), null)
})
