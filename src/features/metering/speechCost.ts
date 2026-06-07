import { getCoreRuntime } from '../../lib/coreRuntime.ts'
import type { CoreRuntime } from '../../lib/coreRuntime.ts'

function safeCoreRuntime(): CoreRuntime | undefined {
  try {
    return getCoreRuntime()
  } catch {
    // CoreRuntime is not initialized in early-boot or test contexts.
    return undefined
  }
}

const TTS_PRICE_PER_M_CHARS: Record<string, number> = {
  'tts-1': 15,
  'tts-1-hd': 30,
  'gpt-4o-mini-tts': 12,
  'eleven_multilingual_v2': 30,
  'eleven_turbo_v2': 30,
}

const STT_PRICE_PER_MINUTE: Record<string, number> = {
  'whisper-1': 0.006,
  'gpt-4o-transcribe': 0.006,
  'gpt-4o-mini-transcribe': 0.003,
}

function lookupTtsRate(modelId: string): number {
  const direct = TTS_PRICE_PER_M_CHARS[modelId]
  if (direct !== undefined) return direct
  for (const [key, rate] of Object.entries(TTS_PRICE_PER_M_CHARS)) {
    if (modelId.includes(key)) return rate
  }
  return 0
}

function lookupSttRate(modelId: string): number {
  const direct = STT_PRICE_PER_MINUTE[modelId]
  if (direct !== undefined) return direct
  for (const [key, rate] of Object.entries(STT_PRICE_PER_MINUTE)) {
    if (modelId.includes(key)) return rate
  }
  return 0
}

function normalizeMeteringId(value: string): string {
  return String(value ?? '').trim()
}

function recordAuxiliaryUsage(input: {
  kind: 'tts' | 'stt' | 'embedding'
  providerId: string
  modelId: string
  fallbackModelId: string
  units: number
  costUsd: number
}): void {
  const providerId = normalizeMeteringId(input.providerId)
  if (!providerId) return

  const modelId = normalizeMeteringId(input.modelId)
    || providerId
    || input.fallbackModelId
  const runtime = safeCoreRuntime()
  if (!runtime) return

  try {
    runtime.costTracker.recordAuxiliary({
      kind: input.kind,
      providerId,
      modelId,
      units: input.units,
      costUsd: input.costUsd,
    })
    runtime.persistBudget()
  } catch (error) {
    console.warn('[metering] Failed to record auxiliary usage:', error instanceof Error ? error.message : error)
  }
}

export function recordTtsUsage(input: {
  providerId: string
  modelId: string
  text: string
}): void {
  const chars = input.text.length
  if (!chars) return
  const modelId = normalizeMeteringId(input.modelId) || normalizeMeteringId(input.providerId) || 'tts'
  const ratePerMillion = lookupTtsRate(modelId)
  const costUsd = (chars / 1_000_000) * ratePerMillion
  recordAuxiliaryUsage({
    kind: 'tts',
    providerId: input.providerId,
    modelId,
    fallbackModelId: 'tts',
    units: chars,
    costUsd,
  })
}

export function recordSttUsage(input: {
  providerId: string
  modelId: string
  durationSeconds?: number
  transcriptChars?: number
}): void {
  let seconds = input.durationSeconds ?? 0
  if (!seconds && input.transcriptChars) {
    // Rough proxy: speech averages ~15 chars/sec for English, less for CJK.
    seconds = Math.max(1, Math.round(input.transcriptChars / 15))
  }
  if (!seconds) return
  const modelId = normalizeMeteringId(input.modelId) || normalizeMeteringId(input.providerId) || 'stt'
  const ratePerMinute = lookupSttRate(modelId)
  const costUsd = (seconds / 60) * ratePerMinute
  recordAuxiliaryUsage({
    kind: 'stt',
    providerId: input.providerId,
    modelId,
    fallbackModelId: 'stt',
    units: seconds,
    costUsd,
  })
}

export function recordEmbeddingUsage(input: {
  providerId: string
  modelId: string
  tokens: number
}): void {
  if (!input.tokens) return
  // OpenAI text-embedding-3-small rate as a conservative default.
  const ratePerMillion = 0.1
  const costUsd = (input.tokens / 1_000_000) * ratePerMillion
  const modelId = normalizeMeteringId(input.modelId) || normalizeMeteringId(input.providerId) || 'embedding'
  recordAuxiliaryUsage({
    kind: 'embedding',
    providerId: input.providerId,
    modelId,
    fallbackModelId: 'embedding',
    units: input.tokens,
    costUsd,
  })
}
