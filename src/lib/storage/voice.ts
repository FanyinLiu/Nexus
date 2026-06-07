import { t } from '../../i18n/runtime.ts'
import type { VoicePipelineState, VoicePipelineStep, VoiceTraceEntry, VoiceTraceTone } from '../../types'
import {
  readJson,
  VOICE_PIPELINE_STORAGE_KEY,
  VOICE_TRACE_STORAGE_KEY,
  writeJson,
  writeJsonDebounced,
} from './core.ts'

function buildDefaultVoicePipelineState(): VoicePipelineState {
  return {
    step: 'idle',
    transcript: '',
    detail: t('settings.preview.console.waiting_for_voice'),
    updatedAt: '',
  }
}

const defaultVoiceTrace: VoiceTraceEntry[] = []
const MAX_VOICE_TRACE_ENTRIES = 8
const VALID_PIPELINE_STEPS: ReadonlySet<VoicePipelineStep> = new Set([
  'idle',
  'listening',
  'transcribing',
  'recognized',
  'sending',
  'manual_confirm',
  'blocked_busy',
  'blocked_wake_word',
  'reply_received',
  'reply_failed',
])
const VALID_TRACE_TONES: ReadonlySet<VoiceTraceTone> = new Set(['info', 'success', 'error'])

function normalizeText(value: unknown, limit: number): string {
  return typeof value === 'string'
    ? value.replace(/\s+/g, ' ').trim().slice(0, limit)
    : ''
}

function normalizeUpdatedAt(value: unknown): string {
  if (typeof value !== 'string') return ''
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : ''
}

function normalizePipelineStep(value: unknown): VoicePipelineStep {
  return typeof value === 'string' && VALID_PIPELINE_STEPS.has(value as VoicePipelineStep)
    ? value as VoicePipelineStep
    : 'idle'
}

export function normalizeVoicePipelineState(raw: unknown): VoicePipelineState {
  const fallback = buildDefaultVoicePipelineState()
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return fallback
  const obj = raw as Record<string, unknown>
  return {
    step: normalizePipelineStep(obj.step),
    transcript: normalizeText(obj.transcript, 2_000),
    detail: normalizeText(obj.detail, 500) || fallback.detail,
    updatedAt: normalizeUpdatedAt(obj.updatedAt),
  }
}

function normalizeTraceTone(value: unknown): VoiceTraceTone {
  return typeof value === 'string' && VALID_TRACE_TONES.has(value as VoiceTraceTone)
    ? value as VoiceTraceTone
    : 'info'
}

function normalizeTraceCreatedAt(value: unknown, index: number): string {
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    if (Number.isFinite(parsed)) return new Date(parsed).toISOString()
  }
  return new Date(index).toISOString()
}

function normalizeVoiceTraceEntry(value: unknown, index: number): VoiceTraceEntry | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const obj = value as Record<string, unknown>
  const title = normalizeText(obj.title, 120)
  const detail = normalizeText(obj.detail, 800)
  if (!title || !detail) return null
  const createdAt = normalizeTraceCreatedAt(obj.createdAt, index)
  const id = normalizeText(obj.id, 120) || `voice-trace-recovered-${index}-${Date.parse(createdAt)}`
  return {
    id,
    title,
    detail,
    tone: normalizeTraceTone(obj.tone),
    createdAt,
  }
}

export function normalizeVoiceTrace(raw: unknown): VoiceTraceEntry[] {
  if (!Array.isArray(raw)) return defaultVoiceTrace
  return raw
    .map(normalizeVoiceTraceEntry)
    .filter((entry): entry is VoiceTraceEntry => Boolean(entry))
    .slice(0, MAX_VOICE_TRACE_ENTRIES)
}

export function loadVoicePipelineState(): VoicePipelineState {
  const raw = readJson<unknown>(VOICE_PIPELINE_STORAGE_KEY, {})
  const normalized = normalizeVoicePipelineState(raw)
  if (JSON.stringify(normalized) !== JSON.stringify(raw)) {
    writeJson(VOICE_PIPELINE_STORAGE_KEY, normalized)
  }
  return normalized
}

export function saveVoicePipelineState(state: VoicePipelineState) {
  writeJsonDebounced(VOICE_PIPELINE_STORAGE_KEY, normalizeVoicePipelineState(state), 300)
}

export function loadVoiceTrace(): VoiceTraceEntry[] {
  const raw = readJson<unknown>(VOICE_TRACE_STORAGE_KEY, defaultVoiceTrace)
  const normalized = normalizeVoiceTrace(raw)
  if (JSON.stringify(normalized) !== JSON.stringify(raw)) {
    writeJson(VOICE_TRACE_STORAGE_KEY, normalized)
  }
  return normalized
}

export function saveVoiceTrace(trace: VoiceTraceEntry[]) {
  writeJsonDebounced(VOICE_TRACE_STORAGE_KEY, normalizeVoiceTrace(trace), 300)
}
