import type { ChatMemoryTrace, ChatMessage, ChatToolResult, WebSearchDisplay } from '../../types'
import { isObject } from '../guards.ts'
import { CHAT_STORAGE_KEY, readJson, writeJson, writeJsonDebounced } from './core.ts'

const MAX_PERSISTED_CHAT_MESSAGES = 500

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
  const loopOffer = normalizeLoopOffer(value.loopOffer)
  const loopCheck = normalizeLoopCheck(value.loopCheck)
  const proactiveWhy = normalizeProactiveWhy(value.proactiveWhy)

  return {
    id,
    role: value.role,
    content,
    createdAt,
    ...(isValidTone(value.tone) ? { tone: value.tone } : {}),
    ...(toolResult ? { toolResult } : {}),
    ...(memoryTrace ? { memoryTrace } : {}),
    ...(reasoning ? { reasoning_content: reasoning } : {}),
    ...(loopOffer ? { loopOffer } : {}),
    ...(loopCheck ? { loopCheck } : {}),
    ...(proactiveWhy ? { proactiveWhy } : {}),
  }
}

function normalizeLoopOffer(value: unknown): ChatMessage['loopOffer'] {
  if (!value || typeof value !== 'object') return undefined
  const record = value as Record<string, unknown>
  const memoryId = typeof record.memoryId === 'string' ? record.memoryId.trim() : ''
  const title = typeof record.title === 'string' ? record.title.trim() : ''
  const nightBeforeAt = typeof record.nightBeforeAt === 'string' && Number.isFinite(Date.parse(record.nightBeforeAt))
    ? new Date(record.nightBeforeAt).toISOString()
    : ''
  const status = record.status === 'accepted' || record.status === 'declined' || record.status === 'pending'
    ? record.status
    : 'pending'
  if (!memoryId || !title || !nightBeforeAt) return undefined
  return { memoryId, title: title.slice(0, 80), nightBeforeAt, status }
}

function normalizeLoopCheck(value: unknown): ChatMessage['loopCheck'] {
  if (!value || typeof value !== 'object') return undefined
  const record = value as Record<string, unknown>
  const memoryId = typeof record.memoryId === 'string' ? record.memoryId.trim() : ''
  const status = record.status === 'done' || record.status === 'later' || record.status === 'moved' || record.status === 'pending'
    ? record.status
    : 'pending'
  if (!memoryId) return undefined
  return { memoryId, status }
}

function normalizeProactiveWhy(value: unknown): ChatMessage['proactiveWhy'] {
  if (!value || typeof value !== 'object') return undefined
  const record = value as Record<string, unknown>
  const summary = typeof record.summary === 'string' ? record.summary.trim() : ''
  const quote = typeof record.quote === 'string' ? record.quote.trim() : ''
  const at = typeof record.at === 'string' && Number.isFinite(Date.parse(record.at))
    ? new Date(record.at).toISOString()
    : ''
  if (!summary || !quote || !at) return undefined
  const place = typeof record.place === 'string' ? record.place.trim() : ''
  const dueText = typeof record.dueText === 'string' ? record.dueText.trim() : ''
  return {
    summary: summary.slice(0, 240),
    quote: quote.slice(0, 240),
    at,
    ...(place ? { place: place.slice(0, 80) } : {}),
    ...(dueText ? { dueText: dueText.slice(0, 80) } : {}),
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

/**
 * A remote apply and a local line can land in one commit. The apply asks
 * the save effect to stay quiet, but that must not drop the local line.
 * Returns true when the effect should persist instead of treating the
 * commit as a pure remote apply.
 */
export function remoteApplyConsumedByLocalLine(
  remoteSignature: string | null,
  nextSignature: string,
): boolean {
  return remoteSignature != null && remoteSignature !== nextSignature
}

function loopOfferRank(status: NonNullable<ChatMessage['loopOffer']>['status'] | undefined): number {
  if (status === 'accepted' || status === 'declined') return 2
  if (status === 'pending') return 1
  return 0
}

function loopCheckRank(status: NonNullable<ChatMessage['loopCheck']>['status'] | undefined): number {
  if (status === 'done' || status === 'later' || status === 'moved') return 2
  if (status === 'pending') return 1
  return 0
}

/**
 * Fold a broadcast message list onto the local thread.
 * A night-before card the user already accepted or declined stays decided
 * when the other window still has the pending copy. Inline images stay
 * local because they are not written to storage.
 */
export function mergeRemoteChatMessages(
  local: readonly ChatMessage[],
  remote: readonly ChatMessage[],
): ChatMessage[] {
  const localById = new Map(local.map((message) => [message.id, message]))
  return remote.map((incoming) => {
    const current = localById.get(incoming.id)
    if (!current) return incoming
    let next = incoming
    if (current.images?.length && !incoming.images?.length) {
      next = { ...next, images: current.images }
    }
    const localOffer = current.loopOffer
    const remoteOffer = incoming.loopOffer
    if (localOffer && loopOfferRank(localOffer.status) > loopOfferRank(remoteOffer?.status)) {
      next = { ...next, loopOffer: localOffer }
    }
    const localCheck = current.loopCheck
    const remoteCheck = incoming.loopCheck
    if (localCheck && loopCheckRank(localCheck.status) > loopCheckRank(remoteCheck?.status)) {
      next = { ...next, loopCheck: localCheck }
    }
    return next
  })
}

export function saveChatMessages(messages: ChatMessage[]) {
  // The normalizer strips inline image data URLs before persisting — base64
  // images can be multi-MB each and would blow past localStorage quota in a few
  // turns. Images stay in memory for the current session and vanish on reload.
  writeJsonDebounced(CHAT_STORAGE_KEY, normalizeChatMessagesForStorage(messages))
}
