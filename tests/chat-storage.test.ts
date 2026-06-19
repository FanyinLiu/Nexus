import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  loadChatMessages,
  normalizeChatMessagesForStorage,
} from '../src/lib/storage/chat.ts'
import {
  loadChatSessions,
  normalizeChatSessionsForStorage,
} from '../src/lib/storage/chatSessions.ts'
import {
  buildChatLocalDataRuntimeMirrorSession,
  CHAT_LOCAL_DATA_RUNTIME_MIRROR_CONSENT_KEY,
  getChatLocalDataRuntimeMirrorConsent,
  setChatLocalDataRuntimeMirrorConsent,
} from '../src/lib/storage/chatLocalDataRuntimeMirror.ts'
import {
  CHAT_SESSIONS_STORAGE_KEY,
  CHAT_STORAGE_KEY,
} from '../src/lib/storage/core.ts'
import type { ChatMessage } from '../src/types/chat.ts'

function createLocalStorageMock(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial))
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, String(value)) },
    removeItem: (key: string) => { store.delete(key) },
    clear: () => { store.clear() },
  }
}

function installStorage(initial: Record<string, string> = {}) {
  const localStorage = createLocalStorageMock(initial)
  Object.defineProperty(globalThis, 'window', {
    value: {
      localStorage,
      setTimeout: globalThis.setTimeout.bind(globalThis),
      clearTimeout: globalThis.clearTimeout.bind(globalThis),
    },
    configurable: true,
    writable: true,
  })
  return localStorage
}

test('loadChatMessages compacts malformed persisted messages and writes back', () => {
  const storage = installStorage({
    [CHAT_STORAGE_KEY]: JSON.stringify([
      {
        id: ' ',
        role: 'user',
        content: '  hello  ',
        createdAt: '2026-06-04T00:00:00Z',
        tone: 'loud',
        images: ['data:image/png;base64,abc'],
      },
      {
        id: 'assistant-1',
        role: 'assistant',
        content: 'answer',
        createdAt: 1780531200000,
        toolResult: { kind: 'open_external', result: { ok: true, url: ' https://example.com ', message: ' ok ' } },
      },
      { id: 'bad-role', role: 'bot', content: 'drop me', createdAt: '2026-06-04T00:00:00Z' },
      { id: 'bad-content', role: 'user', content: 42, createdAt: '2026-06-04T00:00:00Z' },
      { id: 'bad-date', role: 'user', content: 'drop me', createdAt: 'not-a-date' },
    ]),
  })

  const messages = loadChatMessages()

  assert.equal(messages.length, 2)
  assert.equal(messages[0]?.id, 'chat-message-recovered-0-1780531200000')
  assert.equal(messages[0]?.content, 'hello')
  assert.equal(messages[0]?.createdAt, '2026-06-04T00:00:00.000Z')
  assert.equal(messages[0]?.tone, undefined)
  assert.equal(messages[0]?.images, undefined)
  assert.deepEqual(messages[1]?.toolResult, {
    kind: 'open_external',
    result: { ok: true, url: 'https://example.com', message: 'ok' },
  })
  assert.deepEqual(JSON.parse(storage.getItem(CHAT_STORAGE_KEY) ?? '[]'), messages)
})

test('normalizeChatMessagesForStorage caps newest messages and strips images', () => {
  const messages: ChatMessage[] = Array.from({ length: 505 }, (_, index) => ({
    id: `msg-${index}`,
    role: index % 2 === 0 ? 'user' : 'assistant',
    content: `message ${index}`,
    createdAt: new Date(1780531200000 + index).toISOString(),
    images: ['data:image/png;base64,abc'],
  }))

  const normalized = normalizeChatMessagesForStorage(messages)

  assert.equal(normalized.length, 500)
  assert.equal(normalized[0]?.id, 'msg-5')
  assert.equal(normalized.at(-1)?.id, 'msg-504')
  assert.equal(normalized.some((message) => message.images?.length), false)
})

test('normalizeChatSessionsForStorage sorts, dedupes, and normalizes nested messages', () => {
  const sessions = normalizeChatSessionsForStorage([
    {
      id: 'same',
      startedAt: 10,
      lastActiveAt: 10,
      title: ' older ',
      messages: [{ id: 'm1', role: 'user', content: 'old', createdAt: '2026-06-01T00:00:00Z' }],
    },
    {
      id: 'same',
      startedAt: '2026-06-02T00:00:00Z',
      lastActiveAt: '2026-06-03T00:00:00Z',
      title: ` ${'new '.repeat(30)} `,
      messages: [
        { id: 'm2', role: 'assistant', content: 'new', createdAt: '2026-06-03T00:00:00Z', images: ['data:image/png;base64,abc'] },
        { id: 'bad', role: 'bot', content: 'drop', createdAt: '2026-06-03T00:00:00Z' },
      ],
    },
    {
      id: '',
      startedAt: 'bad',
      lastActiveAt: 'bad',
      messages: [{ role: 'user', content: 'recovered', createdAt: '2026-06-04T00:00:00Z' }],
    },
  ])

  assert.equal(sessions.length, 2)
  assert.equal(sessions[0]?.id, 'chat-session-recovered-2-1780531200000')
  assert.equal(sessions[0]?.startedAt, Date.parse('2026-06-04T00:00:00Z'))
  assert.equal(sessions[0]?.lastActiveAt, Date.parse('2026-06-04T00:00:00Z'))
  assert.equal(sessions[1]?.id, 'same')
  assert.equal(sessions[1]?.title?.length, 80)
  assert.equal(sessions[1]?.messages.length, 1)
  assert.equal(sessions[1]?.messages[0]?.images, undefined)
})

test('loadChatSessions compacts persisted sessions and writes normalized store', () => {
  const storage = installStorage({
    [CHAT_SESSIONS_STORAGE_KEY]: JSON.stringify([
      {
        id: 'session-1',
        startedAt: '2026-06-01T00:00:00Z',
        lastActiveAt: '2026-06-02T00:00:00Z',
        messages: [{ id: 'm1', role: 'user', content: 'hi', createdAt: '2026-06-02T00:00:00Z' }],
      },
      { id: 'bad', startedAt: 1, lastActiveAt: 2, messages: 'not-array' },
    ]),
  })

  const sessions = loadChatSessions()

  assert.equal(sessions.length, 2)
  assert.deepEqual(JSON.parse(storage.getItem(CHAT_SESSIONS_STORAGE_KEY) ?? '[]'), sessions)
})

test('loadChatSessions migrates legacy flat chat using message timestamps', async () => {
  const storage = installStorage({
    [CHAT_STORAGE_KEY]: JSON.stringify([
      { id: 'legacy-1', role: 'user', content: 'first topic', createdAt: '2026-06-01T00:00:00Z' },
      { id: 'legacy-2', role: 'assistant', content: 'reply', createdAt: '2026-06-02T00:00:00Z' },
    ]),
  })

  const sessions = loadChatSessions()
  await new Promise((resolve) => setTimeout(resolve, 5))

  assert.equal(sessions.length, 1)
  assert.equal(sessions[0]?.id, 'chat-session-legacy-legacy-1')
  assert.equal(sessions[0]?.startedAt, Date.parse('2026-06-01T00:00:00Z'))
  assert.equal(sessions[0]?.lastActiveAt, Date.parse('2026-06-02T00:00:00Z'))
  assert.equal(sessions[0]?.title, 'first topic')
  assert.deepEqual(JSON.parse(storage.getItem(CHAT_SESSIONS_STORAGE_KEY) ?? '[]'), sessions)
})

test('chat local-data runtime mirror helper normalizes content and stores explicit consent', () => {
  const storage = installStorage()
  setChatLocalDataRuntimeMirrorConsent(true)
  assert.equal(storage.getItem(CHAT_LOCAL_DATA_RUNTIME_MIRROR_CONSENT_KEY), '1')
  assert.equal(getChatLocalDataRuntimeMirrorConsent(), true)

  const session = buildChatLocalDataRuntimeMirrorSession({
    id: 'session-1',
    startedAt: 1.4,
    lastActiveAt: 2.6,
    title: 'Private title',
    messages: [{
      id: 'm1',
      role: 'user',
      content: 'hello',
      createdAt: '2026-06-19T08:00:00.000Z',
      images: ['data:image/png;base64,abc'],
    }],
  })

  assert.deepEqual(session, {
    id: 'session-1',
    startedAt: 1,
    lastActiveAt: 3,
    title: 'Private title',
    messages: [{
      id: 'm1',
      role: 'user',
      content: 'hello',
      createdAt: '2026-06-19T08:00:00.000Z',
    }],
  })

  setChatLocalDataRuntimeMirrorConsent(false)
  assert.equal(storage.getItem(CHAT_LOCAL_DATA_RUNTIME_MIRROR_CONSENT_KEY), null)
  assert.equal(getChatLocalDataRuntimeMirrorConsent(), false)
})
