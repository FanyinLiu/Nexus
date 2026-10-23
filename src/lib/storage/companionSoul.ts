/**
 * Legacy SOUL-card note stored in localStorage.
 *
 * Chat never read this blob. It is a one-time migration source: callers copy
 * the text into the live persona when that target is empty, then remove the
 * blob. Parse failures become an empty note. This module does not write it.
 */

import { getRedactedLogErrorMessage } from '../logRedaction.ts'
import { normalizeBoundedText } from '../normalize.ts'
import { COMPANION_SOUL_STORAGE_KEY, readJson } from './core.ts'

export interface CompanionSoulNote {
  text: string
  updatedAt: string | null
}

/**
 * Read the legacy portrait. A missing or broken blob is an empty note.
 */
export function loadCompanionSoul(): CompanionSoulNote {
  try {
    const raw = readJson<unknown>(COMPANION_SOUL_STORAGE_KEY, null)
    if (!raw || typeof raw !== 'object') return { text: '', updatedAt: null }
    const record = raw as Record<string, unknown>
    const text = normalizeBoundedText(record.text, 2_000, true) ?? ''
    const updatedAt = typeof record.updatedAt === 'string' && Number.isFinite(Date.parse(record.updatedAt))
      ? new Date(record.updatedAt).toISOString()
      : null
    return { text, updatedAt }
  } catch (error) {
    console.warn('[memory] soul read failed:', getRedactedLogErrorMessage(error))
    return { text: '', updatedAt: null }
  }
}

/** Drop the legacy portrait. Storage failures are warned and do not throw. */
export function clearCompanionSoul(): void {
  try {
    window.localStorage.removeItem(COMPANION_SOUL_STORAGE_KEY)
  } catch (error) {
    console.warn('[memory] soul legacy clear failed:', getRedactedLogErrorMessage(error))
  }
}
