import type { Frame } from './frames.ts'
import { isTerminalFrame } from './frames.ts'
import type { FrameProcessor } from './FrameProcessor.ts'

/**
 * A linear chain of FrameProcessors. Frames enter at the head via
 * `push`; each processor forwards downstream via `pushDownstream`.
 *
 * Kept deliberately simple (no branching, no fan-out) — the Nexus TTS
 * path is fundamentally linear (text delta → sentence → audio → player
 * sink). If we ever need fan-out (e.g. tap an inspection sink), we can
 * introduce a TeeProcessor without changing Pipeline.
 */
export class Pipeline {
  private readonly processors: FrameProcessor[]
  private stopped = false

  constructor(processors: FrameProcessor[]) {
    if (processors.length === 0) {
      throw new Error('Pipeline requires at least one processor.')
    }
    this.processors = processors
    for (let i = 0; i < processors.length - 1; i += 1) {
      processors[i].linkDownstream(processors[i + 1])
    }
  }

  /**
   * Feed a frame into the head of the pipeline. No-ops after `stop()`
   * has been called so late arrivals from an aborted turn cannot wake
   * the pipeline up again.
   */
  async push(frame: Frame): Promise<void> {
    if (this.stopped) return
    await this.processors[0].process(frame)
  }

  /**
   * Convenience: send an InterruptionFrame or EndFrame through the
   * pipeline and then shut it down once the terminal frame has
   * propagated. Callers wanting finer control can push frames and call
   * `stop()` themselves.
   */
  async pushAndStop(terminalFrame: Frame): Promise<void> {
    if (!isTerminalFrame(terminalFrame)) {
      throw new Error(`pushAndStop expects a terminal frame, got ${terminalFrame.type}.`)
    }
    await this.push(terminalFrame)
    await this.stop()
  }

  /**
   * Tear down every processor, releasing resources that terminal frames
   * alone wouldn't cover (open sockets, timers, AudioContext). Idempotent.
   * Errors from individual processors are swallowed — a failing shutdown
   * in one processor must not block the others from cleaning up.
   */
  async stop(): Promise<void> {
    if (this.stopped) return
    this.stopped = true
    await Promise.allSettled(this.processors.map((processor) => processor.shutdown()))
  }

  isStopped(): boolean {
    return this.stopped
  }
}
