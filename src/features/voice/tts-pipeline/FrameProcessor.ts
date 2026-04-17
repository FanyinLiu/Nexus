import type { Frame } from './frames.ts'

/**
 * Base class for every node in the TTS pipeline. Subclasses override
 * `process` to react to frames and `pushDownstream` to emit frames to
 * the next processor. Designed to mirror pipecat's FrameProcessor so
 * concepts transfer directly:
 *
 *  - A processor may emit zero, one, or many frames per input frame
 *    (e.g. SentenceAggregator buffers until a sentence boundary; one
 *    TextSentenceFrame may expand into many AudioFrames at the
 *    TTSService).
 *  - Terminal frames (EndFrame, InterruptionFrame) MUST be forwarded
 *    downstream after the processor has flushed/cancelled its own
 *    state. Failing to forward strands the downstream processors in
 *    "still waiting" state.
 *  - `shutdown()` is called once by the Pipeline when it stops, and
 *    should release resources (open HTTP connections, timers) that a
 *    terminal frame alone wouldn't cover.
 */
export abstract class FrameProcessor {
  private downstream: FrameProcessor | null = null

  /** Link the next processor so `pushDownstream` reaches it. */
  linkDownstream(next: FrameProcessor): void {
    this.downstream = next
  }

  /** Inspect the currently-linked downstream (mainly for tests). */
  getDownstream(): FrameProcessor | null {
    return this.downstream
  }

  /** Handle an incoming frame. Default: forward as-is. */
  async process(frame: Frame): Promise<void> {
    await this.pushDownstream(frame)
  }

  /**
   * Emit a frame to the downstream processor. Returns immediately if no
   * downstream is linked (e.g. running a processor in a unit test).
   */
  protected async pushDownstream(frame: Frame): Promise<void> {
    if (!this.downstream) return
    await this.downstream.process(frame)
  }

  /**
   * Final cleanup when the pipeline stops. Runs after any terminal
   * frames have propagated. Processors that hold network connections,
   * timers, or audio context resources release them here. Safe to call
   * multiple times.
   */
  async shutdown(): Promise<void> {
    // default: nothing
  }
}
