import assert from 'node:assert/strict'
import { before, test } from 'node:test'

import {
  startApiRecordingConversation,
  type StartApiRecordingConversationOptions,
} from '../src/hooks/voice/recordingConversations.ts'
import { ensureLocaleLoaded, setLocale } from '../src/i18n/runtime.ts'
import { enMessages } from '../src/i18n/locales/en/index.ts'
import type { AppSettings } from '../src/types/index.ts'

before(async () => {
  await ensureLocaleLoaded('en-US')
  setLocale('en-US')
})

// getUserMedia rejects with a DOMException whose message is the bare English
// "Permission denied". The API recording start path must show the platform
// permission sentence instead of that raw text.
function installMicDeniedGlobals(denied: unknown) {
  const keys = ['window', 'navigator', 'MediaRecorder'] as const
  const previous = new Map(
    keys.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
  )

  const define = (key: string, value: unknown) => {
    Object.defineProperty(globalThis, key, {
      configurable: true,
      writable: true,
      value,
    })
  }

  define('window', {
    desktopPet: {
      transcribeAudio: async () => ({ text: '' }),
    },
  })
  define('navigator', {
    // detectVoicePermissionPlatform() normalizes MacIntel → darwin.
    platform: 'MacIntel',
    mediaDevices: {
      getUserMedia: async () => {
        throw denied
      },
    },
  })
  define('MediaRecorder', class {})

  return () => {
    for (const key of keys) {
      const descriptor = previous.get(key)
      if (descriptor) {
        Object.defineProperty(globalThis, key, descriptor)
      } else {
        delete (globalThis as Record<string, unknown>)[key]
      }
    }
  }
}

function createParams(errors: Array<string | null>): StartApiRecordingConversationOptions {
  return {
    currentSettings: {} as AppSettings,
    apiRecordingRef: { current: null },
    voiceStateRef: { current: 'idle' },
    suppressVoiceReplyRef: { current: false },
    clearPendingVoiceRestart: () => undefined,
    canInterruptSpeech: () => true,
    interruptSpeakingForVoiceInput: () => true,
    setContinuousVoiceSession: () => undefined,
    shouldKeepContinuousVoiceSession: () => false,
    resetNoSpeechRestartCount: () => undefined,
    stopApiRecording: () => undefined,
    beginVoiceListeningSession: () => undefined,
    dispatchVoiceSessionAndSync: () => undefined,
    setVoiceState: () => undefined,
    setMood: () => undefined,
    setError: (value) => {
      errors.push(value)
    },
    setLiveTranscript: () => undefined,
    updateVoicePipeline: () => undefined,
    appendVoiceTrace: () => undefined,
    showPetStatus: () => undefined,
    handleRecognizedVoiceTranscript: async () => true,
    handleVoiceListeningFailure: () => undefined,
    shouldAutoRestartVoice: () => false,
    ti: (key) => enMessages[key] ?? key,
  }
}

const deniedCases = [
  { name: 'NotAllowedError DOMException', error: new DOMException('Permission denied', 'NotAllowedError') },
  { name: 'plain Error', error: new Error('Permission denied') },
  {
    name: 'NotAllowedError name with an unrelated message',
    error: Object.assign(new Error('The request is not allowed'), { name: 'NotAllowedError' }),
  },
]

for (const { name, error } of deniedCases) {
  test(`API recording start shows the mac permission sentence for ${name}`, async () => {
    const restore = installMicDeniedGlobals(error)
    try {
      const errors: Array<string | null> = []
      await startApiRecordingConversation(createParams(errors))

      const final = errors.at(-1)
      assert.equal(final, enMessages['humanize.voice.mic_permission_mac'])
      assert.notEqual(final, 'Permission denied')
      assert.doesNotMatch(final ?? '', /Permission denied/)
    } finally {
      restore()
    }
  })
}
