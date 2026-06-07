import type { UpdaterEvent } from './types.ts'

const INVALID_UPDATER_EVENT_MESSAGE = 'Invalid updater event'
const MAX_VERSION_CHARS = 80
const MAX_RELEASE_NOTES_CHARS = 20_000
const MAX_ERROR_MESSAGE_CHARS = 1_000
const MAX_PROGRESS_BYTES = Number.MAX_SAFE_INTEGER

export type UpdaterState = {
  /** Latest event seen from the main process. */
  event: UpdaterEvent
  /** True while a manual check or download is in progress. */
  busy: boolean
  /** Current installed version, populated on mount via updaterStatus(). */
  currentVersion: string | null
  /** True only when running in a packaged build (auto-update is a no-op in dev). */
  isPackaged: boolean
}

export type UpdaterStatusSnapshot = {
  currentVersion: string | null
  isPackaged: boolean
  last?: UpdaterEvent | null
}

export type UpdaterCheckResult = {
  ok: boolean
  currentVersion: string
  latestVersion?: string | null
  reason?: string
}

export function createInitialUpdaterState(): UpdaterState {
  return {
    event: { type: 'idle' },
    busy: false,
    currentVersion: null,
    isPackaged: false,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function normalizeText(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  return trimmed.length > maxLength ? trimmed.slice(0, maxLength) : trimmed
}

function normalizeRequiredText(value: unknown, fallback: string, maxLength: number): string {
  return normalizeText(value, maxLength) ?? fallback
}

function normalizeNumber(value: unknown): number {
  const numeric = typeof value === 'number'
    ? value
    : (typeof value === 'string' && value.trim() !== '' ? Number(value) : 0)
  return Number.isFinite(numeric) ? numeric : 0
}

function normalizeNonNegativeNumber(value: unknown, max = MAX_PROGRESS_BYTES): number {
  return Math.min(max, Math.max(0, normalizeNumber(value)))
}

function hasFiniteNumericValue(value: unknown): boolean {
  if (typeof value === 'number') return Number.isFinite(value)
  if (typeof value !== 'string') return false
  const trimmed = value.trim()
  return trimmed !== '' && Number.isFinite(Number(trimmed))
}

function normalizePercent(value: unknown, transferred = 0, total = 0): number {
  if (hasFiniteNumericValue(value)) {
    return Math.min(100, Math.max(0, normalizeNumber(value)))
  }

  if (total > 0) {
    return Math.min(100, Math.max(0, (transferred / total) * 100))
  }

  return 0
}

function normalizeOptionalVersion(value: unknown): string | null {
  return normalizeText(value, MAX_VERSION_CHARS)
}

function normalizeRequiredVersion(value: unknown, fallback: string | null): string {
  return normalizeText(value, MAX_VERSION_CHARS)
    ?? normalizeText(fallback, MAX_VERSION_CHARS)
    ?? 'unknown'
}

export function normalizeUpdaterEvent(
  event: unknown,
  fallback: UpdaterEvent = { type: 'idle' },
  options: { currentVersion?: string | null; fallbackErrorMessage?: string } = {},
): UpdaterEvent {
  if (!isRecord(event)) return fallback

  switch (event.type) {
    case 'idle':
      return { type: 'idle' }
    case 'checking':
      return { type: 'checking' }
    case 'available':
      return {
        type: 'available',
        version: normalizeOptionalVersion(event.version),
        releaseNotes: normalizeText(event.releaseNotes, MAX_RELEASE_NOTES_CHARS),
      }
    case 'not-available':
      return {
        type: 'not-available',
        version: normalizeRequiredVersion(event.version, options.currentVersion ?? null),
      }
    case 'progress': {
      const transferred = normalizeNonNegativeNumber(event.transferred)
      const total = normalizeNonNegativeNumber(event.total)
      return {
        type: 'progress',
        percent: normalizePercent(event.percent, transferred, total),
        transferred,
        total: total > 0 ? Math.max(total, transferred) : total,
        bytesPerSecond: normalizeNonNegativeNumber(event.bytesPerSecond),
      }
    }
    case 'downloaded':
      return {
        type: 'downloaded',
        version: normalizeOptionalVersion(event.version),
        releaseNotes: normalizeText(event.releaseNotes, MAX_RELEASE_NOTES_CHARS),
      }
    case 'error':
      return {
        type: 'error',
        message: normalizeRequiredText(
          event.message,
          options.fallbackErrorMessage ?? INVALID_UPDATER_EVENT_MESSAGE,
          MAX_ERROR_MESSAGE_CHARS,
        ),
      }
    default:
      return fallback
  }
}

export function isUpdaterBusyEvent(event: unknown): boolean {
  const normalizedEvent = normalizeUpdaterEvent(event)
  return normalizedEvent.type === 'checking'
    || normalizedEvent.type === 'available'
    || normalizedEvent.type === 'progress'
}

export function applyUpdaterStatus(
  previous: UpdaterState,
  status: UpdaterStatusSnapshot | null | undefined,
): UpdaterState {
  if (!isRecord(status)) return previous

  const currentVersion = normalizeOptionalVersion(status.currentVersion) ?? previous.currentVersion
  const event = status.last === undefined || status.last === null
    ? previous.event
    : normalizeUpdaterEvent(status.last, previous.event, { currentVersion })

  return {
    ...previous,
    currentVersion,
    isPackaged: typeof status.isPackaged === 'boolean' ? status.isPackaged : previous.isPackaged,
    event,
    busy: isUpdaterBusyEvent(event),
  }
}

export function reduceUpdaterEvent(previous: UpdaterState, event: unknown): UpdaterState {
  const normalizedEvent = normalizeUpdaterEvent(
    event,
    { type: 'error', message: INVALID_UPDATER_EVENT_MESSAGE },
    { currentVersion: previous.currentVersion },
  )
  return {
    ...previous,
    event: normalizedEvent,
    busy: isUpdaterBusyEvent(normalizedEvent),
  }
}

export function reduceUpdaterCheckResult(
  previous: UpdaterState,
  result: UpdaterCheckResult | null | undefined,
  fallbackErrorMessage: string,
): UpdaterState {
  if (!isRecord(result)) {
    return {
      ...previous,
      busy: false,
      event: { type: 'error', message: fallbackErrorMessage },
    }
  }

  const currentVersion = normalizeOptionalVersion(result.currentVersion) ?? previous.currentVersion

  if (result.ok !== true) {
    return {
      ...previous,
      currentVersion,
      busy: false,
      event: {
        type: 'error',
        message: normalizeRequiredText(result.reason, fallbackErrorMessage, MAX_ERROR_MESSAGE_CHARS),
      },
    }
  }

  const latestVersion = normalizeOptionalVersion(result.latestVersion)
  if (!latestVersion || latestVersion === currentVersion) {
    return {
      ...previous,
      currentVersion,
      busy: false,
      event: { type: 'not-available', version: normalizeRequiredVersion(currentVersion, previous.currentVersion) },
    }
  }

  if (previous.event.type === 'progress' || previous.event.type === 'downloaded') {
    return {
      ...previous,
      currentVersion,
      busy: isUpdaterBusyEvent(previous.event),
    }
  }

  return {
    ...previous,
    currentVersion,
    busy: true,
    event: { type: 'available', version: latestVersion, releaseNotes: null },
  }
}
