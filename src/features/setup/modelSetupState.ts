export type ModelEntry = {
  id: string
  label: string
  sizeLabel: string
  purpose: string
  required: boolean
  kind: 'archive' | 'files' | 'standalone'
  present: boolean
  location: string | null
}

export type Inventory = {
  models: ModelEntry[]
  ready: boolean
  missingRequired: string[]
  primaryDir: string
  searchRoots: string[]
}

export type ProgressEvent = {
  modelId: string
  phase: 'start' | 'downloading' | 'done' | 'installed' | 'error'
  downloaded?: number
  total?: number
  fileName?: string
  message?: string
}

export type PerModelProgress = {
  phase: ProgressEvent['phase']
  downloaded: number
  total: number
  fileName?: string
  message?: string
}

export const MODEL_SETUP_DISMISSED_STORAGE_KEY = 'nexus.modelSetup.dismissedUntilRestart'

const MODEL_PROGRESS_PHASES = new Set<ProgressEvent['phase']>([
  'start',
  'downloading',
  'done',
  'installed',
  'error',
])
const MAX_MODEL_ID_CHARS = 80
const MAX_MODEL_PROGRESS_TEXT_CHARS = 1_000
const MAX_MODEL_PROGRESS_BYTES = Number.MAX_SAFE_INTEGER

function normalizeText(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (!trimmed) return undefined
  return trimmed.length > maxLength ? trimmed.slice(0, maxLength) : trimmed
}

function normalizeNonNegativeNumber(value: unknown): number | undefined {
  const numeric = typeof value === 'number'
    ? value
    : (typeof value === 'string' && value.trim() !== '' ? Number(value) : undefined)
  if (numeric === undefined || !Number.isFinite(numeric)) return undefined
  return Math.min(MAX_MODEL_PROGRESS_BYTES, Math.max(0, numeric))
}

function isModelProgressPhase(value: unknown): value is ProgressEvent['phase'] {
  return MODEL_PROGRESS_PHASES.has(value as ProgressEvent['phase'])
}

export function normalizeModelProgressEvent(event: unknown): ProgressEvent | null {
  if (typeof event !== 'object' || event === null) return null
  const record = event as Record<string, unknown>
  const modelId = normalizeText(record.modelId, MAX_MODEL_ID_CHARS)
  if (!modelId || !isModelProgressPhase(record.phase)) return null

  return {
    modelId,
    phase: record.phase,
    downloaded: normalizeNonNegativeNumber(record.downloaded),
    total: normalizeNonNegativeNumber(record.total),
    fileName: normalizeText(record.fileName, MAX_MODEL_PROGRESS_TEXT_CHARS),
    message: normalizeText(record.message, MAX_MODEL_PROGRESS_TEXT_CHARS),
  }
}

export function mergeModelProgress(
  previous: Record<string, PerModelProgress>,
  event: unknown,
): Record<string, PerModelProgress> {
  const normalizedEvent = normalizeModelProgressEvent(event)
  if (!normalizedEvent) return previous

  const resetCounters = normalizedEvent.phase === 'start'
  const current = previous[normalizedEvent.modelId] ?? { phase: 'start', downloaded: 0, total: 0 }
  const downloaded = normalizedEvent.downloaded ?? (resetCounters ? 0 : current.downloaded)
  const rawTotal = normalizedEvent.total ?? (resetCounters ? 0 : current.total)
  const next: PerModelProgress = {
    phase: normalizedEvent.phase,
    downloaded,
    total: rawTotal > 0 ? Math.max(rawTotal, downloaded) : rawTotal,
    fileName: normalizedEvent.fileName ?? (resetCounters ? undefined : current.fileName),
    message: normalizedEvent.message ?? (normalizedEvent.phase === 'error' ? current.message : undefined),
  }
  return { ...previous, [normalizedEvent.modelId]: next }
}

export function getModelProgressPercent(progress: PerModelProgress | undefined): number | null {
  if (!progress) return null
  const downloaded = normalizeNonNegativeNumber(progress.downloaded)
  const total = normalizeNonNegativeNumber(progress.total)
  if (downloaded === undefined || total === undefined || total <= 0) {
    return null
  }
  return Math.max(0, Math.min(100, Math.floor((downloaded / total) * 100)))
}

export function isModelProgressActive(progress: PerModelProgress | undefined): boolean {
  return progress?.phase === 'start' || progress?.phase === 'downloading'
}

export function isModelProgressComplete(progress: PerModelProgress | undefined): boolean {
  return progress?.phase === 'done' || progress?.phase === 'installed'
}

export function isModelProgressError(progress: PerModelProgress | undefined): boolean {
  return progress?.phase === 'error'
}

export function shouldShowModelSetupOverlay({
  suppressed,
  dismissed,
  inventoryReady,
}: {
  suppressed: boolean
  dismissed: boolean
  inventoryReady: boolean | undefined
}): boolean {
  return !suppressed && !dismissed && inventoryReady === false
}
