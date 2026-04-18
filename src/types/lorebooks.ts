/**
 * Lorebook entries are user-authored "world knowledge" snippets that
 * get injected into the system prompt only when one of their keywords
 * shows up in recent user messages. Pattern borrowed from SillyTavern
 * (WorldInfo) — the point is to keep the system prompt lean when the
 * topic isn't relevant, then light up with context when it is.
 *
 * Example: keywords=['妈妈','mom'], content='用户的母亲是上海一名小
 * 学教师，姓张。' When the user says "我妈妈今天…", the content gets
 * pulled into the system prompt for that turn.
 */
export interface LorebookEntry {
  id: string
  label: string
  keywords: string[]
  content: string
  enabled: boolean
  priority: number
  createdAt: string
  updatedAt: string
}

export const MAX_LOREBOOK_ENTRIES_PER_TURN = 6
export const MAX_LOREBOOK_CONTENT_CHARS = 500
export const LOREBOOK_SCAN_WINDOW_MESSAGES = 4
