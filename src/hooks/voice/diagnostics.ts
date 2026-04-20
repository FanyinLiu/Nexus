import {
  AUDIO_SMOKE_PLAYBACK_TIMEOUT_MS,
  buildSpeechOutputSmokeText,
  mapMicrophoneDiagnosticError,
  pickRecordingMimeType,
  requestVoiceInputStream,
} from '../../features/voice/runtimeSupport'
import {
  isSenseVoiceSpeechInputProvider,
} from '../../lib/audioProviders'
import { checkSenseVoiceAvailability } from '../../features/hearing/localSenseVoice.ts'
import type { AppSettings, TranslationKey, TranslationParams } from '../../types'

type Translator = (key: TranslationKey, params?: TranslationParams) => string

export type VoiceDiagnosticResult = {
  ok: boolean
  message: string
}

export type TestSpeechInputReadinessRuntimeOptions = {
  draftSettings: AppSettings
  ti: Translator
}

export type TestSpeechInputConnectionRuntimeOptions = {
  draftSettings: AppSettings
  testSpeechInputReadiness: (draftSettings: AppSettings) => Promise<VoiceDiagnosticResult>
  ti: Translator
}

export type ProbeSpeechOutputPlaybackStartRuntimeOptions = {
  draftSettings: AppSettings
  text: string
  stopActiveSpeechOutput: () => void
  startSpeechOutput: (
    text: string,
    speechSettings: AppSettings,
    options?: {
      onStart?: () => void
      onEnd?: () => void
      onError?: (message: string) => void
    },
  ) => Promise<void>
  ti: Translator
}

export type TestSpeechOutputReadinessRuntimeOptions = {
  draftSettings: AppSettings
  options?: {
    playSample?: boolean
    sampleText?: string
  }
  probeSpeechOutputPlaybackStart: (
    draftSettings: AppSettings,
    text: string,
  ) => Promise<void>
  ti: Translator
}

export type RunAudioSmokeTestRuntimeOptions = {
  draftSettings: AppSettings
  testSpeechInputConnection: (draftSettings: AppSettings) => Promise<VoiceDiagnosticResult>
  testSpeechOutputReadiness: (
    draftSettings: AppSettings,
    options?: {
      playSample?: boolean
      sampleText?: string
    },
  ) => Promise<VoiceDiagnosticResult>
  ti: Translator
}

export async function testSpeechInputReadinessRuntime(
  options: TestSpeechInputReadinessRuntimeOptions,
): Promise<VoiceDiagnosticResult> {
  const providerId = options.draftSettings.speechInputProviderId

  if (!navigator.mediaDevices?.getUserMedia) {
    return {
      ok: false,
      message: options.ti('voice.diagnostics.no_mic_api'),
    }
  }

  if (typeof MediaRecorder === 'undefined') {
    return {
      ok: false,
      message: options.ti('voice.diagnostics.no_media_recorder'),
    }
  }

  let stream: MediaStream | null = null

  try {
    stream = (await requestVoiceInputStream({ purpose: 'stt' })).stream
    const audioTracks = stream.getAudioTracks()

    if (!audioTracks.length) {
      return {
        ok: false,
        message: options.ti('voice.diagnostics.no_audio_tracks'),
      }
    }

    const mimeType = pickRecordingMimeType()
    if (mimeType) {
      new MediaRecorder(stream, { mimeType })
    } else {
      new MediaRecorder(stream)
    }

    if (isSenseVoiceSpeechInputProvider(providerId)) {
      const status = await checkSenseVoiceAvailability()
      if (!status.installed) {
        return {
          ok: false,
          message: options.ti('voice.provider.sensevoice.node_missing_detail'),
        }
      }
      if (!status.modelFound) {
        return {
          ok: false,
          message: options.ti('voice.provider.sensevoice.model_location_hint', { modelsDir: status.modelsDir }),
        }
      }
    }

    const message = isSenseVoiceSpeechInputProvider(providerId)
      ? options.ti('voice.diagnostics.sensevoice_ready')
      : options.ti('voice.diagnostics.generic_ready')

    return { ok: true, message }
  } catch (caught) {
    return {
      ok: false,
      message: mapMicrophoneDiagnosticError(
        caught,
        isSenseVoiceSpeechInputProvider(providerId),
        options.ti,
      ),
    }
  } finally {
    stream?.getTracks().forEach((track) => track.stop())
  }
}

export async function testSpeechInputConnectionRuntime(
  options: TestSpeechInputConnectionRuntimeOptions,
): Promise<VoiceDiagnosticResult> {
  const localSpeechCheck = await options.testSpeechInputReadiness(options.draftSettings)
  if (!localSpeechCheck.ok) {
    return localSpeechCheck
  }

  if (isSenseVoiceSpeechInputProvider(options.draftSettings.speechInputProviderId)) {
    return localSpeechCheck
  }

  if (!window.desktopPet?.testServiceConnection) {
    return {
      ok: false,
      message: options.ti('voice.diagnostics.input_no_connection_test'),
    }
  }

  const remoteSpeechCheck = await window.desktopPet.testServiceConnection({
    capability: 'speech-input',
    providerId: options.draftSettings.speechInputProviderId,
    baseUrl: options.draftSettings.speechInputApiBaseUrl,
    apiKey: options.draftSettings.speechInputApiKey,
    model: options.draftSettings.speechInputModel,
  })

  if (!remoteSpeechCheck.ok) {
    return remoteSpeechCheck
  }

  return {
    ok: true,
    message: `${localSpeechCheck.message} ${remoteSpeechCheck.message}`.trim(),
  }
}

export async function probeSpeechOutputPlaybackStartRuntime(
  options: ProbeSpeechOutputPlaybackStartRuntimeOptions,
) {
  options.stopActiveSpeechOutput()

  await new Promise<void>((resolve, reject) => {
    let settled = false
    let timeoutId: number | null = window.setTimeout(() => {
      finish(() => {
        options.stopActiveSpeechOutput()
        reject(new Error(options.ti('voice.diagnostics.playback_timeout')))
      })
    }, AUDIO_SMOKE_PLAYBACK_TIMEOUT_MS)
    let stopTimerId: number | null = null

    function finish(callback: () => void) {
      if (settled) return
      settled = true

      if (timeoutId !== null) {
        window.clearTimeout(timeoutId)
        timeoutId = null
      }

      if (stopTimerId !== null) {
        window.clearTimeout(stopTimerId)
        stopTimerId = null
      }

      callback()
    }

    function scheduleStop() {
      stopTimerId = window.setTimeout(() => {
        options.stopActiveSpeechOutput()
      }, 220)
    }

    void options.startSpeechOutput(options.text, options.draftSettings, {
      onStart: () => {
        finish(() => {
          scheduleStop()
          resolve()
        })
      },
      onEnd: () => {
        finish(() => {
          resolve()
        })
      },
      onError: (message) => {
        finish(() => {
          options.stopActiveSpeechOutput()
          reject(new Error(message))
        })
      },
    }).catch((error) => {
      finish(() => {
        options.stopActiveSpeechOutput()
        reject(error instanceof Error ? error : new Error(String(error)))
      })
    })
  })
}

export async function testSpeechOutputReadinessRuntime(
  options: TestSpeechOutputReadinessRuntimeOptions,
): Promise<VoiceDiagnosticResult> {
  if (!options.draftSettings.speechOutputEnabled) {
    return {
      ok: false,
      message: options.ti('voice.diagnostics.output_not_enabled'),
    }
  }

  if (!window.desktopPet?.testServiceConnection) {
    return {
      ok: false,
      message: options.ti('voice.diagnostics.output_no_connection_test'),
    }
  }

  const remoteSpeechCheck = await window.desktopPet.testServiceConnection({
    capability: 'speech-output',
    providerId: options.draftSettings.speechOutputProviderId,
    baseUrl: options.draftSettings.speechOutputApiBaseUrl,
    apiKey: options.draftSettings.speechOutputApiKey,
    model: options.draftSettings.speechOutputModel,
    // Voice cloning disabled — always use the provider's configured voice.
    voice: options.draftSettings.speechOutputVoice,
  })

  if (!remoteSpeechCheck.ok) {
    return remoteSpeechCheck
  }

  if (options.options?.playSample) {
    await options.probeSpeechOutputPlaybackStart(
      options.draftSettings,
      options.options.sampleText?.trim() || buildSpeechOutputSmokeText(options.draftSettings, options.ti),
    )

    return {
      ok: true,
      message: options.ti('voice.diagnostics.playback_confirmed_suffix', { message: remoteSpeechCheck.message }),
    }
  }

  return remoteSpeechCheck
}

export async function runAudioSmokeTestRuntime(
  options: RunAudioSmokeTestRuntimeOptions,
): Promise<VoiceDiagnosticResult> {
  if (!options.draftSettings.speechInputEnabled && !options.draftSettings.speechOutputEnabled) {
    return {
      ok: false,
      message: options.ti('voice.diagnostics.both_disabled'),
    }
  }

  const messages: string[] = []

  if (options.draftSettings.speechInputEnabled) {
    const inputCheck = await options.testSpeechInputConnection(options.draftSettings)
    if (!inputCheck.ok) {
      return {
        ok: false,
        message: options.ti('voice.diagnostics.input_prefix', { message: inputCheck.message }),
      }
    }

    messages.push(options.ti('voice.diagnostics.input_prefix', { message: inputCheck.message }))
  } else {
    messages.push(options.ti('voice.diagnostics.input_skipped'))
  }

  if (options.draftSettings.speechOutputEnabled) {
    const outputCheck = await options.testSpeechOutputReadiness(options.draftSettings, {
      playSample: true,
      sampleText: buildSpeechOutputSmokeText(options.draftSettings, options.ti),
    })
    if (!outputCheck.ok) {
      return {
        ok: false,
        message: [...messages, options.ti('voice.diagnostics.output_prefix', { message: outputCheck.message })].join('\n'),
      }
    }

    messages.push(options.ti('voice.diagnostics.output_prefix', { message: outputCheck.message }))
  } else {
    messages.push(options.ti('voice.diagnostics.output_skipped'))
  }

  return {
    ok: true,
    message: messages.join('\n'),
  }
}
