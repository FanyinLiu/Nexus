import type {
  AppSettings,
  DailyMemoryEntry,
  MemoryDreamLog,
  MemoryDreamResult,
  MemoryItem,
} from '../../types'
import { getDefaultCompanionName } from '../../lib/uiLanguage.ts'

// ── Gate: should we dream now? ────────────────────────────────────────────────

export function shouldRunDream(
  dreamLog: MemoryDreamLog,
  settings: AppSettings,
): boolean {
  if (!settings.autonomyEnabled || !settings.autonomyDreamEnabled) return false

  // Session count gate
  if (dreamLog.sessionsSinceDream < settings.autonomyDreamMinSessions) return false

  // Time gate
  if (dreamLog.lastDreamAt) {
    const hoursSince = (Date.now() - new Date(dreamLog.lastDreamAt).getTime()) / 3_600_000
    if (hoursSince < settings.autonomyDreamIntervalHours) return false
  }

  return true
}

// ── Prompt building ───────────────────────────────────────────────────────────

/**
 * Build the LLM prompt that consolidates daily entries into long-term memories.
 * Returns a system + user message pair for use with completeChat.
 */
export function buildDreamPrompt(
  dailyEntries: DailyMemoryEntry[],
  existingMemories: MemoryItem[],
  settings: AppSettings,
): { system: string; user: string } {
  const companionName = settings.companionName || getDefaultCompanionName(settings.uiLanguage)

  const existingSection = existingMemories.length > 0
    ? `\n## Existing long-term memories\n${existingMemories.map((m) => `- [${m.category}] ${m.content}`).join('\n')}\n`
    : '\n## Existing long-term memories\n(none)\n'

  const dailySection = dailyEntries.length > 0
    ? `\n## Recent daily log entries\n${dailyEntries.slice(-50).map((e) => `- [${e.day} ${e.role}] ${e.content}`).join('\n')}\n`
    : '\n## Recent daily log entries\n(none)\n'

  const system = `You are the memory consolidation module for ${companionName}. Your job is to:
1. Read the recent conversation log entries and the existing long-term memories
2. Extract valuable new information from the log (the user's preferences, habits, projects, relationships, important events)
3. Merge with existing memory: update outdated content, remove contradictions, add important new findings
4. Return the operation result as JSON

Output format (strict JSON, no markdown code block):
{
  "new": [{"content": "...", "category": "preference|habit|relationship|event|project|reference", "importance": "low|normal|high"}],
  "update": [{"id": "original memory id", "content": "updated content"}],
  "prune": ["memory id to delete"]
}

Rules:
- Only extract certain facts; do not speculate
- Summarize each memory in one sentence
- Do not duplicate existing memories
- If there is nothing to change, return {"new": [], "update": [], "prune": []}`

  const user = `Please consolidate the following memories:${existingSection}${dailySection}`

  return { system, user }
}

// ── Response parsing ──────────────────────────────────────────────────────────

export type DreamOperations = {
  newMemories: Array<{ content: string; category: string; importance: string }>
  updates: Array<{ id: string; content: string }>
  pruneIds: string[]
}

const VALID_CATEGORIES = new Set([
  'preference', 'habit', 'relationship', 'event', 'project', 'reference',
])
const VALID_IMPORTANCE = new Set(['low', 'normal', 'high'])

export function parseDreamResponse(responseContent: string): DreamOperations {
  try {
    // Strip markdown code fences if present
    let cleaned = responseContent.trim()
    if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '')
    }

    const parsed = JSON.parse(cleaned)

    // Validate and sanitize new memories
    const rawNew = Array.isArray(parsed.new) ? parsed.new : []
    const newMemories = rawNew
      .filter((m: unknown): m is { content: string; category?: string; importance?: string } =>
        typeof m === 'object' && m !== null && typeof (m as Record<string, unknown>).content === 'string',
      )
      .map((m: { content: string; category?: string; importance?: string }) => ({
        content: m.content,
        category: VALID_CATEGORIES.has(m.category ?? '') ? m.category! : 'reference',
        importance: VALID_IMPORTANCE.has(m.importance ?? '') ? m.importance! : 'normal',
      }))

    // Validate updates
    const rawUpdate = Array.isArray(parsed.update) ? parsed.update : []
    const updates = rawUpdate.filter(
      (u: unknown): u is { id: string; content: string } =>
        typeof u === 'object' && u !== null
        && typeof (u as Record<string, unknown>).id === 'string'
        && typeof (u as Record<string, unknown>).content === 'string',
    )

    // Validate prune IDs
    const rawPrune = Array.isArray(parsed.prune) ? parsed.prune : []
    const pruneIds = rawPrune.filter((id: unknown): id is string => typeof id === 'string')

    return { newMemories, updates, pruneIds }
  } catch {
    return { newMemories: [], updates: [], pruneIds: [] }
  }
}

// ── Dream log helpers ─────────────────────────────────────────────────────────

export function createInitialDreamLog(): MemoryDreamLog {
  return {
    lastDreamAt: null,
    sessionsSinceDream: 0,
    history: [],
  }
}

export function recordDreamResult(
  log: MemoryDreamLog,
  result: MemoryDreamResult,
  startedSessionsSinceDream = log.sessionsSinceDream,
): MemoryDreamLog {
  const history = [...log.history, result].slice(-10) // Keep last 10
  return {
    lastDreamAt: result.completedAt,
    sessionsSinceDream: Math.max(0, log.sessionsSinceDream - startedSessionsSinceDream),
    history,
  }
}

export function incrementDreamSessionCount(log: MemoryDreamLog): MemoryDreamLog {
  return {
    ...log,
    sessionsSinceDream: log.sessionsSinceDream + 1,
  }
}
