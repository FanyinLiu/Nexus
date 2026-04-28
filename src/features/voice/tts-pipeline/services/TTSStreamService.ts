import type { AppSettings, TtsStreamEvent } from '../../../../types'
import { FrameProcessor } from '../FrameProcessor.ts'
import type { Frame } from '../frames.ts'
import { createAudioFrame, createErrorFrame } from '../frames.ts'

/**
 * Narrow subset of settings the service actually reads — keeps the mock
 * surface small in tests and makes it obvious which fields matter.
 */
export type TTSStreamServiceSettings = Pick<
  AppSettings,
  | 'speechOutputProviderId'
  | 'speechOutputApiBaseUrl'
  | 'speechOutputApiKey'
  | 'speechOutputModel'
  | 'speechOutputVoice'
  | 'speechOutputInstructions'
  | 'speechSynthesisLang'
  | 'speechRate'
  | 'speechPitch'
  | 'speechVolume'
>

/**
 * IPC surface mirrored from window.desktopPet so tests can pass a mock
 * without touching the Electron bridge.
 */
export interface TtsIpcBridge {
  ttsStreamStart: (payload: Record<string, unknown>) => Promise<unknown>
  ttsStreamPushText: (payload: Record<string, unknown>) => Promise<unknown>
  ttsStreamFinish: (payload: Record<string, unknown>) => Promise<unknown>
  ttsStreamAbort: (payload: Record<string, unknown>) => Promise<unknown>
  subscribeTtsStream: (listener: (event: TtsStreamEvent) => void) => () => void
}

export type TTSStreamServiceOptions = {
  settings: TTSStreamServiceSettings
  ipc: TtsIpcBridge
  /** Test hook — override the requestId generator so fixtures are stable. */
  createRequestId?: (turnId: string) => string
}

const DEFAULT_REQUEST_ID = (turnId: string): string => `tts-${turnId}-${Date.now()}`

function toFloat32(samples: Float32Array | number[]): Float32Array {
  return samples instanceof Float32Array ? samples : Float32Array.from(samples)
}

/**
 * Bridges TextSentenceFrames to the existing main-process TTS stream
 * (`tts:stream-start` / `push-text` / `finish` / `abort` IPCs) and
 * turns the inbound chunk/end/error events back into AudioFrame /
 * ErrorFrame. Single implementation for every provider — the main
 * process already abstracts provider differences behind its stream
 * contract, so the pipeline stays provider-agnostic.
 *
 * Lifecycle per turn:
 *
 *   StartFrame             → reset state, pick a fresh requestId,
 *                            subscribe to the tts:stream-event feed.
 *                            Does NOT call ttsStreamStart yet — the
 *                            first TextSentenceFrame triggers it, so
 *                            an empty turn never opens a session.
 *
 *   TextSentenceFrame      → lazy-start the stream, push the sentence
 *                            via ttsStreamPushText. Events published
 *                            by the main process reach us through the
 *                            subscription and become AudioFrames.
 *
 *   EndFrame               → if a session was started, call
 *                            ttsStreamFinish so the main process can
 *                            drain its chain and emit its own 'end'
 *                            event. Forwards the EndFrame downstream.
 *
 *   InterruptionFrame      → ttsStreamAbort, drop the subscription,
 *                            forward.
 *
 *   Any off-turn frame     → forwarded as-is; the stale-turn guard on
 *                            AudioPlayerSink handles the drop.
 */
export class TTSStreamService extends FrameProcessor {
  private readonly settings: TTSStreamServiceSettings
  private readonly ipc: TtsIpcBridge
  private readonly createRequestId: (turnId: string) => string

  private activeTurnId: string | null = null
  private requestId: string | null = null
  private startPromise: Promise<unknown> | null = null
  private unsubscribe: (() => void) | null = null
  private segmentIndex = 0

  constructor(options: TTSStreamServiceOptions) {
    super()
    this.settings = options.settings
    this.ipc = options.ipc
    this.createRequestId = options.createRequestId ?? DEFAULT_REQUEST_ID
  }

  override async process(frame: Frame): Promise<void> {
    switch (frame.type) {
      case 'start':
        await this.reset()
        this.activeTurnId = frame.turnId
        this.requestId = this.createRequestId(frame.turnId)
        this.segmentIndex = 0
        this.subscribe()
        await this.pushDownstream(frame)
        return

      case 'text-sentence':
        if (frame.turnId !== this.activeTurnId) {
          await this.pushDownstream(frame)
          return
        }
        try {
          await this.ensureStarted()
          await this.ipc.ttsStreamPushText({
            requestId: this.requestId,
            text: frame.text,
          })
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          await this.pushDownstream(createErrorFrame(frame.turnId, message, frame.segmentIndex))
        }
        await this.pushDownstream(frame)
        return

      case 'end':
        if (frame.turnId === this.activeTurnId && this.startPromise && this.requestId) {
          try {
            await this.ipc.ttsStreamFinish({ requestId: this.requestId })
          } catch {
            // main-side session is already gone — nothing to do.
          }
        }
        await this.pushDownstream(frame)
        return

      case 'interruption':
        if (frame.turnId === this.activeTurnId) {
          await this.abortSession()
        }
        await this.pushDownstream(frame)
        return

      default:
        await this.pushDownstream(frame)
    }
  }

  override async shutdown(): Promise<void> {
    await this.abortSession()
    this.activeTurnId = null
    this.requestId = null
  }

  private subscribe(): void {
    const listener = (event: TtsStreamEvent): void => {
      this.handleIpcEvent(event)
    }
    this.unsubscribe = this.ipc.subscribeTtsStream(listener)
  }

  private handleIpcEvent(event: TtsStreamEvent): void {
    if (!this.activeTurnId || !this.requestId) return
    if (event.requestId !== this.requestId) return

    if (event.type === 'chunk') {
      const frame = createAudioFrame(
        this.activeTurnId,
        toFloat32(event.samples),
        event.sampleRate,
        event.channels,
        this.segmentIndex,
      )
      // Catch downstream errors so a sink throw (e.g. AudioPlayerSink
      // rejected after teardown) doesn't surface as an unhandled
      // promise rejection. The frame's loss is acceptable; the chat
      // path already proceeds even when audio fails.
      this.pushDownstream(frame).catch((err) => {
        console.warn('[tts-stream] downstream rejected:', err)
      })
      return
    }

    if (event.type === 'error') {
      const frame = createErrorFrame(this.activeTurnId, event.message)
      this.pushDownstream(frame).catch((err) => {
        console.warn('[tts-stream] downstream rejected on error frame:', err)
      })
    }
    // 'end' events come from the main process once its whole chain has
    // drained. We don't emit a downstream frame for them — AudioPlayerSink
    // plays whatever has already been appended and a waiting caller
    // (e.g. the old streamingSpeechOutput replacement) can watch via
    // Pipeline.stop or an explicit waitForDrain on the player.
  }

  private async ensureStarted(): Promise<unknown> {
    if (this.startPromise) return this.startPromise
    if (!this.requestId) {
      throw new Error('TTSStreamService: start requested before a turn began.')
    }
    this.startPromise = this.ipc.ttsStreamStart({
      requestId: this.requestId,
      providerId: this.settings.speechOutputProviderId,
      baseUrl: this.settings.speechOutputApiBaseUrl,
      apiKey: this.settings.speechOutputApiKey,
      model: this.settings.speechOutputModel,
      voice: this.settings.speechOutputVoice,
      instructions: this.settings.speechOutputInstructions,
      language: this.settings.speechSynthesisLang,
      rate: this.settings.speechRate,
      pitch: this.settings.speechPitch,
      volume: this.settings.speechVolume,
    })
    return this.startPromise
  }

  private async abortSession(): Promise<void> {
    if (this.unsubscribe) {
      try {
        this.unsubscribe()
      } catch {
        // unsubscribe should never throw; guard anyway so reset() can
        // run to completion.
      }
      this.unsubscribe = null
    }
    if (this.requestId && this.startPromise) {
      try {
        await this.ipc.ttsStreamAbort({ requestId: this.requestId })
      } catch {
        // main already tore the session down — nothing to do.
      }
    }
    this.startPromise = null
  }

  private async reset(): Promise<void> {
    await this.abortSession()
    this.activeTurnId = null
    this.requestId = null
    this.segmentIndex = 0
  }
}
