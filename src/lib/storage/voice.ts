import { t } from '../../i18n/runtime.ts'
import type { VoicePipelineState, VoiceTraceEntry } from '../../types'
import {
  readJson,
  VOICE_PIPELINE_STORAGE_KEY,
  VOICE_TRACE_STORAGE_KEY,
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

export function loadVoicePipelineState(): VoicePipelineState {
  return {
    ...buildDefaultVoicePipelineState(),
    ...readJson<Partial<VoicePipelineState>>(VOICE_PIPELINE_STORAGE_KEY, {}),
  }
}

export function saveVoicePipelineState(state: VoicePipelineState) {
  writeJsonDebounced(VOICE_PIPELINE_STORAGE_KEY, state, 300)
}

export function loadVoiceTrace(): VoiceTraceEntry[] {
  return readJson<VoiceTraceEntry[]>(VOICE_TRACE_STORAGE_KEY, defaultVoiceTrace).slice(0, 8)
}

export function saveVoiceTrace(trace: VoiceTraceEntry[]) {
  writeJsonDebounced(VOICE_TRACE_STORAGE_KEY, trace.slice(0, 8), 300)
}
