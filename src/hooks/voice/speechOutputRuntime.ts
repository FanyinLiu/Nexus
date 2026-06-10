import type { VoiceBusEvent } from '../../features/voice/busEvents.ts'
import type { StreamAudioPlayer } from '../../features/voice/streamAudioPlayer.ts'
import { prepareTextForTts } from '../../features/voice/text.ts'
import { shorten } from '../../lib/common.ts'
import { executeWithFailover, type FailoverCandidate } from '../../features/failover/orchestrator.ts'
import type { AppSettings, TranslationKey, TranslationParams, VoiceTraceEntry } from '../../types/index.ts'
import { createStreamingSpeechOutputController } from './streamingSpeechOutput.ts'
import type { StreamingSpeechOutputController } from './types.ts'

type Translator = (key: TranslationKey, params?: TranslationParams) => string

type SpeechOutputCallbacks = {
  onStart?: () => void
  onEnd?: () => void
  onError?: (message: string) => void
}

type TelemetryHooks = {
  busEmit?: (event: VoiceBusEvent) => void
  speechGeneration?: number
}

export type SpeechOutputPlaybackRuntime = {
  getStreamAudioPlayer: () => StreamAudioPlayer
  setActiveController?: (controller: StreamingSpeechOutputController | null) => void
  resetPlayer?: () => void
  stopSpeechTracking: () => void
}

export type StartSpeechOutputRuntimeOptions = {
  text: string
  speechSettings: AppSettings
  runtime: SpeechOutputPlaybackRuntime
  callbacks?: SpeechOutputCallbacks
  buildSpeechOutputFailoverCandidates: (settings: AppSettings) => AppSettings[]
  applySpeechOutputProviderFallback: (providerId: string, statusText?: string) => AppSettings
  appendVoiceTrace: (
    title: string,
    detail: string,
    tone?: VoiceTraceEntry['tone'],
  ) => void
  telemetry?: TelemetryHooks
  ti: Translator
}

export async function playSpeechOutputWithSettingsRuntime(
  text: string,
  speechSettings: AppSettings,
  runtime: SpeechOutputPlaybackRuntime,
  callbacks?: SpeechOutputCallbacks,
  telemetry?: TelemetryHooks,
  ti?: Translator,
) {
  const content = prepareTextForTts(text)

  if (!speechSettings.speechOutputEnabled) {
    throw new Error(ti?.('voice.diagnostics.output_not_enabled') ?? 'Please enable speech output first.')
  }

  if (!content) {
    throw new Error(ti?.('voice.output.no_text') ?? 'No text content to speak.')
  }

  if (!window.desktopPet?.ttsStreamStart) {
    throw new Error(ti?.('voice.output.no_desktop_client') ?? 'The desktop client is not connected.')
  }

  // Trace which provider+voice is actually dispatching the turn. Timbre drift
  // ("voice changes every time I speak") usually traces to the failover
  // orchestrator picking a different candidate than the primary, or the
  // Volcengine attempt plan falling back to BV001/BV002 on grantError. Pair
  // this log with the [TTS-Stream] Volcengine fallback warning in
  // electron/ttsStreamService.js to see the full story.
  console.info('[Voice] TTS dispatch', {
    provider: speechSettings.speechOutputProviderId,
    model: speechSettings.speechOutputModel,
    voice: speechSettings.speechOutputVoice,
  })

  // Drive the streaming TTS controller with the full text so all segments
  // share a single TTS session. The electron side pins the resolved voice
  // and cluster after the first chunk, which prevents timbre drift across
  // segments on long sentences (Volcengine etc. may otherwise re-walk the
  // fallback chain per segment and land on different voice backends).
  const controller = createStreamingSpeechOutputController(
    speechSettings,
    {
      getPlayer: runtime.getStreamAudioPlayer,
      setActiveController: runtime.setActiveController,
      resetPlayer: runtime.resetPlayer,
    },
    {
      ...callbacks,
      busEmit: telemetry?.busEmit,
      speechGeneration: telemetry?.speechGeneration,
      ti,
    },
  )

  controller.pushDelta(content)
  controller.finish()
  await controller.waitForCompletion()
}

export async function startSpeechOutputRuntime(
  options: StartSpeechOutputRuntimeOptions,
) {
  const candidateSettingsList = options.buildSpeechOutputFailoverCandidates(options.speechSettings)

  const candidates: FailoverCandidate<AppSettings>[] = candidateSettingsList.map((s) => ({
    id: s.speechOutputProviderId,
    identity: [
      s.speechOutputProviderId,
      s.speechOutputApiBaseUrl,
      s.speechOutputModel,
      s.speechOutputVoice,
    ].join('|'),
    payload: s,
  }))

  const result = await executeWithFailover<AppSettings, void>({
    domain: 'speech-output',
    candidates,
    failoverEnabled: options.speechSettings.speechOutputFailoverEnabled,
    execute: async (candidate) => {
      await playSpeechOutputWithSettingsRuntime(
        options.text,
        candidate.payload,
        options.runtime,
        options.callbacks,
        options.telemetry,
        options.ti,
      )
    },
    onEvent: (event) => {
      if (event.type === 'failure' && event.isPrimary) {
        options.appendVoiceTrace(
          'Speech output primary chain error',
          `${options.speechSettings.speechOutputProviderId}: ${shorten(event.error, 80)}`,
          'error',
        )
      }
    },
  })

  if (result.usedFallback) {
    // Only log the fallback — do NOT mutate settingsRef.  Previous behavior
    // permanently switched the runtime settings to the fallback provider,
    // meaning all subsequent responses would use a different provider/voice
    // even if the primary provider recovered on the very next request.
    options.appendVoiceTrace(
      'Speech output fallback (this turn only)',
      `${options.speechSettings.speechOutputProviderId} -> ${result.candidateId} (this turn only, settings unchanged)`,
      'success',
    )
  }
}
