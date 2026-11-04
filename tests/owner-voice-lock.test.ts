import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, test } from 'node:test'

import {
  OWNER_VOICE_SAMPLE_RATE,
  countVoicedSeconds,
  createOnsetGate,
  createOwnerVoiceLock,
  gateResidual,
} from '../electron/services/ownerVoiceLock.js'
import { validateSamplesPayload } from '../electron/ipc/ownerVoicePayload.js'

type RunRequest = { samples: Float32Array; sampleRate: number; enableExternalBuffer?: boolean }

function tone(seconds: number, amplitude = 0.2): Float32Array {
  const out = new Float32Array(Math.round(seconds * OWNER_VOICE_SAMPLE_RATE))
  for (let i = 0; i < out.length; i += 1) out[i] = amplitude * Math.sin(i / 7)
  return out
}

/** A stand-in for sherpa's VoxLock denoiser: halves the input, records calls. */
function createFakeSherpa(options: { failRun?: boolean; failInit?: boolean } = {}) {
  const calls = { created: 0, runs: 0, resets: 0, configs: [] as unknown[] }
  class FakeDenoiser {
    constructor(config: unknown) {
      if (options.failInit) throw new Error('init failed')
      calls.created += 1
      calls.configs.push(config)
    }
    run(request: RunRequest) {
      calls.runs += 1
      if (options.failRun) throw new Error('run failed')
      return { samples: request.samples.map((value) => value / 2), sampleRate: request.sampleRate }
    }
    reset() {
      calls.resets += 1
    }
  }
  return {
    calls,
    sherpa: {
      OnlineSpeechDenoiser: FakeDenoiser,
      writeWave: (file: string, audio: { samples: Float32Array }) => {
        fs.writeFileSync(file, Buffer.from(audio.samples.buffer))
      },
    },
  }
}

let root = ''
let modelDir: string | null = null

function makeLock(sherpa: ReturnType<typeof createFakeSherpa>['sherpa'] | null) {
  return createOwnerVoiceLock({
    sherpa,
    getProfileDir: () => path.join(root, 'voice-lock'),
    findModelDir: () => modelDir,
    now: () => 1_700_000_000_000,
  })
}

function installModel() {
  modelDir = path.join(root, 'sherpa-onnx-voxlock-int8')
  fs.mkdirSync(modelDir, { recursive: true })
  fs.writeFileSync(path.join(modelDir, 'enroll.onnx'), '')
  fs.writeFileSync(path.join(modelDir, 'chunk_int8.onnx'), '')
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'owner-voice-'))
  modelDir = null
})

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true })
})

describe('owner voice lock', () => {
  test('counts only frames loud enough to be speech', () => {
    const quiet = tone(5, 0.001)
    assert.equal(countVoicedSeconds(quiet), 0)
    const mixed = new Float32Array(OWNER_VOICE_SAMPLE_RATE * 4)
    mixed.set(tone(2), 0)
    assert.ok(Math.abs(countVoicedSeconds(mixed) - 2) < 0.05)
  })

  test('passes audio through untouched until enabled, enrolled and installed', () => {
    const { sherpa, calls } = createFakeSherpa()
    const lock = makeLock(sherpa)
    const input = tone(0.128)

    assert.equal(lock.process('vad', input).isolated, false)
    lock.setEnabled(true)
    assert.equal(lock.process('vad', input).samples, input, 'no model, no sample: raw audio')
    installModel()
    assert.equal(lock.process('vad', input).isolated, false, 'no sample yet')
    assert.equal(calls.created, 0)
    assert.deepEqual(
      { active: lock.getStatus().active, enrolled: lock.getStatus().enrolled, modelInstalled: lock.getStatus().modelInstalled },
      { active: false, enrolled: false, modelInstalled: true },
    )
  })

  test('enrolls a voiced sample and isolates through one shared stream', () => {
    const { sherpa, calls } = createFakeSherpa()
    installModel()
    const lock = makeLock(sherpa)
    lock.setEnabled(true)

    const enrolled = lock.enroll(tone(4))
    assert.deepEqual(enrolled, { ok: true, reason: null, voicedSeconds: 4 })
    const status = lock.getStatus()
    assert.equal(status.active, true)
    assert.equal(status.enrolledAt, 1_700_000_000_000)

    const input = tone(0.128)
    const vad = lock.process('vad', input)
    assert.equal(vad.isolated, true)
    assert.ok(Math.abs(vad.samples[10] - input[10] / 2) < 1e-6)
    lock.process('vad', input)
    lock.process('interrupt', input)
    assert.equal(calls.created, 1, 'one model instance for every channel')
    assert.equal(calls.resets, 1, 'switching channel resets the stream')

    // Speech after a quiet gap starts from fresh model state.
    const before = calls.resets
    lock.process('interrupt', tone(0.5, 0.001))
    lock.process('interrupt', tone(0.128))
    assert.equal(calls.resets, before + 1)

    const config = calls.configs[0] as { model: { voxlock: { voiceSample: string } } }
    assert.equal(config.model.voxlock.voiceSample, path.join(root, 'voice-lock', 'owner-voice.wav'))
  })

  test('refuses a silent, short or overlong sample and keeps nothing', () => {
    const { sherpa } = createFakeSherpa()
    installModel()
    const lock = makeLock(sherpa)
    assert.equal(lock.enroll(tone(2)).reason, 'too_short')
    assert.equal(lock.enroll(tone(6, 0.001)).reason, 'too_quiet')
    assert.equal(lock.enroll(tone(31)).reason, 'too_long')
    assert.equal(lock.getStatus().enrolled, false)
  })

  test('reports unsupported on a sherpa build without VoxLock', () => {
    installModel()
    const lock = makeLock(null)
    lock.setEnabled(true)
    assert.equal(lock.enroll(tone(4)).reason, 'unsupported')
    assert.equal(lock.getStatus().supported, false)
    assert.equal(lock.getStatus().active, false)
  })

  test('fails open when the model throws, and recovers after a new sample', () => {
    const failing = createFakeSherpa({ failRun: true })
    installModel()
    const lock = makeLock(failing.sherpa)
    lock.setEnabled(true)
    lock.enroll(tone(4))

    const input = tone(0.128)
    const first = lock.process('vad', input)
    assert.equal(first.isolated, false)
    assert.equal(first.samples, input)
    assert.equal(lock.getStatus().active, false)
    assert.equal(lock.getStatus().lastError, 'runtime_failed')
    lock.process('vad', input)
    assert.equal(failing.calls.runs, 1, 'a failed isolator is not retried on every frame')

    lock.enroll(tone(4))
    assert.equal(lock.getStatus().lastError, null)
    assert.equal(lock.getStatus().active, true)
  })

  test('clear deletes the sample and turns isolation off', () => {
    const { sherpa } = createFakeSherpa()
    installModel()
    const lock = makeLock(sherpa)
    lock.setEnabled(true)
    lock.enroll(tone(4))
    const status = lock.clear()
    assert.equal(status.enrolled, false)
    assert.equal(status.active, false)
    assert.equal(fs.existsSync(path.join(root, 'voice-lock', 'owner-voice.wav')), false)
    assert.equal(lock.process('vad', tone(0.1)).isolated, false)
  })
})

describe('owner voice signal helpers', () => {
  test('residual gate zeroes frames cut by more than 10 dB and keeps the owner', () => {
    const input = tone(0.04)
    const output = new Float32Array(input.length)
    for (let i = 0; i < 320; i += 1) output[i] = input[i] * 0.2 // -14 dB: a suppressed stranger
    for (let i = 320; i < 640; i += 1) output[i] = input[i] * 0.9 // about 0 dB: the owner
    gateResidual(output, input)
    assert.ok(output.subarray(0, 320).every((value) => value === 0))
    assert.ok(Math.abs(output[400] - input[400] * 0.9) < 1e-6)
  })

  test('residual gate leaves near-silent input alone', () => {
    const input = new Float32Array(320).fill(1e-6)
    const output = new Float32Array(320).fill(1e-7)
    gateResidual(output, input)
    assert.equal(output[0], Math.fround(1e-7))
  })

  test('onset gate fires on speech after a quiet gap, once', () => {
    const gate = createOnsetGate()
    const quiet = tone(0.5, 0.001)
    const loud = tone(0.2, 0.2)
    assert.equal(gate.push(quiet), false)
    assert.equal(gate.push(loud), true)
    assert.equal(gate.push(loud), false, 'continued speech is not a new onset')
    assert.equal(gate.push(tone(0.1, 0.001)), false)
    assert.equal(gate.push(loud), false, '100 ms pause is not a new onset')
    assert.equal(gate.push(tone(0.4, 0.001)), false)
    assert.equal(gate.push(loud), true)
  })
})

describe('owner voice IPC payloads', () => {
  test('accepts Float32Array and finite number arrays within the cap', () => {
    assert.equal(validateSamplesPayload({ samples: new Float32Array(4) }, 10)?.length, 4)
    assert.equal(validateSamplesPayload({ samples: [0.1, -0.2] }, 10)?.length, 2)
  })

  test('rejects empty, oversized and malformed audio', () => {
    assert.equal(validateSamplesPayload(null, 10), null)
    assert.equal(validateSamplesPayload({ samples: new Float32Array(0) }, 10), null)
    assert.equal(validateSamplesPayload({ samples: new Float32Array(11) }, 10), null)
    assert.equal(validateSamplesPayload({ samples: [0.1, 'x'] }, 10), null)
    assert.equal(validateSamplesPayload({ samples: [Number.NaN] }, 10), null)
    assert.equal(validateSamplesPayload({ samples: 'audio' }, 10), null)
  })
})
