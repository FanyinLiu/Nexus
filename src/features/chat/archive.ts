import type { ChatMessage, ChatToolResult, WebSearchDisplay } from '../../types'
import { createId } from '../../lib/index.ts'
import { t } from '../../i18n/runtime.ts'

type ChatArchiveMeta = {
  companionName: string
  userName: string
}

type ChatArchivePayload = {
  schema: 'nexus.chat-history'
  version: 1
  exportedAt: string
  meta: ChatArchiveMeta
  messageCount: number
  messages: ChatMessage[]
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isValidRole(value: unknown): value is ChatMessage['role'] {
  return value === 'user' || value === 'assistant' || value === 'system'
}

function isValidTone(value: unknown): value is NonNullable<ChatMessage['tone']> {
  return value === 'neutral' || value === 'error'
}

function normalizeStringArray(value: unknown, limit = 8) {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .map((item) => String(item ?? '').trim())
    .filter(Boolean)
    .slice(0, limit)
}

function normalizeWebSearchDisplay(value: unknown): WebSearchDisplay | undefined {
  if (!isObject(value) || typeof value.mode !== 'string') {
    return undefined
  }

  const mode = value.mode
  if (mode !== 'lyrics' && mode !== 'answer' && mode !== 'search_list') {
    return undefined
  }

  const title = String(value.title ?? '').trim()
  const summary = String(value.summary ?? '').trim()
  const bodyLines = normalizeStringArray(value.bodyLines, 8)

  const panels = Array.isArray(value.panels)
    ? value.panels
      .map((panel) => {
        if (!isObject(panel)) {
          return null
        }

        const title = String(panel.title ?? '').trim()
        const body = String(panel.body ?? '').trim()
        const url = String(panel.url ?? '').trim()
        const host = String(panel.host ?? '').trim()

        if (!title || !body || !url || !host) {
          return null
        }

        const publishedAt = String(panel.publishedAt ?? '').trim()
        return {
          title,
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
        if (!isObject(source)) {
          return null
        }

        const title = String(source.title ?? '').trim()
        const url = String(source.url ?? '').trim()
        if (!title || !url) {
          return null
        }

        const host = String(source.host ?? '').trim()
        const publishedAt = String(source.publishedAt ?? '').trim()

        return {
          title,
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
          if (!isObject(item)) {
            return null
          }

          const title = String(item.title ?? '').trim()
          const url = String(item.url ?? '').trim()
          const snippet = String(item.snippet ?? '').trim()
          if (!title || !url || !snippet) {
            return null
          }

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

    if (!query || !items.length) {
      return undefined
    }

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
    if (!location || !resolvedName || !currentSummary) {
      return undefined
    }

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
    if (!url) {
      return undefined
    }

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

function normalizeMessage(value: unknown, index: number): ChatMessage | null {
  if (!isObject(value) || !isValidRole(value.role)) {
    return null
  }

  const content = String(value.content ?? '').trim()
  if (!content) {
    return null
  }

  const createdAt = String(value.createdAt ?? '').trim()
  const normalizedCreatedAt = Number.isNaN(Date.parse(createdAt))
    ? new Date(Date.now() + index).toISOString()
    : new Date(createdAt).toISOString()
  const toolResult = normalizeToolResult(value.toolResult)

  const reasoning = typeof value.reasoning_content === 'string' && value.reasoning_content
    ? value.reasoning_content
    : undefined

  return {
    id: typeof value.id === 'string' && value.id.trim() ? value.id : createId('msg'),
    role: value.role,
    content,
    createdAt: normalizedCreatedAt,
    ...(isValidTone(value.tone) ? { tone: value.tone } : {}),
    ...(toolResult ? { toolResult } : {}),
    ...(reasoning ? { reasoning_content: reasoning } : {}),
  }
}

export function serializeChatHistoryArchive(messages: ChatMessage[], meta: ChatArchiveMeta) {
  const payload: ChatArchivePayload = {
    schema: 'nexus.chat-history',
    version: 1,
    exportedAt: new Date().toISOString(),
    meta,
    messageCount: messages.length,
    messages,
  }

  return JSON.stringify(payload, null, 2)
}

export function parseChatHistoryArchive(raw: string) {
  let parsed: unknown

  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error(t('chat.archive.parse_failed'))
  }

  const rawMessages = Array.isArray(parsed)
    ? parsed
    : isObject(parsed) && Array.isArray(parsed.messages)
      ? parsed.messages
      : isObject(parsed) && Array.isArray(parsed.chatMessages)
        ? parsed.chatMessages
        : null

  if (!rawMessages) {
    throw new Error(t('chat.archive.no_messages_field'))
  }

  const messages = rawMessages
    .map((item, index) => normalizeMessage(item, index))
    .filter((item): item is ChatMessage => Boolean(item))

  if (!messages.length) {
    throw new Error(t('chat.archive.no_valid_messages'))
  }

  return messages.sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt))
}
