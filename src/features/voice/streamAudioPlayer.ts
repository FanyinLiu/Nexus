import { clamp } from '../../lib/common'
import { t } from '../../i18n/runtime.ts'

type StreamAudioPlayerOptions = {
  initialBufferSeconds?: number
  onPlaybackStart?: () => void
  onPlaybackEnd?: () => void
  onPlaybackError?: (message: string) => void
  onLevel?: (level: number) => void
}

const DEFAULT_INITIAL_BUFFER_SECONDS = 0.03
const SCHEDULE_LOOKAHEAD_SECONDS = 0.02
const CHUNK_TRANSITION_SMOOTH_MS = 2
const STREAM_START_PREROLL_MS = 12
const STREAM_START_RAMP_MS = 1

function calculateChunkLevel(samples: Float32Array) {
  if (!samples.length) {
    return 0
  }

  let sum = 0
  for (let index = 0; index < samples.length; index += 1) {
    const sample = samples[index] ?? 0
    sum += sample * sample
  }

  const rms = Math.sqrt(sum / samples.length)
  return clamp((rms - 0.01) * 6, 0, 1)
}

function addStreamStartPreroll(samples: Float32Array, sampleRate: number) {
  if (!samples.length || !sampleRate || sampleRate <= 0) {
    return samples
  }

  const prerollSamples = Math.max(
    1,
    Math.floor((sampleRate * STREAM_START_PREROLL_MS) / 1000),
  )
  const output = new Float32Array(prerollSamples + samples.length)
  output.set(samples, prerollSamples)

  const rampSamples = Math.min(
    Math.floor((sampleRate * STREAM_START_RAMP_MS) / 1000),
    samples.length,
  )

  if (rampSamples >= 2) {
    for (let index = 0; index < rampSamples; index += 1) {
      const gain = (index + 1) / rampSamples
      output[prerollSamples + index] *= gain
    }
  }

  return output
}

function smoothChunkBoundary(
  samples: Float32Array,
  sampleRate: number,
  previousTailSample: number | null,
  useStreamStartPreroll: boolean,
) {
  if (!samples.length || !sampleRate || sampleRate <= 0) {
    return samples
  }

  const output = samples.slice()

  const transitionSamples = Math.min(
    Math.floor((sampleRate * CHUNK_TRANSITION_SMOOTH_MS) / 1000),
    output.length,
  )

  if (previousTailSample !== null && transitionSamples >= 2) {
    for (let index = 0; index < transitionSamples; index += 1) {
      const mix = (index + 1) / (transitionSamples + 1)
      output[index] = previousTailSample * (1 - mix) + output[index] * mix
    }
    return output
  }

  if (!useStreamStartPreroll) {
    return output
  }

  return addStreamStartPreroll(output, sampleRate)
}

export class StreamAudioPlayer {
  private readonly options: StreamAudioPlayerOptions
  private audioContext: AudioContext | null = null
  private analyser: AnalyserNode | null = null
  private masterGain: GainNode | null = null
  private nextStartTime = 0
  private started = false
  private stopped = false
  private pendingSources = 0
  private drainResolvers: Array<() => void> = []
  private drainTailTimers: number[] = []
  private endTimerId: number | null = null
  private levelFrameId: number | null = null
  private playbackEndedNotified = false
  private readonly activeSources = new Set<AudioBufferSourceNode>()
  private keepaliveOsc: OscillatorNode | null = null
  private lastQueuedSample: number | null = null
  private lastQueuedSampleRate: number | null = null

  constructor(options: StreamAudioPlayerOptions = {}) {
    this.options = options
  }

  appendPcmChunk(samples: Float32Array | number[], sampleRate: number, channels = 1) {
    if (this.stopped) {
      return Promise.reject(new Error(t('voice.audio.playback_stopped')))
    }

    if (!sampleRate || sampleRate <= 0) {
      return Promise.reject(new Error(t('voice.audio.stream_invalid_sample_rate')))
    }

    if (channels !== 1) {
      return Promise.reject(new Error(t('voice.audio.stream_mono_only')))
    }

    try {
      const context = this.ensureAudioContext()
      let chunk = samples instanceof Float32Array ? samples : new Float32Array(samples)
      if (!chunk.length) {
        return Promise.resolve()
      }

      const sameRateAsPrevious = this.lastQueuedSampleRate === sampleRate
      const isFirstChunk = this.lastQueuedSample === null
      chunk = smoothChunkBoundary(
        chunk,
        sampleRate,
        sameRateAsPrevious ? this.lastQueuedSample : null,
        isFirstChunk,
      )
      this.lastQueuedSample = chunk[chunk.length - 1] ?? this.lastQueuedSample
      this.lastQueuedSampleRate = sampleRate

      const buffer = context.createBuffer(1, chunk.length, sampleRate)
      buffer.getChannelData(0).set(chunk)

      const source = context.createBufferSource()
      source.buffer = buffer
      source.connect(this.masterGain!)

      const now = context.currentTime
      const initialBuffer = this.options.initialBufferSeconds ?? DEFAULT_INITIAL_BUFFER_SECONDS
      const startAt = this.nextStartTime > now + SCHEDULE_LOOKAHEAD_SECONDS
        ? this.nextStartTime
        : now + initialBuffer

      this.nextStartTime = startAt + buffer.duration
      this.pendingSources += 1
      this.activeSources.add(source)
      this.clearEndTimer()
      this.startLevelLoop()
      this.options.onLevel?.(calculateChunkLevel(chunk))

      source.onended = () => {
        this.activeSources.delete(source)
        this.pendingSources = Math.max(0, this.pendingSources - 1)
        if (this.pendingSources === 0) {
          this.options.onLevel?.(0)
          this.scheduleDrainResolution()
        }
      }

      if (!this.started) {
        this.started = true
        this.options.onPlaybackStart?.()
      }

      source.start(startAt)
      void context.resume().catch(() => undefined)
      return Promise.resolve()
    } catch (error) {
      const message = error instanceof Error ? error.message : t('voice.audio.stream_playback_failed')
      this.options.onPlaybackError?.(message)
      return Promise.reject(error instanceof Error ? error : new Error(message))
    }
  }

  waitForDrain() {
    if (this.stopped) {
      return Promise.resolve()
    }

    if (this.started && this.pendingSources === 0) {
      // All AudioBufferSourceNode.onended callbacks have fired, but there may still be
      // audio in the output pipeline. Add a small buffer to avoid cutting off the tail.
      const DRAIN_TAIL_MS = 30
      return new Promise<void>((resolve) => {
        // Track the timer so stopAndClear can cancel it. Without this,
        // a stop during the drain tail would still resolve waitForDrain
        // late (the resolve is harmless, but the resolved promise then
        // races against the now-stopped pipeline state).
        const id = window.setTimeout(resolve, DRAIN_TAIL_MS)
        this.drainTailTimers.push(id)
      })
    }

    return new Promise<void>((resolve) => {
      this.drainResolvers.push(resolve)
    })
  }

  stopAndClear() {
    if (this.stopped) {
      return
    }

    this.stopped = true
    this.nextStartTime = 0
    this.pendingSources = 0
    this.lastQueuedSample = null
    this.lastQueuedSampleRate = null
    this.clearEndTimer()
    this.stopLevelLoop()
    this.options.onLevel?.(0)
    // Cancel any pending drain-tail timers and resolve their promises
    // immediately, so callers awaiting waitForDrain don't hang for the
    // 30ms tail when the pipeline was already stopped.
    for (const id of this.drainTailTimers) window.clearTimeout(id)
    this.drainTailTimers.length = 0
    this.resolveDrainResolvers()

    const sources = Array.from(this.activeSources)
    this.activeSources.clear()
    sources.forEach((source) => {
      try {
        source.onended = null
        source.stop()
      } catch {
        // no-op
      }
    })

    try { this.keepaliveOsc?.stop() } catch { /* no-op */ }
    this.keepaliveOsc = null

    const context = this.audioContext
    // Close the context first, then clear the references
    if (context) {
      try {
        void context.close().catch(() => undefined)
      } catch {
        // no-op
      }
    }
    this.audioContext = null
    this.analyser = null
    this.masterGain = null
  }

  private ensureAudioContext() {
    if (this.audioContext && this.masterGain && this.analyser) {
      return this.audioContext
    }

    const context = new AudioContext()
    const analyser = context.createAnalyser()
    analyser.fftSize = 512
    analyser.smoothingTimeConstant = 0.22

    const masterGain = context.createGain()
    masterGain.gain.value = 0.94
    masterGain.connect(analyser)
    analyser.connect(context.destination)

    // Keepalive: inaudible oscillator prevents AudioContext auto-suspension
    const osc = context.createOscillator()
    osc.frequency.value = 1
    const silentGain = context.createGain()
    silentGain.gain.value = 0.00001
    osc.connect(silentGain)
    silentGain.connect(context.destination)
    osc.start()
    this.keepaliveOsc = osc

    this.audioContext = context
    this.analyser = analyser
    this.masterGain = masterGain
    this.nextStartTime = 0
    return context
  }

  private scheduleDrainResolution() {
    const context = this.audioContext
    if (!context) {
      this.finishPlayback()
      return
    }

    const remainingMs = Math.max(0, (this.nextStartTime - context.currentTime) * 1000)
    this.endTimerId = window.setTimeout(() => {
      this.endTimerId = null
      this.finishPlayback()
    }, remainingMs + 24)
  }

  private finishPlayback() {
    this.lastQueuedSample = null
    this.lastQueuedSampleRate = null
    this.resolveDrainResolvers()
    if (this.started && !this.playbackEndedNotified) {
      this.playbackEndedNotified = true
      this.options.onPlaybackEnd?.()
    }
    this.stopLevelLoop()
    this.options.onLevel?.(0)
  }

  private resolveDrainResolvers() {
    const resolvers = this.drainResolvers.splice(0)
    resolvers.forEach((resolve) => resolve())
  }

  private clearEndTimer() {
    if (this.endTimerId !== null) {
      window.clearTimeout(this.endTimerId)
      this.endTimerId = null
    }
    this.playbackEndedNotified = false
  }

  private startLevelLoop() {
    if (this.levelFrameId !== null || !this.analyser) {
      return
    }

    const analyser = this.analyser
    const dataArray = new Uint8Array(analyser.fftSize)

    const tick = () => {
      if (!this.analyser || this.levelFrameId === null) {
        return
      }

      analyser.getByteTimeDomainData(dataArray)
      let sum = 0
      for (const value of dataArray) {
        const normalized = (value - 128) / 128
        sum += normalized * normalized
      }

      const rms = Math.sqrt(sum / dataArray.length)
      this.options.onLevel?.(clamp((rms - 0.012) * 8, 0, 1))
      this.levelFrameId = window.requestAnimationFrame(tick)
    }

    this.levelFrameId = window.requestAnimationFrame(tick)
  }

  private stopLevelLoop() {
    if (this.levelFrameId !== null) {
      window.cancelAnimationFrame(this.levelFrameId)
      this.levelFrameId = null
    }
  }
}
