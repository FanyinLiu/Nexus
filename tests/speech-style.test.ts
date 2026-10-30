import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  formatSpeechStyle,
  formatSpeechStyleLines,
  speechStyleRules,
} from '../src/features/persona/speechStyle.ts'
import {
  normalizePersonaSpeechStyle,
  PERSONA_SPEECH_DIAL_MAX,
  PERSONA_SPEECH_MAX_SENTENCES_MAX,
} from '../shared/speechStyle.js'
import {
  loadPersonaProfileFromReader,
  normalizePersonaStyle,
} from '../electron/services/personaProfileLoader.js'
import { enSettingsMemory } from '../src/i18n/locales/en/settings-memory.ts'
import { jaSettingsMemory } from '../src/i18n/locales/ja/settings-memory.ts'
import { koSettingsMemory } from '../src/i18n/locales/ko/settings-memory.ts'
import { zhCNSettingsMemory } from '../src/i18n/locales/zh-CN/settings-memory.ts'
import { zhTWSettingsMemory } from '../src/i18n/locales/zh-TW/settings-memory.ts'
import type { UiLanguage } from '../src/types'
import { buildChatRequestPayload } from '../src/features/chat/systemPromptBuilder.ts'
import { loadSettings } from '../src/lib/storage.ts'
import type { ChatMessage, MemoryRecallContext } from '../src/types'

const LOCALES: UiLanguage[] = ['en-US', 'zh-CN', 'zh-TW', 'ja', 'ko']

const COPY_KEYS = [
  'memory.soul.voice_title',
  'memory.soul.voice_hint',
  'memory.soul.clingy',
  'memory.soul.aloof',
  'memory.soul.playful',
  'memory.soul.tsundere',
  'memory.soul.max_sentences',
  'memory.soul.sentences',
  'memory.soul.emoji',
  'memory.soul.save_voice',
  'memory.soul.voice_saved',
  'memory.soul.voice_failed',
] as const

const DICTIONARIES = {
  'en-US': enSettingsMemory,
  'zh-CN': zhCNSettingsMemory,
  'zh-TW': zhTWSettingsMemory,
  ja: jaSettingsMemory,
  ko: koSettingsMemory,
}

function loader(files: Record<string, string>) {
  return loadPersonaProfileFromReader({
    id: 'style-test',
    rootDir: '/style-test',
    read: async (relative: string) => files[relative] ?? null,
  })
}

test('the settings card has speech-style copy in every locale', () => {
  for (const uiLanguage of LOCALES) {
    const dictionary = DICTIONARIES[uiLanguage] as Record<string, string>
    for (const key of COPY_KEYS) {
      const text = dictionary[key]
      assert.equal(typeof text, 'string', `${uiLanguage} is missing ${key}`)
      assert.ok(text.trim().length > 0, `${uiLanguage} has empty copy for ${key}`)
    }
  }

  assert.equal(zhCNSettingsMemory['memory.soul.clingy'], '撒娇程度')
  assert.equal(zhCNSettingsMemory['memory.soul.aloof'], '高冷程度')
  assert.equal(jaSettingsMemory['memory.soul.clingy'], '甘え度')
  assert.equal(jaSettingsMemory['memory.soul.aloof'], 'クール度')
  assert.match(jaSettingsMemory['memory.soul.voice_hint'], /ください/)
})

test('each locale turns the dials into concrete lines', () => {
  const style = {
    clingy: 3,
    aloof: 3,
    playful: 2,
    tsundere: true,
    maxSentences: 2,
    selfRef: '我',
    callUser: '笨蛋',
    particles: ['嘛', '哼'],
    emojiOk: false,
    markdownOk: false,
  }

  for (const uiLanguage of LOCALES) {
    const block = formatSpeechStyle(style, uiLanguage)
    assert.ok(block.length > 0, `${uiLanguage} must produce a block`)
    assert.ok(block.split('\n').length >= 8, `${uiLanguage} must list the dials`)
    assert.doesNotMatch(block, /[{}]/, `${uiLanguage} must be prose, not JSON`)
  }

  assert.match(formatSpeechStyle(style, 'zh-CN'), /撒娇/)
  assert.match(formatSpeechStyle(style, 'zh-CN'), /冷淡/)
  assert.match(formatSpeechStyle(style, 'zh-CN'), /傲娇|嘴硬/)
  assert.match(formatSpeechStyle(style, 'zh-TW'), /撒嬌/)
  assert.match(formatSpeechStyle(style, 'ja'), /甘え/)
  assert.match(formatSpeechStyle(style, 'ko'), /애교/)
  assert.match(formatSpeechStyle(style, 'en-US'), /few words/)
  assert.match(formatSpeechStyle(style, 'en-US'), /Prickly/)
  assert.match(formatSpeechStyle(style, 'en-US'), /at most 2 sentences/i)
})

test('a persona without dials adds no speech section', () => {
  for (const uiLanguage of LOCALES) {
    assert.equal(formatSpeechStyle(undefined, uiLanguage), '')
    assert.deepEqual(formatSpeechStyleLines({}, uiLanguage), [])
  }
  assert.deepEqual(speechStyleRules(undefined), [])
})

test('dial values are clamped and junk fields are dropped', () => {
  const normalized = normalizePersonaSpeechStyle({
    clingy: -4,
    aloof: 9,
    playful: 2.6,
    maxSentences: 99,
    tsundere: 'yes',
    selfRef: '  小绘  ',
    callUser: 42,
    particles: ['嘛', 3, ' 哼 ', '嘛', ''],
    emojiOk: false,
    markdownOk: 'no',
    extra: 'ignored',
  })

  assert.deepEqual(normalized, {
    maxSentences: PERSONA_SPEECH_MAX_SENTENCES_MAX,
    clingy: 0,
    aloof: PERSONA_SPEECH_DIAL_MAX,
    playful: 3,
    selfRef: '小绘',
    particles: ['嘛', '哼'],
    emojiOk: false,
  })

  const lines = formatSpeechStyleLines(normalized, 'en-US')
  assert.ok(lines.some((line) => line.includes('few words')), 'aloof 9 clamps to the strongest line')
  assert.ok(lines.some((line) => line.toLowerCase().includes('at most 6 sentences')), 'a 99-sentence cap clamps to 6')
  assert.ok(!lines.some((line) => line.includes('prickly')), 'a non-boolean tsundere is ignored')
})

test('the loader parses style.json speechStyle and preserves the rest of the style', async () => {
  const loaded = await loader({
    'style.json': JSON.stringify({
      forbiddenPhrases: ['as an AI'],
      toneTags: ['cool'],
      speechStyle: { aloof: 7, maxSentences: 0, tsundere: true, particles: ['哼'] },
    }),
  })

  assert.deepEqual(loaded.style.forbiddenPhrases, ['as an AI'])
  assert.deepEqual(loaded.style.toneTags, ['cool'])
  assert.deepEqual(loaded.style.speechStyle, {
    maxSentences: 1,
    aloof: 3,
    tsundere: true,
    particles: ['哼'],
  })
  assert.equal(loaded.present, true)
})

test('a malformed speechStyle is removed without touching the rest of style.json', () => {
  assert.deepEqual(normalizePersonaStyle({
    forbiddenPhrases: ['x'],
    speechStyle: { aloof: 'cold', particles: 'nope' },
  }), { forbiddenPhrases: ['x'] })
  assert.deepEqual(normalizePersonaStyle({ speechStyle: [] }), {})
  assert.deepEqual(normalizePersonaStyle('not an object'), {})
})

test('the chat prompt puts the speech style after the persona and repeats the dials post-history', async () => {
  class MemoryStorage {
    private data = new Map<string, string>()
    getItem(key: string) { return this.data.get(key) ?? null }
    setItem(key: string, value: string) { this.data.set(key, String(value)) }
    removeItem(key: string) { this.data.delete(key) }
    clear() { this.data.clear() }
  }
  const persona = {
    id: 'card-style',
    rootDir: '/personas/card-style',
    soul: 'PERSONA-SENTINEL: cold on the surface, soft underneath.',
    memory: '',
    examplesRaw: '',
    examples: [],
    style: { speechStyle: { aloof: 3, tsundere: true, maxSentences: 2 } },
    voice: {},
    tools: {},
    present: true,
  }
  Object.defineProperty(globalThis, 'window', {
    value: {
      localStorage: new MemoryStorage(),
      desktopPet: {
        personaLoadSoul: async () => '',
        personaLoadMemory: async () => '',
        personaLoadProfile: async () => persona,
      },
    },
    configurable: true,
    writable: true,
  })

  const settings = {
    ...loadSettings(),
    uiLanguage: 'en-US' as const,
    companionName: 'Aster',
    userName: 'Klein',
    activeCharacterProfileId: 'card-style',
    systemPrompt: 'fallback',
  }
  const memoryContext: MemoryRecallContext = {
    longTerm: [],
    daily: [],
    semantic: [],
    searchModeUsed: 'keyword',
    vectorSearchAvailable: false,
  }
  const history: ChatMessage[] = [{
    id: 'u1',
    role: 'user',
    content: 'still there?',
    createdAt: '2026-10-29T08:00:00.000Z',
  }]

  const payload = await buildChatRequestPayload(settings, history, memoryContext, {})
  const system = String(payload.messages[0]?.content ?? '')
  const latest = String(payload.messages.at(-1)?.content ?? '')
  const personaAt = system.indexOf('PERSONA-SENTINEL')
  const styleAt = system.indexOf('[Speech style]')

  assert.ok(personaAt >= 0, 'the persona text is present')
  assert.ok(styleAt > personaAt, 'the speech style follows the persona')
  assert.match(latest, /<character-reminder>/)
  assert.match(latest, /few words/)
  assert.match(latest, /prickly/i)
  assert.match(latest, /at most 2 sentences/i)
})
