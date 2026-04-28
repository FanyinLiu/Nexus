import type { StreamAudioPlayer } from '../../streamAudioPlayer.ts'
import { FrameProcessor } from '../FrameProcessor.ts'
import type { Frame } from '../frames.ts'

export type AudioPlayerSinkOptions = {
  getPlayer: () => StreamAudioPlayer
}

/**
 * Terminal sink that pushes AudioFrames into the existing
 * StreamAudioPlayer. Also owns the "stale turn" guard: any frame whose
 * turnId doesn't match the active StartFrame's turnId is dropped, so a
 * chunk arriving late from an aborted turn can't leak into the next
 * turn's playback.
 *
 *  - StartFrame              → remember turnId, continue forwarding.
 *  - AudioFrame (match)      → player.appendPcmChunk.
 *  - AudioFrame (mismatch)   → dropped (stale).
 *  - InterruptionFrame       → player.stopAndClear() and clear turn.
 *  - EndFrame                → continue forwarding (no drain here;
 *                              callers that need to await playback use
 *                              StreamAudioPlayer.waitForDrain directly).
 *  - shutdown()              → player.stopAndClear() as the final reset.
 */
export class AudioPlayerSink extends FrameProcessor {
  private readonly getPlayer: () => StreamAudioPlayer
  private activeTurnId: string | null = null

  constructor(options: AudioPlayerSinkOptions) {
    super()
    this.getPlayer = options.getPlayer
  }

  override async process(frame: Frame): Promise<void> {
    switch (frame.type) {
      case 'start':
        this.activeTurnId = frame.turnId
        await this.pushDownstream(frame)
        return

      case 'audio':
        if (frame.turnId !== this.activeTurnId) {
          // Stale audio from a cancelled turn — drop silently instead
          // of letting it leak into the next turn's playback.
          return
        }
        // appendPcmChunk returns a Promise on the real player that can
        // reject if the player was torn down between the turn-id check
        // and the call (e.g. a barge-in landed). Catch the rejection so
        // it doesn't surface as an unhandled promise. Test fakes may
        // return undefined synchronously — handle both.
        {
          const result = this.getPlayer()
            .appendPcmChunk(frame.samples, frame.sampleRate, frame.channels)
          if (result && typeof (result as Promise<unknown>).catch === 'function') {
            (result as Promise<unknown>).catch((err) => {
              console.warn('[audio-sink] appendPcmChunk rejected:', err)
            })
          }
        }
        await this.pushDownstream(frame)
        return

      case 'interruption':
        if (frame.turnId === this.activeTurnId) {
          this.getPlayer().stopAndClear()
          this.activeTurnId = null
        }
        await this.pushDownstream(frame)
        return

      case 'end':
        if (frame.turnId === this.activeTurnId) {
          this.activeTurnId = null
        }
        await this.pushDownstream(frame)
        return

      default:
        await this.pushDownstream(frame)
    }
  }

  override async shutdown(): Promise<void> {
    try {
      this.getPlayer().stopAndClear()
    } catch {
      // player may already be torn down; shutdown should not throw.
    }
    this.activeTurnId = null
  }
}
