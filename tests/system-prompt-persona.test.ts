import assert from 'node:assert/strict'
import { beforeEach, test } from 'node:test'

import { loadActiveProfilePersona, buildChatRequestPayload } from '../src/features/chat/systemPromptBuilder.ts'
import { getChatPromptStrings } from '../src/features/chat/prompts/index.ts'
import { invalidateResolvedPersonaCache } from '../src/features/persona/resolveActivePersona.ts'
import { loadSettings } from '../src/lib/storage.ts'
import type { AppSettings, ChatMessage, MemoryRecallContext } from '../src/types'

class MemoryStorage {
  private data = new Map<string, string>()

  getItem(key: string) { return this.data.get(key) ?? null }
  setItem(key: string, value: string) { this.data.set(key, String(value)) }
  removeItem(key: string) { this.data.delete(key) }
  clear() { this.data.clear() }
}

function settingsWith(partial: Partial<AppSettings>): AppSettings {
  return partial as AppSettings
}

const LOCALES = ['en-US', 'zh-CN', 'zh-TW', 'ja', 'ko'] as const

const memoryContext: MemoryRecallContext = {
  longTerm: [],
  daily: [],
  semantic: [],
  searchModeUsed: 'keyword',
  vectorSearchAvailable: false,
}

beforeEach(() => {
  Object.defineProperty(globalThis, 'window', {
    value: { localStorage: new MemoryStorage(), desktopPet: {} },
    configurable: true,
    writable: true,
  })
})

test('loadActiveProfilePersona no longer depends on the legacy chat flag', async () => {
  let called = 0
  window.desktopPet = {
    personaLoadProfile: async (id: string) => {
      called += 1
      return { id, present: true, soul: 'x' }
    },
  } as unknown as typeof window.desktopPet

  const result = await loadActiveProfilePersona(
    settingsWith({ profilePersonaInChatEnabled: false, activeCharacterProfileId: 'card-1' }),
  )
  assert.equal(result?.soul, 'x')
  assert.equal(called, 1)
})

test('loadActiveProfilePersona returns the active profile persona when present', async () => {
  const ids: string[] = []
  window.desktopPet = {
    personaLoadProfile: async (id: string) => {
      ids.push(id)
      return { id, present: true, soul: 'card soul' }
    },
  } as unknown as typeof window.desktopPet

  const result = await loadActiveProfilePersona(
    settingsWith({ profilePersonaInChatEnabled: true, activeCharacterProfileId: 'card-1' }),
  )
  assert.equal(result?.soul, 'card soul')
  assert.deepEqual(ids, ['card-1'])
})

test('loadActiveProfilePersona falls back to the default profile when the active one is empty', async () => {
  const ids: string[] = []
  window.desktopPet = {
    personaLoadProfile: async (id: string) => {
      ids.push(id)
      return id === 'xinghui'
        ? { id, present: true, soul: 'default soul' }
        : { id, present: false, soul: '' }
    },
  } as unknown as typeof window.desktopPet

  const result = await loadActiveProfilePersona(
    settingsWith({ profilePersonaInChatEnabled: true, activeCharacterProfileId: 'card-empty' }),
  )
  assert.equal(result?.soul, 'default soul')
  assert.deepEqual(ids, ['card-empty', 'xinghui'])
})

test('loadActiveProfilePersona returns null when nothing is present after fallback', async () => {
  window.desktopPet = {
    personaLoadProfile: async (id: string) => ({ id, present: false, soul: '' }),
  } as unknown as typeof window.desktopPet

  const result = await loadActiveProfilePersona(
    settingsWith({ profilePersonaInChatEnabled: true, activeCharacterProfileId: 'card-empty' }),
  )
  assert.equal(result, null)
})

test('loadActiveProfilePersona returns null when the bridge is unavailable', async () => {
  window.desktopPet = {} as typeof window.desktopPet
  const result = await loadActiveProfilePersona(
    settingsWith({ profilePersonaInChatEnabled: true, activeCharacterProfileId: 'card-1' }),
  )
  assert.equal(result, null)
})

test('loadActiveProfilePersona returns null and does not throw when loading fails', async () => {
  const originalWarn = console.warn
  const warnCalls: unknown[][] = []
  window.desktopPet = {
    personaLoadProfile: async () => {
      throw new Error('failed settings:apiKey token=xai-abcdefghijklmnop at /Users/klein/SOUL.md')
    },
  } as unknown as typeof window.desktopPet
  console.warn = (...args: unknown[]) => { warnCalls.push(args) }

  try {
    const result = await loadActiveProfilePersona(
      settingsWith({ profilePersonaInChatEnabled: true, activeCharacterProfileId: 'card-1' }),
    )
    assert.equal(result, null)
  } finally {
    console.warn = originalWarn
  }

  const serialized = JSON.stringify(warnCalls)
  assert.equal(warnCalls.length, 1)
  assert.match(serialized, /token=\*\*\*/)
  assert.match(serialized, /~\/SOUL\.md/)
  assert.doesNotMatch(serialized, /settings:apiKey/)
  assert.doesNotMatch(serialized, /xai-abcdefghijklmnop/)
  assert.doesNotMatch(serialized, /\/Users\/klein/)
})

test('chat header names the character but leaves its voice to the persona', () => {
  for (const uiLanguage of LOCALES) {
    const header = getChatPromptStrings(uiLanguage).headerLines({
      companionName: 'Aster',
      userName: 'Klein',
    })

    assert.ok(header.includes('Aster'), `${uiLanguage} header must name the companion`)
    assert.ok(header.includes('Klein'), `${uiLanguage} header must name the user`)
    assert.doesNotMatch(header, /\bAI\b/, `${uiLanguage} header must not call her an AI`)
    assert.doesNotMatch(
      header,
      /温柔|溫柔|warm|gentle|soft|二次元|やさし|優し|부드럽|따뜻/i,
      `${uiLanguage} header must not hard-code a tone`,
    )
  }
})

test('persona text comes after the header in every locale', async () => {
  for (const uiLanguage of LOCALES) {
    const settings = {
      ...loadSettings(),
      uiLanguage,
      companionName: 'Aster',
      userName: 'Klein',
      systemPrompt: 'PERSONA-SENTINEL: aloof, terse, secretly soft.',
    }
    const history: ChatMessage[] = [{
      id: `persona-order-${uiLanguage}`,
      role: 'user',
      content: '在吗',
      createdAt: '2026-10-29T08:00:00.000Z',
    }]

    const payload = await buildChatRequestPayload(settings, history, memoryContext, {})
    const system = String(payload.messages[0]?.content ?? '')
    const header = getChatPromptStrings(uiLanguage).headerLines({
      companionName: 'Aster',
      userName: 'Klein',
    })

    const headerAt = system.indexOf(header)
    const personaAt = system.indexOf('PERSONA-SENTINEL')
    assert.ok(headerAt >= 0, `${uiLanguage} prompt must contain the header`)
    assert.ok(personaAt >= 0, `${uiLanguage} prompt must contain the persona`)
    assert.ok(headerAt < personaAt, `${uiLanguage} persona must be the later, stronger signal`)
  }
})

test('mood-matched voice samples follow the speech style in chat', async () => {
  invalidateResolvedPersonaCache()
  window.desktopPet = {
    personaLoadProfile: async (id: string) => ({
      id,
      rootDir: '/fake',
      present: true,
      soul: 'PERSONA-SENTINEL',
      examples: [
        { user: '在吗', assistant: '例句-撒娇', mood: 'affectionate', kind: 'reply' },
        { user: '我帅吗', assistant: '例句-玩笑', mood: 'playful', kind: 'reply' },
      ],
      style: { speechStyle: { maxSentences: 2 } },
    }),
  } as unknown as typeof window.desktopPet

  const settings = {
    ...loadSettings(),
    activeCharacterProfileId: 'examples-chat',
    uiLanguage: 'zh-CN' as const,
    companionName: '星绘',
    userName: '主人',
  }
  const history: ChatMessage[] = [{
    id: 'examples-chat-turn',
    role: 'user',
    content: '在吗',
    createdAt: '2026-10-29T08:00:00.000Z',
  }]

  const payload = await buildChatRequestPayload(settings, history, memoryContext, {
    emotionMood: 'affectionate',
  })
  const system = String(payload.messages[0]?.content ?? '')
  const header = getChatPromptStrings('zh-CN').personaExamplesHeader

  assert.ok(system.includes(header), 'the voice-sample block must be in the prompt')
  assert.ok(system.includes('例句-撒娇'), 'the mood-matched sample must be picked')
  assert.ok(
    system.indexOf('【说话方式】') < system.indexOf(header),
    'voice samples must come after the speech-style section',
  )
})

test('tool and screen copy speak in her voice instead of assistant filler', () => {
  for (const uiLanguage of LOCALES) {
    const prompts = getChatPromptStrings(uiLanguage)
    const tools = prompts.mcpToolsNative('1. web_search: find things')

    assert.doesNotMatch(
      tools,
      /help the user|帮助用户|協助使用者|助けてください|도와주세요/i,
      `${uiLanguage} tool copy must not frame the reply as helping the user`,
    )
    assert.doesNotMatch(
      tools,
      /tell the user|告知用户|告知使用者|ユーザーに伝えて|사용자에게 알리고/i,
      `${uiLanguage} tool copy must not use a support-desk fallback`,
    )
    assert.match(
      tools,
      /your own voice|你自己的口吻|你自己的口氣|自分の口調|당신의 말투/,
      `${uiLanguage} tool copy must ask for her own voice`,
    )
    assert.doesNotMatch(
      prompts.screenDisplay,
      /好的，主人|네, 주인님|かしこまりました、ご主人さま|Sure, here you go/i,
      `${uiLanguage} screen copy must not plant owner-honorific filler`,
    )
  }
})
