export const MAX_VOICE_BENCHMARK_MS: number
export const MAX_VOICE_PROBE_MS: number
export const MAX_VOICE_PROBE_ROUNDTRIP_MS: number

export type VoiceBenchmarkStatus = 'ok' | 'timeout' | 'skipped' | 'error' | 'not-run'

export type VoiceBudgetResult<T> = {
  ok: boolean
  timedOut: boolean
  elapsedMs: number
  value: T | null
  errorCode: 'timeout' | 'task-failed' | null
}

export function clampVoiceBudget(requested: number, ceiling: number): number

export function normalizeBenchmarkStatus(result: {
  timedOut?: boolean
  ok?: boolean
  value?: { status?: string, sttRtf?: number } | null
} | null | undefined): { status: VoiceBenchmarkStatus, sttRtf: number | null }

export function runWithBudget<T>(
  task: (signal: AbortSignal) => Promise<T> | T,
  budgetMs: number,
  ceilingMs?: number,
): Promise<VoiceBudgetResult<T>>
