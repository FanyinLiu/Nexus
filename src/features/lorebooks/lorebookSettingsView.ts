import {
  LOREBOOK_SCAN_WINDOW_MESSAGES,
  MAX_LOREBOOK_ENTRIES_PER_TURN,
} from '../../types/lorebooks.ts'
import type { TranslationKey } from '../../types/i18n.ts'
import type { LorebookEntry } from '../../types/lorebooks.ts'

export type LorebookSettingsSummary = {
  disabledCount: number
  incompleteCount: number
  maxPerTurn: number
  readyCount: number
  scanWindowMessages: number
  totalCount: number
}

export type LorebookTriggerPreviewMatch = {
  entry: LorebookEntry
  matchedKeywords: string[]
}

export type LorebookTriggerPreview = {
  input: string
  matches: LorebookTriggerPreviewMatch[]
}

export type LorebookEntryGuide = {
  helperKey: TranslationKey
  missingContent: boolean
  missingKeywords: boolean
}

export function normalizeLorebookKeywords(input: string): string[] {
  return input
    .split(/[,，、;；]/)
    .map((keyword) => keyword.trim())
    .filter(Boolean)
}

export function isLorebookEntryReady(entry: LorebookEntry): boolean {
  return Boolean(
    entry.enabled
    && entry.content.trim()
    && entry.keywords.some((keyword) => keyword.trim()),
  )
}

export function resolveLorebookTriggerPreview(entries: LorebookEntry[], input: string): LorebookTriggerPreview {
  const normalizedInput = input.trim().toLowerCase()
  if (!normalizedInput) return { input, matches: [] }

  const matches: Array<LorebookTriggerPreviewMatch & { longestMatch: number }> = []
  for (const entry of entries) {
    if (!isLorebookEntryReady(entry)) continue

    const matchedKeywords = entry.keywords
      .map((keyword) => keyword.trim())
      .filter((keyword) => keyword && normalizedInput.includes(keyword.toLowerCase()))

    if (matchedKeywords.length === 0) continue

    matches.push({
      entry,
      matchedKeywords,
      longestMatch: Math.max(...matchedKeywords.map((keyword) => keyword.length)),
    })
  }

  matches.sort((a, b) => {
    if (b.entry.priority !== a.entry.priority) return b.entry.priority - a.entry.priority
    return b.longestMatch - a.longestMatch
  })

  return {
    input,
    matches: matches.slice(0, MAX_LOREBOOK_ENTRIES_PER_TURN).map(({ entry, matchedKeywords }) => ({
      entry,
      matchedKeywords,
    })),
  }
}

export function resolveLorebookEntryGuide(entry: LorebookEntry): LorebookEntryGuide {
  const missingKeywords = !entry.keywords.some((keyword) => keyword.trim())
  const missingContent = !entry.content.trim()

  if (!entry.enabled) {
    return {
      helperKey: 'settings.lorebooks.entry_hint_disabled',
      missingContent,
      missingKeywords,
    }
  }

  if (!missingKeywords && !missingContent) {
    return {
      helperKey: 'settings.lorebooks.entry_hint_ready',
      missingContent,
      missingKeywords,
    }
  }

  if (missingKeywords && missingContent) {
    return {
      helperKey: 'settings.lorebooks.entry_hint_missing_both',
      missingContent,
      missingKeywords,
    }
  }

  return {
    helperKey: missingKeywords
      ? 'settings.lorebooks.entry_hint_missing_keywords'
      : 'settings.lorebooks.entry_hint_missing_content',
    missingContent,
    missingKeywords,
  }
}

export function resolveLorebookSettingsSummary(entries: LorebookEntry[]): LorebookSettingsSummary {
  const disabledCount = entries.filter((entry) => !entry.enabled).length
  const readyCount = entries.filter(isLorebookEntryReady).length
  const incompleteCount = entries.length - disabledCount - readyCount

  return {
    disabledCount,
    incompleteCount,
    maxPerTurn: MAX_LOREBOOK_ENTRIES_PER_TURN,
    readyCount,
    scanWindowMessages: LOREBOOK_SCAN_WINDOW_MESSAGES,
    totalCount: entries.length,
  }
}
