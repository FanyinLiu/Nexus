import type { ChatMemoryTrace, ChatMessage, ChatToolResult, WebSearchDisplay } from '../../types'
import { CHAT_STORAGE_KEY, readJson, writeJson, writeJsonDebounced } from './core.ts'

const MAX_PERSISTED_CHAT_MESSAGES = 500

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isValidRole(value: unknown): value is ChatMessage['role'] {
  return value === 'user' || value === 'assistant' || value === 'system'
}

function isValidTone(value: unknown): value is NonNullable<ChatMessage['tone']> {
  return value === 'neutral' || value === 'error'
}

function normalizeStringArray(value: unknown, limit = 8): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => String(item ?? '').trim())
    .filter(Boolean)
    .slice(0, limit)
}

function normalizeTraceIds(value: unknown): string[] {
  const seen = new Set<string>()
  const ids: string[] = []
  for (const id of normalizeStringArray(value, 48)) {
    if (seen.has(id)) continue
    seen.add(id)
    ids.push(id)
    if (ids.length >= 24) break
  }
  return ids
}

function normalizeMemoryTrace(value: unknown): ChatMemoryTrace | undefined {
  if (!isObject(value)) return undefined

  const status = value.status
  if (status !== 'active' && status !== 'paused') return undefined

  const searchModeUsed = value.searchModeUsed
  if (searchModeUsed !== 'keyword' && searchModeUsed !== 'hybrid' && searchModeUsed !== 'vector') {
    return undefined
  }

  if (status === 'paused') {
    return {
      status,
      searchModeUsed,
      vectorSearchAvailable: false,
      longTermIds: [],
      dailyEntryIds: [],
      semanticIds: [],
    }
  }

  return {
    status,
    searchModeUsed,
    vectorSearchAvailable: Boolean(value.vectorSearchAvailable),
    longTermIds: normalizeTraceIds(value.longTermIds),
    dailyEntryIds: normalizeTraceIds(value.dailyEntryIds),
    semanticIds: normalizeTraceIds(value.semanticIds),
  }
}

function normalizeWebSearchDisplay(value: unknown): WebSearchDisplay | undefined {
  if (!isObject(value) || typeof value.mode !== 'string') return undefined

  const mode = value.mode
  if (mode !== 'lyrics' && mode !== 'answer' && mode !== 'search_list') return undefined

  const title = String(value.title ?? '').trim()
  const summary = String(value.summary ?? '').trim()
  const bodyLines = normalizeStringArray(value.bodyLines, 8)

  const panels = Array.isArray(value.panels)
    ? value.panels
      .map((panel) => {
        if (!isObject(panel)) return null
        const panelTitle = String(panel.title ?? '').trim()
        const body = String(panel.body ?? '').trim()
        const url = String(panel.url ?? '').trim()
        const host = String(panel.host ?? '').trim()
        if (!panelTitle || !body || !url || !host) return null
        const publishedAt = String(panel.publishedAt ?? '').trim()
        return {
          title: panelTitle,
          body,
          url,
          host,
          ...(publishedAt ? { publishedAt } : {}),
        }
      })
      .filter((panel): panel is NonNullable<typeof panel> => Boolean(panel))
      .slice(0, 4)
    : []

  const sources = Array.isArray(value.sources)
    ? value.sources
      .map((source) => {
        if (!isObject(source)) return null
        const sourceTitle = String(source.title ?? '').trim()
        const url = String(source.url ?? '').trim()
        if (!sourceTitle || !url) return null
        const host = String(source.host ?? '').trim()
        const publishedAt = String(source.publishedAt ?? '').trim()
        return {
          title: sourceTitle,
          url,
          ...(host ? { host } : {}),
          ...(publishedAt ? { publishedAt } : {}),
        }
      })
      .filter((source): source is NonNullable<typeof source> => Boolean(source))
      .slice(0, 4)
    : []

  return {
    mode,
    ...(title ? { title } : {}),
    ...(summary ? { summary } : {}),
    ...(bodyLines.length ? { bodyLines } : {}),
    ...(panels.length ? { panels } : {}),
    ...(sources.length ? { sources } : {}),
  }
}

function normalizeToolResult(value: unknown): ChatToolResult | undefined {
  if (!isObject(value) || typeof value.kind !== 'string' || !isObject(value.result)) {
    return undefined
  }

  if (value.kind === 'web_search') {
    const query = String(value.result.query ?? '').trim()
    const items = Array.isArray(value.result.items)
      ? value.result.items
        .map((item) => {
          if (!isObject(item)) return null
          const title = String(item.title ?? '').trim()
          const url = String(item.url ?? '').trim()
          const snippet = String(item.snippet ?? '').trim()
          if (!title || !url || !snippet) return null
          const publishedAt = String(item.publishedAt ?? '').trim()
          const contentPreview = String(item.contentPreview ?? '').trim()
          return {
            title,
            url,
            snippet,
            ...(publishedAt ? { publishedAt } : {}),
            ...(contentPreview ? { contentPreview } : {}),
          }
        })
        .filter((item): item is NonNullable<typeof item> => Boolean(item))
      : []
    if (!query || !items.length) return undefined
    const display = normalizeWebSearchDisplay(value.result.display)
    return {
      kind: 'web_search',
      result: {
        query,
        items,
        ...(display ? { display } : {}),
        message: String(value.result.message ?? '').trim(),
      },
    }
  }

  if (value.kind === 'weather') {
    const location = String(value.result.location ?? '').trim()
    const resolvedName = String(value.result.resolvedName ?? '').trim()
    const currentSummary = String(value.result.currentSummary ?? '').trim()
    if (!location || !resolvedName || !currentSummary) return undefined
    const timezone = String(value.result.timezone ?? '').trim()
    const todaySummary = String(value.result.todaySummary ?? '').trim()
    const tomorrowSummary = String(value.result.tomorrowSummary ?? '').trim()
    return {
      kind: 'weather',
      result: {
        location,
        resolvedName,
        currentSummary,
        ...(timezone ? { timezone } : {}),
        ...(todaySummary ? { todaySummary } : {}),
        ...(tomorrowSummary ? { tomorrowSummary } : {}),
        message: String(value.result.message ?? '').trim(),
      },
    }
  }

  if (value.kind === 'open_external') {
    const url = String(value.result.url ?? '').trim()
    if (!url) return undefined
    return {
      kind: 'open_external',
      result: {
        ok: Boolean(value.result.ok),
        url,
        message: String(value.result.message ?? '').trim(),
      },
    }
  }

  return undefined
}

function normalizeCreatedAt(value: unknown, index: number): string | null {
  if (typeof value === 'string') {
    const parsed = Date.parse(value.trim())
    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return new Date(value).toISOString()
  }
  return new Date(index).toISOString()
}

export function normalizeChatMessage(value: unknown, index: number): ChatMessage | null {
  if (!isObject(value) || !isValidRole(value.role) || typeof value.content !== 'string') {
    return null
  }

  const content = value.content.trim()
  if (!content) return null

  const createdAt = normalizeCreatedAt(value.createdAt, index)
  if (!createdAt) return null

  const id = typeof value.id === 'string' && value.id.trim()
    ? value.id.trim()
    : `chat-message-recovered-${index}-${Date.parse(createdAt)}`
  const toolResult = normalizeToolResult(value.toolResult)
  const memoryTrace = normalizeMemoryTrace(value.memoryTrace)
  const reasoning = typeof value.reasoning_content === 'string' && value.reasoning_content
    ? value.reasoning_content
    : undefined

  return {
    id,
    role: value.role,
    content,
    createdAt,
    ...(isValidTone(value.tone) ? { tone: value.tone } : {}),
    ...(toolResult ? { toolResult } : {}),
    ...(memoryTrace ? { memoryTrace } : {}),
    ...(reasoning ? { reasoning_content: reasoning } : {}),
  }
}

export function normalizeChatMessagesForStorage(
  raw: unknown,
  limit = MAX_PERSISTED_CHAT_MESSAGES,
): ChatMessage[] {
  if (!Array.isArray(raw)) return []
  const normalized = raw
    .map(normalizeChatMessage)
    .filter((message): message is ChatMessage => Boolean(message))
  return normalized.length > limit
    ? normalized.slice(-limit)
    : normalized
}

export function loadChatMessages(): ChatMessage[] {
  const raw = readJson<unknown>(CHAT_STORAGE_KEY, [])
  const normalized = normalizeChatMessagesForStorage(raw)
  if (JSON.stringify(normalized) !== JSON.stringify(raw)) {
    writeJson(CHAT_STORAGE_KEY, normalized)
  }
  return normalized
}

export function saveChatMessages(messages: ChatMessage[]) {
  // The normalizer strips inline image data URLs before persisting — base64
  // images can be multi-MB each and would blow past localStorage quota in a few
  // turns. Images stay in memory for the current session and vanish on reload.
  writeJsonDebounced(CHAT_STORAGE_KEY, normalizeChatMessagesForStorage(messages))
}
