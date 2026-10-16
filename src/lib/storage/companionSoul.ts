/**
 * Editable companion portrait. The default lives in i18n until the user
 * saves their own wording. Parse failures become an empty note.
 */

import { getRedactedLogErrorMessage } from '../logRedaction.ts'
import { normalizeBoundedText } from '../normalize.ts'
import { COMPANION_SOUL_STORAGE_KEY, readJson, writeJson } from './core.ts'

export interface CompanionSoulNote {
  text: string
  updatedAt: string | null
}

/**
 * Read the saved portrait. A missing or broken blob is an empty note,
 * which the settings card replaces with the locale default.
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

/** Persist the portrait. Storage failures are warned and do not throw. */
export function saveCompanionSoul(text: string, nowIso: string): CompanionSoulNote {
  const note: CompanionSoulNote = {
    text: text.trim().slice(0, 2_000),
    updatedAt: Number.isFinite(Date.parse(nowIso)) ? new Date(nowIso).toISOString() : new Date().toISOString(),
  }
  try {
    writeJson(COMPANION_SOUL_STORAGE_KEY, note)
  } catch (error) {
    console.warn('[memory] soul write failed:', getRedactedLogErrorMessage(error))
  }
  return note
}
