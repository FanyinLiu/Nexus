import type { StreamingTtsChunkerOptions } from './streamingTts.ts'

const DEFAULT_MAX_REQUEST_CHARS = 3000
const PROVIDER_MAX_REQUEST_CHARS: Record<string, number> = {
  'kyutai-local': 240,
  'omnivoice-tts': 80,
  'volcengine-tts': 300,
  'voxtral-local': 240,
}

const LOW_LATENCY_DELTA_STREAM_PROVIDERS = new Set([
  'edge-tts',
  'kyutai-local',
  'local-tts',
  'voxtral-local',
])

const LOCAL_ENGINE_PROVIDERS = new Set([
  'kyutai-local',
  'local-tts',
  'omnivoice-tts',
  'voxtral-local',
])

const LOW_LATENCY_CHUNKER_OPTIONS: StreamingTtsChunkerOptions = {
  absoluteMinChunkLength: 2,
  maxChunkLength: 88,
  minForcedChunkLength: 24,
  preferredEarlySplitLength: 18,
  firstChunkMaxLength: 12,
  firstChunkMinForcedChunkLength: 2,
  firstChunkPreferredEarlySplitLength: 2,
}

const DELTA_STREAM_FIRST_AUDIO_BUDGET_MS = 700
const ROUND_BUFFER_FIRST_AUDIO_BUDGET_MS = 1400
const DELTA_STREAM_FIRST_AUDIO_TIMEOUT_MS = 3_000
const ROUND_BUFFER_FIRST_AUDIO_TIMEOUT_MS = 6_000

export type TtsLatencyPolicy = {
  providerId: string
  localEngine: boolean
  deltaStreaming: boolean
  requestMode: 'delta-stream' | 'round-buffer'
  maxRequestChars: number
  firstAudioBudgetMs: number
  firstAudioTimeoutMs: number
  firstChunkMaxLength: number | null
  firstChunkPreferredEarlySplitLength: number | null
  minForcedChunkLength: number
}

export function getMaxRequestCharsForProvider(providerId: string): number {
  return PROVIDER_MAX_REQUEST_CHARS[providerId] ?? DEFAULT_MAX_REQUEST_CHARS
}

export function shouldStreamTtsDeltasForProvider(providerId: string): boolean {
  return LOW_LATENCY_DELTA_STREAM_PROVIDERS.has(providerId)
}

export function getStreamingTtsChunkerOptionsForProvider(providerId: string): StreamingTtsChunkerOptions {
  if (shouldStreamTtsDeltasForProvider(providerId)) {
    return LOW_LATENCY_CHUNKER_OPTIONS
  }

  return {
    maxChunkLength: getMaxRequestCharsForProvider(providerId),
    minForcedChunkLength: Math.min(72, getMaxRequestCharsForProvider(providerId)),
    preferredEarlySplitLength: Math.min(48, getMaxRequestCharsForProvider(providerId)),
  }
}

export function resolveTtsLatencyPolicy(providerId: string): TtsLatencyPolicy {
  const chunkerOptions = getStreamingTtsChunkerOptionsForProvider(providerId)
  const deltaStreaming = shouldStreamTtsDeltasForProvider(providerId)

  return {
    providerId,
    localEngine: LOCAL_ENGINE_PROVIDERS.has(providerId),
    deltaStreaming,
    requestMode: deltaStreaming ? 'delta-stream' : 'round-buffer',
    maxRequestChars: getMaxRequestCharsForProvider(providerId),
    firstAudioBudgetMs: deltaStreaming
      ? DELTA_STREAM_FIRST_AUDIO_BUDGET_MS
      : ROUND_BUFFER_FIRST_AUDIO_BUDGET_MS,
    firstAudioTimeoutMs: deltaStreaming
      ? DELTA_STREAM_FIRST_AUDIO_TIMEOUT_MS
      : ROUND_BUFFER_FIRST_AUDIO_TIMEOUT_MS,
    firstChunkMaxLength: deltaStreaming ? chunkerOptions.firstChunkMaxLength ?? null : null,
    firstChunkPreferredEarlySplitLength: deltaStreaming
      ? chunkerOptions.firstChunkPreferredEarlySplitLength ?? null
      : null,
    minForcedChunkLength: chunkerOptions.minForcedChunkLength ?? 0,
  }
}
