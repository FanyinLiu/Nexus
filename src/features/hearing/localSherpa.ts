/**
 * Renderer-side bridge for Sherpa-onnx streaming ASR running in the Electron
 * main process. This intentionally mirrors the simpler Nexus audio path:
 * capture with ScriptProcessor, feed the recognizer using the actual
 * AudioContext sample rate, and let the hook decide when to finalize.
 */

import { requestVoiceInputStream } from '../voice/runtimeSupport.ts'

const SAMPLE_RATE = 16000
const SCRIPT_PROCESSOR_BUFFER_SIZE = 1024

export type SherpaStreamCallbacks = {
  onPartial?: (text: string) => void
  onEndpoint?: (text: string) => void
  onError?: (message: string) => void
  onActivity?: (rms: number) => void
}

export type SherpaStreamOptions = {
  modelId?: string
}

export type SherpaStreamStopResult = {
  text: string
  audioSamples: Float32Array | null
  sampleRate: number
}

export type SherpaStreamSession = {
  stop: () => Promise<SherpaStreamStopResult>
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

export async function startSherpaStream(
  callbacks: SherpaStreamCallbacks,
  options?: SherpaStreamOptions,
): Promise<SherpaStreamSession> {
  const desktopPet = window.desktopPet
  if (!desktopPet?.sherpaStart || !desktopPet.sherpaFeed || !desktopPet.sherpaFinish || !desktopPet.sherpaAbort) {
    throw new Error('当前环境未连接桌面客户端，无法使用本地流式识别。')
  }
  const desktopPetApi = desktopPet

  // Start mic immediately so we capture audio while sherpa initializes
  const microphone = await requestVoiceInputStream({
    preferredSampleRate: SAMPLE_RATE,
    purpose: 'stt',
  })
  const stream = microphone.stream

  const audioContext = createInputAudioContext(SAMPLE_RATE)
  await audioContext.resume().catch(() => undefined)

  const sourceNode = audioContext.createMediaStreamSource(stream)
  const processorNode = audioContext.createScriptProcessor(SCRIPT_PROCESSOR_BUFFER_SIZE, 1, 1)
  const outputNode = audioContext.createGain()
  outputNode.gain.value = 0

  sourceNode.connect(processorNode)
  processorNode.connect(outputNode)
  outputNode.connect(audioContext.destination)

  // Buffer audio that arrives before sherpa is ready
  let sherpaReady = false
  const earlyBuffer: Float32Array[] = []
  const MAX_EARLY_BUFFER_SIZE = 16000 * 10 // 10秒音频限制 (16kHz * 10s)

  processorNode.onaudioprocess = (event) => {
    const channelData = event.inputBuffer.getChannelData(0)
    if (!channelData.length) return
    const samples = new Float32Array(channelData)
    if (!sherpaReady) {
      const currentSize = earlyBuffer.reduce((sum, chunk) => sum + chunk.length, 0)
      if (currentSize < MAX_EARLY_BUFFER_SIZE) {
        earlyBuffer.push(samples)
      }
    }
    let energy = 0
    for (const sample of samples) energy += sample * sample
    callbacks.onActivity?.(Math.sqrt(energy / samples.length))
  }

  try {
    await desktopPetApi.sherpaStart(
      options?.modelId
        ? { modelId: options.modelId }
        : undefined,
    )
  } catch (error) {
    processorNode.onaudioprocess = null
    try { sourceNode.disconnect() } catch { /* */ }
    try { processorNode.disconnect() } catch { /* */ }
    try { outputNode.disconnect() } catch { /* */ }
    stream.getTracks().forEach((track) => track.stop())
    void audioContext.close().catch(() => undefined)
    throw error
  }

  sherpaReady = true

  let audioDisposed = false
  let destroyed = false
  let finalizing = false
  let accumulatedText = ''
  let pushChain = Promise.resolve()
  const recordedChunks: Float32Array[] = []
  let recordedLength = 0

  // Feed buffered audio that was captured during sherpa init
  for (const buffered of earlyBuffer) {
    recordedChunks.push(buffered)
    recordedLength += buffered.length
    pushChain = pushChain.then(async () => {
      if (destroyed || finalizing) return
      try {
        const result = await desktopPetApi.sherpaFeed({
          samples: buffered,
          sampleRate: audioContext.sampleRate,
        })
        if (destroyed) return
        if (result.endpoint) {
          accumulatedText += `${accumulatedText ? ' ' : ''}${result.endpoint}`
          callbacks.onEndpoint?.(accumulatedText)
        } else if (result.partial) {
          callbacks.onPartial?.(`${accumulatedText}${accumulatedText ? ' ' : ''}${result.partial}`)
        }
      } catch (error) {
        fail(error instanceof Error ? error.message : '本地流式识别出错。')
      }
    })
  }
  earlyBuffer.length = 0

  function buildRecordedAudioSamples() {
    if (!recordedChunks.length || recordedLength <= 0) {
      return null
    }

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

    try {
      sourceNode.disconnect()
    } catch {
      // ignore disconnect errors during teardown
    }

    try {
      processorNode.disconnect()
    } catch {
      // ignore disconnect errors during teardown
    }

    try {
      outputNode.disconnect()
    } catch {
      // ignore disconnect errors during teardown
    }

    stream.getTracks().forEach((track) => track.stop())
    void audioContext.close().catch(() => undefined)
  }

  function fail(message: string) {
    if (destroyed) return
    destroyed = true
    finalizing = true
    teardownAudioGraph()
    desktopPetApi.sherpaAbort().catch(() => undefined)
    callbacks.onError?.(message)
  }

  // Replace early buffer handler with the full live handler
  processorNode.onaudioprocess = (event) => {
    if (destroyed || finalizing) {
      return
    }

    const channelData = event.inputBuffer.getChannelData(0)
    if (!channelData.length) {
      return
    }

    const samples = new Float32Array(channelData)
    recordedChunks.push(samples)
    recordedLength += samples.length
    let energy = 0
    for (const sample of samples) {
      energy += sample * sample
    }
    callbacks.onActivity?.(Math.sqrt(energy / samples.length))

    pushChain = pushChain.then(async () => {
      if (destroyed || finalizing) {
        return
      }

      try {
        const result = await desktopPetApi.sherpaFeed({
          samples,
          sampleRate: audioContext.sampleRate,
        })

        if (destroyed) {
          return
        }

        if (result.endpoint) {
          accumulatedText += `${accumulatedText ? ' ' : ''}${result.endpoint}`
          callbacks.onEndpoint?.(accumulatedText)
          return
        }

        if (result.partial) {
          callbacks.onPartial?.(`${accumulatedText}${accumulatedText ? ' ' : ''}${result.partial}`)
        }
      } catch (error) {
        fail(error instanceof Error ? error.message : '本地流式识别出错。')
      }
    })
  }

  return {
    async stop() {
      if (destroyed) {
        return {
          text: accumulatedText.trim(),
          audioSamples: buildRecordedAudioSamples(),
          sampleRate: audioContext.sampleRate,
        }
      }

      finalizing = true
      teardownAudioGraph()
      await pushChain.catch(() => undefined)

      try {
        const result = await desktopPetApi.sherpaFinish()
        const finalText = result.text.trim()
        if (finalText && finalText !== accumulatedText.trim()) {
          accumulatedText = finalText
        }
      } catch {
        // ignore finish errors and fall back to accumulated partial text
      } finally {
        destroyed = true
      }

      return {
        text: accumulatedText.trim(),
        audioSamples: buildRecordedAudioSamples(),
        sampleRate: audioContext.sampleRate,
      }
    },

    abort() {
      if (destroyed) {
        return
      }

      destroyed = true
      finalizing = true
      teardownAudioGraph()
      desktopPetApi.sherpaAbort().catch(() => undefined)
    },
  }
}

export async function checkSherpaAvailability() {
  if (!window.desktopPet?.sherpaStatus) {
    return { installed: false, modelFound: false, modelsDir: '' }
  }
  return window.desktopPet.sherpaStatus()
}
