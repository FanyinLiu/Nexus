import assert from 'node:assert/strict'
import { beforeEach, test } from 'node:test'

import { buildChatRequestPayload } from '../src/features/chat/systemPromptBuilder.ts'
import { loadSettings } from '../src/lib/storage.ts'
import type { ChatMessage, MemoryRecallContext } from '../src/types'

class MemoryStorage {
  private data = new Map<string, string>()

  getItem(key: string) { return this.data.get(key) ?? null }
  setItem(key: string, value: string) { this.data.set(key, String(value)) }
  removeItem(key: string) { this.data.delete(key) }
  clear() { this.data.clear() }
}

beforeEach(() => {
  Object.defineProperty(globalThis, 'window', {
    value: {
      localStorage: new MemoryStorage(),
      desktopPet: {
        personaLoadSoul: async () => '',
        personaLoadMemory: async () => '',
      },
    },
    configurable: true,
    writable: true,
  })
})

const memoryContext: MemoryRecallContext = {
  longTerm: [],
  daily: [],
  semantic: [],
  searchModeUsed: 'keyword',
  vectorSearchAvailable: false,
}

test('latest user message carries local date, weekday, time, and time-zone name', async () => {
  const currentTime = new Date(2026, 6, 13, 9, 7, 0, 0)
  const settings = { ...loadSettings(), uiLanguage: 'zh-CN' as const }
  const history: ChatMessage[] = [{
    id: 'user-time-context',
    role: 'user',
    content: '现在几点？',
    createdAt: currentTime.toISOString(),
  }]

  const payload = await buildChatRequestPayload(settings, history, memoryContext, { currentTime })
  const userContent = String(payload.messages.findLast((message) => message.role === 'user')?.content ?? '')
  const formatterOptions: Intl.DateTimeFormatOptions = {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'long',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'long',
  }
  const expectedDateTime = currentTime.toLocaleString('zh-CN', formatterOptions)
  const parts = new Intl.DateTimeFormat('zh-CN', formatterOptions).formatToParts(currentTime)

  assert.match(userContent, /^<system-reminder>/)
  assert.ok(userContent.includes(expectedDateTime))
  for (const partType of ['year', 'month', 'day', 'weekday', 'hour', 'minute', 'timeZoneName'] as const) {
    const part = parts.find((candidate) => candidate.type === partType)?.value
    assert.ok(part, `expected a local ${partType} part`)
    assert.ok(userContent.includes(part), `user reminder must include local ${partType}: ${part}`)
  }
  assert.match(userContent, /现在几点？$/)
})
