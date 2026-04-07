/**
 * Renderer-side bridge for Tencent Cloud real-time ASR running in the Electron
 * main process. Captures mic audio via ScriptProcessor, sends PCM samples to
 * the main-process WebSocket client via IPC, and surfaces partial/final
 * transcription results through callbacks.
 */

import { requestVoiceInputStream } from '../voice/runtimeSupport.ts'

const SAMPLE_RATE = 16000
const SCRIPT_PROCESSOR_BUFFER_SIZE = 1024

export type TencentAsrCallbacks = {
  onPartial?: (text: string) => void
  onFinal?: (text: string) => void
  onError?: (message: string) => void
  onActivity?: (rms: number) => void
}

export type TencentAsrConnectOptions = {
  appId: string
  secretId: string
  secretKey: string
  engineModelType?: string
  hotwordList?: string
}

export type TencentAsrStreamStopResult = {
  text: string
  audioSamples: Float32Array | null
  sampleRate: number
}

export type TencentAsrStreamSession = {
  stop: () => Promise<TencentAsrStreamStopResult>
  abort: () => void
}

function createInputAudioContext(sampleRate?: number) {
  try {
    return sampleRate
      ? new AudioContext({ sampleRate })
      : new AudioContext()
  } catch {
    return new AudioContext()
  }
}

export function parseTencentCredentials(apiKey: string): TencentAsrConnectOptions | null {
  const parts = apiKey.split(':')
  if (parts.length < 3) return null
  return {
    appId: parts[0].trim(),
    secretId: parts[1].trim(),
    secretKey: parts.slice(2).join(':').trim(),
  }
}

export async function startTencentAsrStream(
  credentials: TencentAsrConnectOptions,
  callbacks: TencentAsrCallbacks,
): Promise<TencentAsrStreamSession> {
  const desktopPet = window.desktopPet
  if (
    !desktopPet?.tencentAsrConnect
    || !desktopPet.tencentAsrFeed
    || !desktopPet.tencentAsrFinish
    || !desktopPet.tencentAsrAbort
    || !desktopPet.subscribeTencentAsrResult
  ) {
    throw new Error('当前环境未连接桌面客户端，无法使用腾讯云语音识别。')
  }
  const api = desktopPet

  const microphone = await requestVoiceInputStream({
    preferredSampleRate: SAMPLE_RATE,
    purpose: 'stt',
  })
  const stream = microphone.stream

  // Connect to Tencent Cloud ASR (each connection is a new session)
  try {
    await api.tencentAsrConnect({
      appId: credentials.appId,
      secretId: credentials.secretId,
      secretKey: credentials.secretKey,
      engineModelType: credentials.engineModelType,
      hotwordList: credentials.hotwordList,
    })
  } catch (error) {
    stream.getTracks().forEach((track) => track.stop())
    throw error
  }

  const audioContext = createInputAudioContext(SAMPLE_RATE)
  await audioContext.resume().catch(() => undefined)

  const sourceNode = audioContext.createMediaStreamSource(stream)
  const processorNode = audioContext.createScriptProcessor(SCRIPT_PROCESSOR_BUFFER_SIZE, 1, 1)
  const outputNode = audioContext.createGain()
  outputNode.gain.value = 0

  sourceNode.connect(processorNode)
  processorNode.connect(outputNode)
  outputNode.connect(audioContext.destination)

  let audioDisposed = false
  let destroyed = false
  let finalizing = false
  let lastPartialText = ''
  let lastFinalText = ''
  let pushChain = Promise.resolve()
  const recordedChunks: Float32Array[] = []
  let recordedLength = 0

  function buildRecordedAudioSamples() {
    if (!recordedChunks.length || recordedLength <= 0) return null
    const combined = new Float32Array(recordedLength)
    let offset = 0
    for (const chunk of recordedChunks) {
      combined.set(chunk, offset)
      offset += chunk.length
    }
    return combined
  }

  function teardownAudioGraph() {
    if (audioDisposed) return
    audioDisposed = true
    processorNode.onaudioprocess = null
    try { sourceNode.disconnect() } catch { /* ignore */ }
    try { processorNode.disconnect() } catch { /* ignore */ }
    try { outputNode.disconnect() } catch { /* ignore */ }
    stream.getTracks().forEach((track) => track.stop())
    void audioContext.close().catch(() => undefined)
  }

  function fail(message: string) {
    if (destroyed) return
    destroyed = true
    finalizing = true
    teardownAudioGraph()
    unsubscribeResults()
    api.tencentAsrAbort().catch(() => undefined)
    callbacks.onError?.(message)
  }

  // Subscribe to streaming results from the main process
  const unsubscribeResults = api.subscribeTencentAsrResult((event) => {
    if (destroyed) return

    if (event.type === 'error') {
      fail(event.text)
      return
    }

    if (event.type === 'partial') {
      lastPartialText = event.text
      callbacks.onPartial?.(event.text)
    } else if (event.type === 'final') {
      lastFinalText = event.text
      callbacks.onFinal?.(event.text)
    }
  })

  processorNode.onaudioprocess = (event) => {
    if (destroyed || finalizing) return

    const channelData = event.inputBuffer.getChannelData(0)
    if (!channelData.length) return

    const samples = new Float32Array(channelData)
    recordedChunks.push(samples)
    recordedLength += samples.length

    let energy = 0
    for (const sample of samples) energy += sample * sample
    callbacks.onActivity?.(Math.sqrt(energy / samples.length))

    pushChain = pushChain.then(async () => {
      if (destroyed || finalizing) return

      try {
        await api.tencentAsrFeed({
          samples: Array.from(samples),
          sampleRate: audioContext.sampleRate,
        })
      } catch (error) {
        fail(error instanceof Error ? error.message : '腾讯云语音识别音频传输出错。')
      }
    })
  }

  return {
    async stop() {
      if (destroyed) {
        return {
          text: (lastFinalText || lastPartialText).trim(),
          audioSamples: buildRecordedAudioSamples(),
          sampleRate: audioContext.sampleRate,
        }
      }

      finalizing = true
      teardownAudioGraph()
      await pushChain.catch(() => undefined)

      try {
        const result = await api.tencentAsrFinish()
        const finalText = (result.text ?? '').trim()
        if (finalText) lastFinalText = finalText
      } catch {
        // fall back to accumulated text
      } finally {
        destroyed = true
        unsubscribeResults()
      }

      return {
        text: (lastFinalText || lastPartialText).trim(),
        audioSamples: buildRecordedAudioSamples(),
        sampleRate: audioContext.sampleRate,
      }
    },

    abort() {
      if (destroyed) return
      destroyed = true
      finalizing = true
      teardownAudioGraph()
      unsubscribeResults()
      api.tencentAsrAbort().catch(() => undefined)
    },
  }
}
