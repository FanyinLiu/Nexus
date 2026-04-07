import type { AudioPlaybackQueue } from '../../features/voice/audioQueue'
import {
  getCachedTtsResult,
  isSherpaTtsUnavailableMessage,
  setCachedTtsResult,
} from '../../features/voice/runtimeSupport'
import { segmentTextForSpeech } from '../../features/voice/streamingTts'
import { prepareTextForTts } from '../../features/voice/text'
import { isBrowserSpeechOutputProvider } from '../../lib/audioProviders'
import { shorten } from '../../lib/common'
import { executeWithFailover, type FailoverCandidate } from '../../features/failover/orchestrator.ts'
import { speakText as speakBrowserText } from '../../lib/voice'
import type { AppSettings, AudioSynthesisRequest, VoiceTraceEntry } from '../../types'
import type { SpeechSegmentMeta } from './types'

type SpeechOutputCallbacks = {
  onStart?: () => void
  onEnd?: () => void
  onError?: (message: string) => void
}

export type SpeechOutputPlaybackRuntime = {
  getAudioPlaybackQueue: () => AudioPlaybackQueue<SpeechSegmentMeta>
  simulateBrowserSpeech: (content: string, rate: number) => void
  stopSpeechTracking: () => void
}

export type StartSpeechOutputRuntimeOptions = {
  text: string
  speechSettings: AppSettings
  runtime: SpeechOutputPlaybackRuntime
  callbacks?: SpeechOutputCallbacks
  buildSpeechOutputFailoverCandidates: (settings: AppSettings) => AppSettings[]
  applySpeechOutputProviderFallback: (providerId: string, statusText?: string) => AppSettings
  switchSpeechOutputToBrowser: (statusText?: string) => unknown
  appendVoiceTrace: (
    title: string,
    detail: string,
    tone?: VoiceTraceEntry['tone'],
  ) => void
}

export async function playSpeechOutputWithSettingsRuntime(
  text: string,
  speechSettings: AppSettings,
  runtime: SpeechOutputPlaybackRuntime,
  callbacks?: SpeechOutputCallbacks,
) {
  const content = prepareTextForTts(text)

  if (!speechSettings.speechOutputEnabled) {
    throw new Error('请先开启语音播报。')
  }

  if (!content) {
    throw new Error('没有可播报的文本内容。')
  }

  if (isBrowserSpeechOutputProvider(speechSettings.speechOutputProviderId)) {
    speakBrowserText({
      text: content,
      lang: speechSettings.speechSynthesisLang,
      rate: speechSettings.speechRate,
      pitch: speechSettings.speechPitch,
      volume: speechSettings.speechVolume,
      voiceId: speechSettings.speechOutputVoice,
      onStart: () => {
        runtime.simulateBrowserSpeech(content, speechSettings.speechRate)
        callbacks?.onStart?.()
      },
      onEnd: () => {
        runtime.stopSpeechTracking()
        callbacks?.onEnd?.()
      },
      onError: (message) => {
        runtime.stopSpeechTracking()
        callbacks?.onError?.(message)
      },
    })
    return
  }

  if (!window.desktopPet?.synthesizeAudio) {
    throw new Error('当前环境未连接桌面客户端，无法使用内置语音播报。')
  }

  const segments = segmentTextForSpeech(content)
  if (!segments.length) {
    throw new Error('没有可播报的文本内容。')
  }

  // Voice cloning disabled — always use the provider's configured voice.
  const effectiveVoice = speechSettings.speechOutputVoice
  const playbackQueue = runtime.getAudioPlaybackQueue()
  let started = false

  const basePayload: Omit<AudioSynthesisRequest, 'text'> = {
    providerId: speechSettings.speechOutputProviderId,
    baseUrl: speechSettings.speechOutputApiBaseUrl,
    apiKey: speechSettings.speechOutputApiKey,
    model: speechSettings.speechOutputModel,
    voice: effectiveVoice,
    instructions: speechSettings.speechOutputInstructions,
    language: speechSettings.speechSynthesisLang,
    rate: speechSettings.speechRate,
    pitch: speechSettings.speechPitch,
    volume: speechSettings.speechVolume,
  }

  const synthPromises = segments.map((segment) => {
    const payload: AudioSynthesisRequest = { ...basePayload, text: segment }
    const cached = getCachedTtsResult(payload)
    if (cached) {
      return Promise.resolve(cached)
    }

    return window.desktopPet!.synthesizeAudio(payload).then((result) => {
      setCachedTtsResult(payload, {
        audioBase64: result.audioBase64,
        mimeType: result.mimeType,
      })
      return result
    })
  })

  for (let index = 0; index < segments.length; index += 1) {
    const result = await synthPromises[index]
    if (!started) {
      started = true
      callbacks?.onStart?.()
    }

    await playbackQueue.enqueue({
      audioBase64: result.audioBase64,
      mimeType: result.mimeType,
      meta: {
        text: segments[index],
        rate: speechSettings.speechRate,
      },
    }).catch((error) => {
      const message = error instanceof Error
        ? error.message
        : '语音播放失败，请检查本地音频输出设备。'
      callbacks?.onError?.(message)
      throw error instanceof Error ? error : new Error(message)
    })

    if (index === segments.length - 1) {
      callbacks?.onEnd?.()
    }
  }
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

  try {
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
        )
      },
      onEvent: (event) => {
        if (event.type === 'failure' && event.isPrimary) {
          options.appendVoiceTrace(
            '语音播报主链路异常',
            `${options.speechSettings.speechOutputProviderId}：${shorten(event.error, 80)}`,
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
        '语音播报本次回退',
        `${options.speechSettings.speechOutputProviderId} -> ${result.candidateId}（仅本次，不改变设置）`,
        'success',
      )
    }
  } catch (error) {
    if (error instanceof Error && isSherpaTtsUnavailableMessage(error.message)) {
      options.switchSpeechOutputToBrowser('本地 Sherpa TTS 模型缺失，已自动切换到 CosyVoice2 播报。')
    }
    throw error
  }
}
