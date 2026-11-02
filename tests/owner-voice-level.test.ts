import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import {
  OWNER_VOICE_LEVEL_MAX_BACKLOG,
  createOwnerVoiceLevelProbe,
  rawRms,
} from '../src/features/voice/ownerVoiceLevel.ts'

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('owner voice level probe', () => {
  test('reports the isolated level and resets only the first frame', async () => {
    const seen: Array<{ reset?: boolean }> = []
    const levels: number[] = []
    const probe = createOwnerVoiceLevelProbe(async (payload) => {
      seen.push({ reset: payload.reset })
      return { rms: 0.01, isolated: true }
    }, (rms) => levels.push(rms))

    probe.push(new Float32Array([0.5, -0.5]))
    probe.push(new Float32Array([0.5, -0.5]))
    await flush()
    await flush()
    assert.deepEqual(seen, [{ reset: true }, { reset: false }])
    assert.deepEqual(levels, [0.01, 0.01])
  })

  test('falls back to the raw level when the main process passes audio through', async () => {
    const levels: number[] = []
    const frame = new Float32Array([0.5, -0.5])
    const probe = createOwnerVoiceLevelProbe(async () => ({ rms: 0, isolated: false }), (rms) => levels.push(rms))
    probe.push(frame)
    await flush()
    assert.deepEqual(levels, [rawRms(frame)])
  })

  test('falls back to the raw level when the IPC call fails', async () => {
    const levels: number[] = []
    const frame = new Float32Array([0.3, -0.3])
    const probe = createOwnerVoiceLevelProbe(async () => { throw new Error('gone') }, (rms) => levels.push(rms))
    probe.push(frame)
    await flush()
    assert.equal(levels.length, 1)
    assert.ok(Math.abs(levels[0] - 0.3) < 1e-6)
  })

  test('drops the backlog and starts a fresh stream when the main process lags', async () => {
    const resets: boolean[] = []
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const probe = createOwnerVoiceLevelProbe(async (payload) => {
      resets.push(payload.reset === true)
      await gate
      return { rms: 0.02, isolated: true }
    }, () => undefined)

    for (let i = 0; i < OWNER_VOICE_LEVEL_MAX_BACKLOG + 2; i += 1) probe.push(new Float32Array([0.1]))
    release()
    for (let i = 0; i < 10; i += 1) await flush()
    assert.equal(resets.length, OWNER_VOICE_LEVEL_MAX_BACKLOG)

    probe.push(new Float32Array([0.1]))
    for (let i = 0; i < 3; i += 1) await flush()
    assert.equal(resets.at(-1), true, 'the frame after a gap opens a new stream')
  })

  test('stops reporting after dispose', async () => {
    const levels: number[] = []
    const probe = createOwnerVoiceLevelProbe(async () => ({ rms: 0.5, isolated: true }), (rms) => levels.push(rms))
    probe.push(new Float32Array([0.1]))
    probe.dispose()
    probe.push(new Float32Array([0.1]))
    await flush()
    assert.deepEqual(levels, [])
  })
})
