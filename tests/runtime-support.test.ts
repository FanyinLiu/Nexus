import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  buildSpeechOutputSmokeText,
  calculateAudioRms,
  getCachedTtsResult,
  getRecordingFileName,
  mapMicrophoneDiagnosticError,
  pickRecordingMimeType,
  requestVoiceInputStream,
  setCachedTtsResult,
} from '../src/features/voice/runtimeSupport.ts'

function createTrack() {
  return {
    enabled: false,
    stopped: false,
    stop() {
      this.stopped = true
    },
    getSettings() {
      return { sampleRate: 16_000 }
    },
  }
}

function createStream(audioTracks: unknown[], allTracks = audioTracks) {
  return {
    getAudioTracks() {
      return audioTracks
    },
    getTracks() {
      return allTracks
    },
  } as unknown as MediaStream
}

async function withFakeNavigator<T>(
  getUserMedia: (constraints: MediaStreamConstraints) => Promise<MediaStream>,
  run: () => Promise<T>,
) {
  const previousDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator')

  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      mediaDevices: {
        getUserMedia,
      },
    },
  })

  try {
    return await run()
  } finally {
    if (previousDescriptor) {
      Object.defineProperty(globalThis, 'navigator', previousDescriptor)
    } else {
      delete (globalThis as { navigator?: Navigator }).navigator
    }
  }
}

test('requestVoiceInputStream stops empty streams and falls back to the next VAD profile', async () => {
  const calls: MediaStreamConstraints[] = []
  const strayTrack = createTrack()
  const audioTrack = createTrack()

  await withFakeNavigator(async (constraints) => {
    calls.push(constraints)
    if (calls.length === 1) {
      return createStream([], [strayTrack])
    }
    return createStream([audioTrack])
  }, async () => {
    const result = await requestVoiceInputStream({
      preferredSampleRate: 16_000,
      purpose: 'vad',
    })

    assert.equal(result.profileId, 'processed')
    assert.equal(result.stream.getAudioTracks()[0], audioTrack)
    assert.deepEqual(result.trackSettings, { sampleRate: 16_000 })
  })

  assert.equal(strayTrack.stopped, true)
  assert.equal(audioTrack.enabled, true)
  assert.equal(calls.length, 2)
  assert.equal((calls[0].audio as MediaTrackConstraints).echoCancellation, false)
  assert.equal((calls[1].audio as MediaTrackConstraints).echoCancellation, true)
})

test('requestVoiceInputStream tries the default profile last and returns its error', async () => {
  const calls: MediaStreamConstraints[] = []

  await withFakeNavigator(async (constraints) => {
    calls.push(constraints)
    throw new Error(calls.length === 3 ? 'default capture failed' : 'strict capture failed')
  }, async () => {
    await assert.rejects(
      requestVoiceInputStream({ purpose: 'vad' }),
      /default capture failed/,
    )
  })

  assert.equal(calls.length, 3)
  assert.equal(calls[2].audio, true)
})

test('recording helpers select supported mime type and filename suffix', () => {
  const previousDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'MediaRecorder')

  Object.defineProperty(globalThis, 'MediaRecorder', {
    configurable: true,
    value: {
      isTypeSupported: (mimeType: string) => mimeType === 'audio/ogg;codecs=opus',
    },
  })

  try {
    assert.equal(pickRecordingMimeType(), 'audio/ogg;codecs=opus')
    assert.equal(getRecordingFileName('audio/mp4'), 'speech.m4a')
    assert.equal(getRecordingFileName('audio/ogg;codecs=opus'), 'speech.ogg')
    assert.equal(getRecordingFileName('audio/webm'), 'speech.webm')
  } finally {
    if (previousDescriptor) {
      Object.defineProperty(globalThis, 'MediaRecorder', previousDescriptor)
    } else {
      delete (globalThis as { MediaRecorder?: typeof MediaRecorder }).MediaRecorder
    }
  }
})

test('TTS result cache returns matching entries and evicts the oldest key', () => {
  const makePayload = (index: number) => ({
    providerId: 'edge-tts',
    model: 'tts',
    voice: 'voice',
    text: `text-${index}`,
  })

  for (let index = 0; index < 151; index += 1) {
    setCachedTtsResult(makePayload(index), {
      audioBase64: `audio-${index}`,
      mimeType: 'audio/mpeg',
    })
  }

  assert.equal(getCachedTtsResult(makePayload(0)), null)
  assert.deepEqual(getCachedTtsResult(makePayload(150)), {
    audioBase64: 'audio-150',
    mimeType: 'audio/mpeg',
  })
})

test('calculateAudioRms handles sparse array-like samples', () => {
  const samples = { 0: 3, 2: 4, length: 3 } as ArrayLike<number>
  assert.equal(calculateAudioRms(samples), Math.sqrt((9 + 0 + 16) / 3))
})

test('mapMicrophoneDiagnosticError maps DOM and generic errors through translator', () => {
  const ti = (key: string, params?: Record<string, unknown>) => (
    params?.detail ? `${key}:${params.detail}` : key
  )

  assert.equal(
    mapMicrophoneDiagnosticError(new DOMException('denied', 'NotAllowedError'), false, ti),
    'voice.mic.permission_denied',
  )
  assert.equal(
    mapMicrophoneDiagnosticError(new DOMException('missing', 'NotFoundError'), false, ti),
    'voice.mic.not_found',
  )
  assert.equal(
    mapMicrophoneDiagnosticError(new DOMException('busy', 'NotReadableError'), false, ti),
    'voice.mic.busy',
  )
  assert.equal(
    mapMicrophoneDiagnosticError(new DOMException('aborted', 'AbortError'), false, ti),
    'voice.mic.aborted',
  )
  assert.equal(
    mapMicrophoneDiagnosticError(new Error('driver failed'), true, ti),
    'voice.mic.local_readiness_failed_with_detail:driver failed',
  )
  assert.equal(
    mapMicrophoneDiagnosticError(null, true, ti),
    'voice.mic.local_readiness_failed_generic',
  )
})

test('buildSpeechOutputSmokeText falls back when companion name is empty', () => {
  const ti = (key: string, params?: Record<string, unknown>) => {
    if (key === 'voice.smoke.companion_fallback') return 'Nexus'
    if (key === 'voice.smoke.output_text') return `hello ${params?.companionName}`
    return key
  }

  assert.equal(
    buildSpeechOutputSmokeText({ companionName: '  ' } as never, ti),
    'hello Nexus',
  )
  assert.equal(
    buildSpeechOutputSmokeText({ companionName: '星绘' } as never, ti),
    'hello 星绘',
  )
})
