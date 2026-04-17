// Public surface of the TTS pipeline. Phase 1: scaffolding only — no
// processor implementations yet. Subsequent phases fill in:
//
//   phase 2: aggregator/SentenceAggregator + sinks/AudioPlayerSink
//   phase 3: services/VolcengineTTSService + runner wiring
//   phase 4: remaining providers
//   phase 5: InterruptionFrame end-to-end integration
//   phase 6: delete src/hooks/voice/streamingSpeechOutput.ts

export {
  createStartFrame,
  createTextDeltaFrame,
  createTextSentenceFrame,
  createAudioFrame,
  createAudioEndFrame,
  createEndFrame,
  createInterruptionFrame,
  createErrorFrame,
  isTerminalFrame,
} from './frames.ts'
export type {
  Frame,
  FrameBase,
  StartFrame,
  TextDeltaFrame,
  TextSentenceFrame,
  AudioFrame,
  AudioEndFrame,
  EndFrame,
  InterruptionFrame,
  ErrorFrame,
} from './frames.ts'

export { FrameProcessor } from './FrameProcessor.ts'
export { Pipeline } from './Pipeline.ts'
