import type { ChatMessage } from '../../types/chat.ts'
import {
  LOREBOOK_SCAN_WINDOW_MESSAGES,
  MAX_LOREBOOK_CONTENT_CHARS,
  MAX_LOREBOOK_ENTRIES_PER_TURN,
  type LorebookEntry,
} from '../../types/lorebooks.ts'

/**
 * Given a pool of user-authored lorebook entries and the last few user
 * messages, return the entries whose keywords appear in the scanned
 * text. Case-insensitive whole-substring match (no word boundaries, so
 * "妈妈" inside "我妈妈说..." still hits; same for English partials).
 *
 * Selection rules:
 *   - Only `enabled` entries with at least one non-empty keyword and
 *     non-empty content are considered.
 *   - Entries are scored by: priority (desc), longest matched keyword
 *     length (desc), to favour the most specific match first.
 *   - Truncated at MAX_LOREBOOK_ENTRIES_PER_TURN so a user with 50
 *     lorebook entries can't accidentally blow past the system prompt
 *     budget on a single turn.
 */
export function selectTriggeredLorebookEntries(
  entries: LorebookEntry[],
  recentMessages: ChatMessage[],
): LorebookEntry[] {
  if (!Array.isArray(entries) || entries.length === 0) return []
  if (!Array.isArray(recentMessages) || recentMessages.length === 0) return []

  const userTexts: string[] = []
  for (let i = recentMessages.length - 1; i >= 0 && userTexts.length < LOREBOOK_SCAN_WINDOW_MESSAGES; i -= 1) {
    const message = recentMessages[i]
    if (message?.role !== 'user') continue
    const text = String(message.content ?? '').trim()
    if (text) userTexts.push(text.toLowerCase())
  }
  if (userTexts.length === 0) return []

  const scanned = userTexts.join('\n')

  const hits: Array<{ entry: LorebookEntry; longestMatch: number }> = []
  for (const entry of entries) {
    if (!entry.enabled) continue
    if (!entry.content?.trim()) continue
    if (!Array.isArray(entry.keywords) || entry.keywords.length === 0) continue

    let longest = 0
    for (const keyword of entry.keywords) {
      const needle = String(keyword ?? '').trim().toLowerCase()
      if (!needle) continue
      if (scanned.includes(needle) && needle.length > longest) {
        longest = needle.length
      }
    }
    if (longest > 0) hits.push({ entry, longestMatch: longest })
  }

  hits.sort((a, b) => {
    if (b.entry.priority !== a.entry.priority) return b.entry.priority - a.entry.priority
    return b.longestMatch - a.longestMatch
  })

  return hits.slice(0, MAX_LOREBOOK_ENTRIES_PER_TURN).map(({ entry }) => entry)
}

/**
 * Format the selected entries into a system-prompt section. Returns
 * empty string if nothing was triggered so the caller can skip the
 * section entirely without extra whitespace.
 */
export function buildLorebookSection(entries: LorebookEntry[]): string {
  if (!entries.length) return ''

  const lines: string[] = ['以下是本轮对话触发的背景设定（Lorebook）：']
  entries.forEach((entry, index) => {
    const truncated = entry.content.length > MAX_LOREBOOK_CONTENT_CHARS
      ? `${entry.content.slice(0, MAX_LOREBOOK_CONTENT_CHARS)}…`
      : entry.content
    const header = entry.label ? `${index + 1}. 【${entry.label}】` : `${index + 1}.`
    lines.push(`${header} ${truncated}`)
  })

  return lines.join('\n')
}
