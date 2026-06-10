import { clamp } from '../../lib/common.ts'

export type SpeechLevelControllerOptions = {
  onLevelChange: (level: number) => void
  simulationIntervalMs?: number
  analyserFftSize?: number
}

export type SpeechLevelController = {
  stop: () => void
  simulateText: (text: string, rate: number) => void
  trackAudioElement: (audio: HTMLAudioElement, fallbackText?: string, fallbackRate?: number) => void
}

export function createSpeechLevelController(
  options: SpeechLevelControllerOptions,
): SpeechLevelController {
  let animationFrameId: number | null = null
  let simulationTimerId: number | null = null
  let cleanupAudio: (() => void) | null = null

  const stop = () => {
    if (animationFrameId) {
      window.cancelAnimationFrame(animationFrameId)
      animationFrameId = null
    }

    if (simulationTimerId) {
      window.clearInterval(simulationTimerId)
      simulationTimerId = null
    }

    cleanupAudio?.()
    cleanupAudio = null
    options.onLevelChange(0)
  }

  const simulateText = (text: string, rate: number) => {
    stop()

    const frames = Array.from(text.trim())
    if (!frames.length) {
      return
    }

    let cursor = 0
    simulationTimerId = window.setInterval(() => {
      const char = frames[cursor % frames.length] ?? ''
      const isSoftPause = /[\s,，。.!！？、:：;；~]/u.test(char)
      const targetLevel = isSoftPause
        ? 0.08 + Math.random() * 0.08
        : 0.32 + Math.random() * 0.46

      options.onLevelChange(targetLevel)
      cursor += 1
    }, Math.max(64, (options.simulationIntervalMs ?? 88) / Math.max(rate, 0.65)))
  }

  const trackAudioElement = (audio: HTMLAudioElement, fallbackText = 'voice', fallbackRate = 1) => {
    stop()

    try {
      const audioContext = new AudioContext()
      const analyser = audioContext.createAnalyser()
      analyser.fftSize = options.analyserFftSize ?? 512

      const source = audioContext.createMediaElementSource(audio)
      source.connect(analyser)
      analyser.connect(audioContext.destination)

      const dataArray = new Uint8Array(analyser.fftSize)
      let disposed = false

      const tick = () => {
        if (disposed) {
          return
        }

        analyser.getByteTimeDomainData(dataArray)
        let sum = 0

        for (const value of dataArray) {
          const normalized = (value - 128) / 128
          sum += normalized * normalized
        }

        const rms = Math.sqrt(sum / dataArray.length)
        options.onLevelChange(clamp((rms - 0.011) * 7.5, 0, 1))
        animationFrameId = window.requestAnimationFrame(tick)
      }

      cleanupAudio = () => {
        disposed = true
        void audioContext.close().catch(() => undefined)
      }

      void audioContext.resume().catch(() => undefined)
      animationFrameId = window.requestAnimationFrame(tick)
    } catch {
      simulateText(fallbackText, fallbackRate)
    }
  }

  return {
    stop,
    simulateText,
    trackAudioElement,
  }
}
