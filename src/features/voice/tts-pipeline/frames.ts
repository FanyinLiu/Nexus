// Pipeline frames — the atomic units that flow between FrameProcessors.
// Modelled after pipecat: every step of the TTS pipeline sees the same
// shape, so interruption / end-of-turn / backpressure all ride the same
// channel as the actual work frames.
//
// Each frame carries a `turnId` so a stale audio chunk from a cancelled
// turn can't slip into the player after a new turn has started — sinks
// drop any frame whose turnId does not match the one they're currently
// processing.

export type FrameBase = {
  id: string
  ts: number
  turnId: string
}

/** Marks the start of a new chat turn. Processors reset per-turn state. */
export type StartFrame = FrameBase & {
  type: 'start'
}

/**
 * Raw LLM text delta. Emitted by the chat streaming callback as tokens
 * arrive. SentenceAggregator groups these into TextSentenceFrames.
 */
export type TextDeltaFrame = FrameBase & {
  type: 'text-delta'
  text: string
}

/**
 * One complete sentence ready to synthesize. SentenceAggregator emits
 * these; TTSServices consume them.
 */
export type TextSentenceFrame = FrameBase & {
  type: 'text-sentence'
  text: string
  segmentIndex: number
}

/** A chunk of PCM audio produced by a TTSService. Consumed by the player sink. */
export type AudioFrame = FrameBase & {
  type: 'audio'
  samples: Float32Array
  sampleRate: number
  channels: number
  segmentIndex: number
}

/**
 * Marks the end of the audio stream for one sentence segment. Player sinks
 * use it to schedule gap-free transitions between adjacent segments.
 */
export type AudioEndFrame = FrameBase & {
  type: 'audio-end'
  segmentIndex: number
}

/**
 * Marks the end of the whole turn. Flows after the last TextDeltaFrame;
 * aggregators flush pending buffers, services close sessions, sinks wait
 * for drain before signalling completion.
 */
export type EndFrame = FrameBase & {
  type: 'end'
}

/**
 * Immediate interruption — user barged in, chat was cancelled, timeout
 * fired. Downstream processors drop queued work, abort in-flight
 * requests, and stop playback. Distinct from EndFrame (which is clean
 * completion) so sinks can tell "finish what you started" from
 * "throw it out NOW".
 */
export type InterruptionFrame = FrameBase & {
  type: 'interruption'
  reason: 'user-barge-in' | 'abort-requested' | 'timeout' | 'error'
}

/**
 * Propagates a synthesis/playback error up the pipeline. Sinks can log
 * or surface to UI; the pipeline itself keeps running so subsequent
 * segments can still be attempted.
 */
export type ErrorFrame = FrameBase & {
  type: 'error'
  message: string
  segmentIndex?: number
}

export type Frame =
  | StartFrame
  | TextDeltaFrame
  | TextSentenceFrame
  | AudioFrame
  | AudioEndFrame
  | EndFrame
  | InterruptionFrame
  | ErrorFrame

// Frame factories — centralised so `id` stays monotonic and `ts` is
// stamped at creation (useful when debugging out-of-order arrival).

let nextFrameSequence = 0
function nextFrameId(): string {
  nextFrameSequence += 1
  return `f${nextFrameSequence.toString(36)}`
}

type FramePayload<T extends Frame['type']> = Omit<Extract<Frame, { type: T }>, keyof FrameBase | 'type'>

function makeFrame<T extends Frame['type']>(type: T, turnId: string, payload: FramePayload<T>): Extract<Frame, { type: T }> {
  return {
    type,
    id: nextFrameId(),
    ts: Date.now(),
    turnId,
    ...payload,
  } as Extract<Frame, { type: T }>
}

export function createStartFrame(turnId: string): StartFrame {
  return makeFrame('start', turnId, {} as FramePayload<'start'>)
}

export function createTextDeltaFrame(turnId: string, text: string): TextDeltaFrame {
  return makeFrame('text-delta', turnId, { text })
}

export function createTextSentenceFrame(turnId: string, text: string, segmentIndex: number): TextSentenceFrame {
  return makeFrame('text-sentence', turnId, { text, segmentIndex })
}

export function createAudioFrame(
  turnId: string,
  samples: Float32Array,
  sampleRate: number,
  channels: number,
  segmentIndex: number,
): AudioFrame {
  return makeFrame('audio', turnId, { samples, sampleRate, channels, segmentIndex })
}

export function createAudioEndFrame(turnId: string, segmentIndex: number): AudioEndFrame {
  return makeFrame('audio-end', turnId, { segmentIndex })
}

export function createEndFrame(turnId: string): EndFrame {
  return makeFrame('end', turnId, {} as FramePayload<'end'>)
}

export function createInterruptionFrame(turnId: string, reason: InterruptionFrame['reason']): InterruptionFrame {
  return makeFrame('interruption', turnId, { reason })
}

export function createErrorFrame(turnId: string, message: string, segmentIndex?: number): ErrorFrame {
  return makeFrame('error', turnId, { message, segmentIndex })
}

/** Whether a frame terminates the current turn (EndFrame or InterruptionFrame). */
export function isTerminalFrame(frame: Frame): boolean {
  return frame.type === 'end' || frame.type === 'interruption'
}
