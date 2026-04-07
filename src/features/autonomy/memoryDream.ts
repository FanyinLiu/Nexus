import type {
  AppSettings,
  DailyMemoryEntry,
  MemoryDreamLog,
  MemoryDreamResult,
  MemoryItem,
} from '../../types'

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
  const companionName = settings.companionName || '星绘'

  const existingSection = existingMemories.length > 0
    ? `\n## 现有长期记忆\n${existingMemories.map((m) => `- [${m.category}] ${m.content}`).join('\n')}\n`
    : '\n## 现有长期记忆\n（暂无）\n'

  const dailySection = dailyEntries.length > 0
    ? `\n## 近期日记条目\n${dailyEntries.slice(-50).map((e) => `- [${e.day} ${e.role}] ${e.content}`).join('\n')}\n`
    : '\n## 近期日记条目\n（暂无）\n'

  const system = `你是 ${companionName} 的记忆整理模块。你的任务是：
1. 阅读近期对话日记和已有长期记忆
2. 从日记中提取有价值的新信息（用户的偏好、习惯、项目、人际关系、重要事件）
3. 与现有记忆合并：更新过时内容，删除矛盾信息，新增重要发现
4. 返回 JSON 格式的操作结果

输出格式（严格 JSON，不要 markdown 代码块）：
{
  "new": [{"content": "...", "category": "preference|habit|relationship|event|project|reference", "importance": "low|normal|high"}],
  "update": [{"id": "原记忆ID", "content": "更新后的内容"}],
  "prune": ["要删除的记忆ID"]
}

规则：
- 只提取确定的事实，不要推测
- 每条记忆用一句话概括
- 不要重复已有记忆
- 如果没有需要变更的内容，返回 {"new": [], "update": [], "prune": []}`

  const user = `请整理以下记忆：${existingSection}${dailySection}`

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
): MemoryDreamLog {
  const history = [...log.history, result].slice(-10) // Keep last 10
  return {
    lastDreamAt: result.completedAt,
    sessionsSinceDream: 0,
    history,
  }
}

export function incrementDreamSessionCount(log: MemoryDreamLog): MemoryDreamLog {
  return {
    ...log,
    sessionsSinceDream: log.sessionsSinceDream + 1,
  }
}
