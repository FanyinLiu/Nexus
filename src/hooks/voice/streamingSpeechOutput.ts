import { StreamingTtsChunker } from '../../features/voice/streamingTts'
import type { StreamAudioPlayer } from '../../features/voice/streamAudioPlayer'
import { prepareTextForTts } from '../../features/voice/text'
import { createId } from '../../lib'
import type { AppSettings } from '../../types'
import type { StreamingSpeechOutputController, VoiceStreamEvent } from './types'

export type StreamingSpeechOutputOptions = {
  onStart?: () => void
  onEnd?: () => void
  onError?: (message: string) => void
}

export type StreamingSpeechOutputRuntime = {
  getPlayer: () => StreamAudioPlayer
  setActiveController?: (controller: StreamingSpeechOutputController | null) => void
  resetPlayer?: () => void
}

function resolveChunkerConfig(providerId: string) {
  if (providerId === 'cosyvoice-tts') {
    return {
      maxChunkLength: 150,
      minForcedChunkLength: 60,
      preferredEarlySplitLength: 50,
      firstChunkMaxLength: 80,
      firstChunkMinForcedChunkLength: 32,
      firstChunkPreferredEarlySplitLength: 24,
    }
  }

  return {
    firstChunkMaxLength: 48,
    firstChunkMinForcedChunkLength: 18,
    firstChunkPreferredEarlySplitLength: 14,
  }
}

function createChunker(speechSettings: AppSettings) {
  return {
    chunker: new StreamingTtsChunker(
      resolveChunkerConfig(speechSettings.speechOutputProviderId),
    ),
  }
}

export function createStreamingSpeechOutputController(
  speechSettings: AppSettings,
  runtime: StreamingSpeechOutputRuntime,
  options?: StreamingSpeechOutputOptions,
): StreamingSpeechOutputController {
  if (!window.desktopPet?.ttsStreamStart || !window.desktopPet?.subscribeTtsStream) {
    throw new Error('当前环境未连接桌面客户端，无法使用流式语音播报。')
  }

  const { chunker } = createChunker(speechSettings)
  const player = runtime.getPlayer()
  // Voice cloning disabled — always use the provider's configured voice.
  const effectiveVoice = speechSettings.speechOutputVoice
  const requestId = createId('tts-stream')
  let started = false
  let ended = false
  let settled = false
  let aborted = false
  let finishRequested = false
  let streamStarted = false
  let startPromise: Promise<void> | null = null
  let pendingSegments = 0
  let pendingAudioAppends = 0
  let rejectAllPlayed: ((error: Error) => void) | null = null
  let resolveAllPlayed: (() => void) | null = null
  const allPlayedPromise = new Promise<void>((resolve, reject) => {
    resolveAllPlayed = resolve
    rejectAllPlayed = reject
  })

  const unsubscribe = window.desktopPet.subscribeTtsStream((event: VoiceStreamEvent) => {
    if (event.requestId !== requestId || settled || aborted) {
      return
    }

    if (event.type === 'chunk') {
      if (!started) {
        started = true
        options?.onStart?.()
      }

      pendingAudioAppends += 1
      void player.appendPcmChunk(event.samples, event.sampleRate, event.channels)
        .catch((error) => {
          fail(error instanceof Error ? error : new Error('流式音频播放失败。'))
        })
        .finally(() => {
          pendingAudioAppends = Math.max(0, pendingAudioAppends - 1)
          maybeResolve()
        })
      return
    }

    if (event.type === 'error') {
      fail(new Error(event.message || '流式 TTS 合成失败。'))
      return
    }

    if (event.type === 'end') {
      ended = true
      maybeResolve()
    }
  })

  function cleanup() {
    unsubscribe()
    runtime.setActiveController?.(null)
  }

  function settleSuccess() {
    if (settled) {
      return
    }

    console.log('[StreamingSpeechOutput] settleSuccess — calling onEnd')
    settled = true
    cleanup()
    resolveAllPlayed?.()
    options?.onEnd?.()
  }

  function fail(error: Error) {
    if (settled) {
      return
    }

    settled = true
    cleanup()
    player.stopAndClear()
    runtime.resetPlayer?.()
    options?.onError?.(error.message)
    rejectAllPlayed?.(error)
  }

  function maybeResolve() {
    if (
      !finishRequested
      || !ended
      || pendingSegments > 0
      || pendingAudioAppends > 0
    ) {
      return
    }

    player.waitForDrain().then(() => {
      if (!settled) settleSuccess()
    }).catch((error) => {
      if (!settled) fail(error instanceof Error ? error : new Error('流式音频播放失败。'))
    })
  }

  async function ensureStarted() {
    if (startPromise) {
      return startPromise
    }

    const desktopPet = window.desktopPet
    if (!desktopPet) {
      throw new Error('当前环境未连接桌面客户端，无法使用流式语音播报。')
    }

    startPromise = desktopPet.ttsStreamStart({
      requestId,
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
    }).then(() => {
      streamStarted = true
    })

    return startPromise
  }

  let finishSent = false

  function requestFinish() {
    if (finishSent || settled || aborted) {
      return
    }

    finishSent = true
    void ensureStarted()
      .then(() => window.desktopPet!.ttsStreamFinish({ requestId }))
      .catch((error) => {
        fail(error instanceof Error ? error : new Error('流式 TTS 结束失败。'))
      })
      .finally(() => {
        maybeResolve()
      })
  }

  function queueSegment(segment: string) {
    const cleaned = prepareTextForTts(segment)
    if (!cleaned || settled || aborted) {
      return
    }

    pendingSegments += 1
    ensureStarted()
      .then(() => window.desktopPet!.ttsStreamPushText({ requestId, text: cleaned }))
      .then(() => undefined)
      .catch((error) => {
        fail(error instanceof Error ? error : new Error('流式 TTS 发送文本失败。'))
      })
      .finally(() => {
        pendingSegments = Math.max(0, pendingSegments - 1)
        if (finishRequested && pendingSegments === 0) {
          requestFinish()
        }
        maybeResolve()
      })
  }

  const controller: StreamingSpeechOutputController = {
    pushDelta(delta: string) {
      if (!delta || settled || aborted) {
        return
      }

      const chunks = chunker.pushText(delta)
      for (const chunk of chunks) {
        queueSegment(chunk)
      }
    },
    finish() {
      if (finishRequested || settled || aborted) {
        return
      }

      const remaining = chunker.flush()
      for (const chunk of remaining) {
        queueSegment(chunk)
      }

      finishRequested = true
      if (!streamStarted && pendingSegments === 0) {
        if (startPromise) {
          startPromise.then(() => {
            window.desktopPet?.ttsStreamAbort?.({ requestId })?.catch(() => {})
          }).catch(() => {})
        }
        settled = true
        cleanup()
        resolveAllPlayed?.()
        return
      }

      if (pendingSegments === 0) {
        requestFinish()
      }
    },
    waitForCompletion() {
      return allPlayedPromise
    },
    hasStarted() {
      return started
    },
    abort() {
      if (aborted || settled) {
        return
      }

      aborted = true
      settled = true
      cleanup()
      player.stopAndClear()
      runtime.resetPlayer?.()
      rejectAllPlayed?.(new Error('语音播报已停止。'))
      if (startPromise) {
        void startPromise
          .then(() => window.desktopPet!.ttsStreamAbort({ requestId }))
          .catch(() => undefined)
      }
    },
  }

  runtime.setActiveController?.(controller)
  return controller
}
