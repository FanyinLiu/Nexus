/**
 * Renderer-side bridge for Paraformer streaming ASR running in the Electron
 * main process. Captures audio via ScriptProcessor, feeds it to the main
 * process, and receives partial transcription results on every feed call.
 *
 * Unlike SenseVoice (offline), Paraformer is an OnlineRecognizer that returns
 * partial text incrementally, enabling real-time live transcript display.
 */

import { requestVoiceInputStream } from '../voice/runtimeSupport.ts'

const SAMPLE_RATE = 16000
const SCRIPT_PROCESSOR_BUFFER_SIZE = 1024

export type ParaformerStreamCallbacks = {
  onPartial?: (text: string) => void
  onEndpoint?: (text: string) => void
  onActivity?: (rms: number) => void
  onError?: (message: string) => void
}

export type ParaformerStreamStopResult = {
  text: string
}

export type ParaformerStreamSession = {
  stop: () => Promise<ParaformerStreamStopResult>
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

export async function startParaformerStream(
  callbacks: ParaformerStreamCallbacks,
): Promise<ParaformerStreamSession> {
  const desktopPet = window.desktopPet
  if (
    !desktopPet?.paraformerStart
    || !desktopPet.paraformerFeed
    || !desktopPet.paraformerFinish
    || !desktopPet.paraformerAbort
  ) {
    throw new Error('当前环境未连接桌面客户端，无法使用 Paraformer 流式识别。')
  }
  const api = desktopPet

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

  // Buffer audio that arrives before paraformer is ready
  let paraformerReady = false
  const earlyBuffer: Float32Array[] = []
  const MAX_EARLY_BUFFER_SIZE = 16000 * 10

  processorNode.onaudioprocess = (event) => {
    const channelData = event.inputBuffer.getChannelData(0)
    if (!channelData.length) return
    const samples = new Float32Array(channelData)
    if (!paraformerReady) {
      const currentSize = earlyBuffer.reduce((sum, chunk) => sum + chunk.length, 0)
      if (currentSize < MAX_EARLY_BUFFER_SIZE) {
        earlyBuffer.push(samples)
      }
    }
    let energy = 0
    for (const sample of samples) energy += sample * sample
    callbacks.onActivity?.(Math.sqrt(energy / samples.length))
  }

  // Initialize Paraformer recognizer
  try {
    await api.paraformerStart()
  } catch (error) {
    processorNode.onaudioprocess = null
    try { sourceNode.disconnect() } catch { /* */ }
    try { processorNode.disconnect() } catch { /* */ }
    try { outputNode.disconnect() } catch { /* */ }
    stream.getTracks().forEach((track) => track.stop())
    void audioContext.close().catch(() => undefined)
    throw error
  }

  paraformerReady = true

  let audioDisposed = false
  let destroyed = false
  let finalizing = false
  let pushChain = Promise.resolve()

  // Accumulated text from confirmed endpoints
  const endpointTexts: string[] = []

  async function feedAndReport(samples: Float32Array) {
    if (destroyed || finalizing) return
    try {
      const result = await api.paraformerFeed({ samples })
      if (destroyed || finalizing) return

      if (result.text) {
        // Show accumulated endpoints + current partial
        const fullText = [...endpointTexts, result.text].join('')
        callbacks.onPartial?.(fullText)
      }

      if (result.isEndpoint && result.text) {
        endpointTexts.push(result.text)
        callbacks.onEndpoint?.(result.text)
      }
    } catch (error) {
      fail(error instanceof Error ? error.message : 'Paraformer 出错。')
    }
  }

  // Feed buffered audio captured during init
  for (const buffered of earlyBuffer) {
    pushChain = pushChain.then(() => feedAndReport(buffered))
  }
  earlyBuffer.length = 0

  function teardownAudioGraph() {
    if (audioDisposed) return
    audioDisposed = true
    processorNode.onaudioprocess = null
    try { sourceNode.disconnect() } catch { /* */ }
    try { processorNode.disconnect() } catch { /* */ }
    try { outputNode.disconnect() } catch { /* */ }
    stream.getTracks().forEach((track) => track.stop())
    void audioContext.close().catch(() => undefined)
  }

  function fail(message: string) {
    if (destroyed) return
    destroyed = true
    finalizing = true
    teardownAudioGraph()
    api.paraformerAbort().catch(() => undefined)
    callbacks.onError?.(message)
  }

  // Live audio handler
  processorNode.onaudioprocess = (event) => {
    if (destroyed || finalizing) return
    const channelData = event.inputBuffer.getChannelData(0)
    if (!channelData.length) return

    const samples = new Float32Array(channelData)

    let energy = 0
    for (const sample of samples) energy += sample * sample
    callbacks.onActivity?.(Math.sqrt(energy / samples.length))

    pushChain = pushChain.catch(() => undefined).then(() => feedAndReport(samples))
  }

  return {
    async stop() {
      if (destroyed) {
        return { text: endpointTexts.join('') }
      }

      finalizing = true
      teardownAudioGraph()
      await pushChain.catch(() => undefined)

      let remainingText = ''
      try {
        const result = await api.paraformerFinish()
        remainingText = (result.text || '').trim()
      } catch {
        // fall through
      } finally {
        destroyed = true
      }

      const text = [...endpointTexts, remainingText].join('').trim()
      return { text }
    },

    abort() {
      if (destroyed) return
      destroyed = true
      finalizing = true
      teardownAudioGraph()
      api.paraformerAbort().catch(() => undefined)
    },
  }
}

export async function checkParaformerAvailability() {
  if (!window.desktopPet?.paraformerStatus) {
    return { installed: false, modelFound: false, modelsDir: '' }
  }
  return window.desktopPet.paraformerStatus()
}
