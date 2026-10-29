import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeEach, test } from 'node:test'

import { loadPersonaProfileFromReader } from '../electron/services/personaProfileLoader.js'
import { createDefaultEmotionState } from '../src/features/autonomy/emotionModel.ts'
import type { AutonomyContextV2 } from '../src/features/autonomy/v2/contextGatherer.ts'
import { buildDecisionPrompt } from '../src/features/autonomy/v2/decisionPrompt.ts'
import {
  createEmptyLoadedPersona,
  DEFAULT_PERSONA_PROFILE_ID,
  type LoadedPersona,
} from '../src/features/autonomy/v2/personaTypes.ts'
import { buildChatRequestPayload } from '../src/features/chat/systemPromptBuilder.ts'
import { buildLetterPrompt } from '../src/features/letter/letterPromptBuilder.ts'
import type { SundayLetterDataReady } from '../src/features/letter/aggregator.ts'
import { BUNDLED_DEFAULT_PERSONA } from '../src/features/persona/bundledPersona.ts'
import {
  invalidateResolvedPersonaCache,
  resolveActivePersona,
  type PersonaBridge,
  type PersonaCache,
  type PersonaResolverSettings,
} from '../src/features/persona/resolveActivePersona.ts'
import { getDefaultSystemPrompt } from '../src/lib/settingsMigrations.ts'
import { loadSettings } from '../src/lib/storage.ts'
import type { AppSettings, ChatMessage, MemoryRecallContext } from '../src/types'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(__dirname, '..')
const XINGHUI_SEED_DIR = join(REPO_ROOT, 'src/features/autonomy/v2/personas/xinghui')

function settings(partial: Partial<PersonaResolverSettings> = {}): PersonaResolverSettings {
  return {
    activeCharacterProfileId: '',
    systemPrompt: getDefaultSystemPrompt('zh-CN'),
    uiLanguage: 'zh-CN',
    companionName: '星绘',
    userName: '主人',
    ...partial,
  }
}

function profile(id: string, soul: string, overrides: Partial<LoadedPersona> = {}): LoadedPersona {
  return {
    ...createEmptyLoadedPersona(id, `personas/${id}`),
    present: true,
    soul,
    ...overrides,
  }
}

function absent(id: string): LoadedPersona {
  return createEmptyLoadedPersona(id, `personas/${id}`)
}

type BridgeHarness = {
  bridge: PersonaBridge
  calls: string[]
  setSoul: (soul: string) => void
  setProfile: (id: string, next: LoadedPersona | null) => void
}

function makeBridge(options: {
  profiles?: Record<string, LoadedPersona>
  soul?: string
} = {}): BridgeHarness {
  const profiles = new Map(Object.entries(options.profiles ?? {}))
  let soul = options.soul ?? ''
  const calls: string[] = []
  return {
    calls,
    bridge: {
      loadProfile: async (id: string) => {
        calls.push(id)
        return profiles.get(id) ?? absent(id)
      },
      loadSoul: async () => soul,
    },
    setSoul: (next) => { soul = next },
    setProfile: (id, next) => {
      if (next) profiles.set(id, next)
      else profiles.delete(id)
    },
  }
}

function freshCache(): PersonaCache {
  return new Map()
}

function installWindow(options: {
  profiles?: Record<string, LoadedPersona>
  soul?: string
} = {}): void {
  const storage = new Map<string, string>()
  Object.defineProperty(globalThis, 'window', {
    value: {
      localStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => { storage.set(key, String(value)) },
        removeItem: (key: string) => { storage.delete(key) },
        clear: () => { storage.clear() },
      },
      desktopPet: {
        personaLoadProfile: async (id: string) => options.profiles?.[id] ?? absent(id),
        personaLoadSoul: async () => options.soul ?? '',
        personaLoadMemory: async () => '',
      },
    },
    configurable: true,
    writable: true,
  })
}

beforeEach(() => {
  invalidateResolvedPersonaCache()
  installWindow()
})

// ── fallback chain ──────────────────────────────────────────────────────

test('the active profile is step one of the chain', async () => {
  const harness = makeBridge({
    profiles: {
      'card-1': profile('card-1', 'CARD-SOUL', {
        style: { signaturePhrases: ['嗯'], forbiddenPhrases: ['当然可以'] },
        examples: [{ user: '早', assistant: '醒啦。' }],
      }),
    },
    soul: 'GLOBAL-SOUL',
  })

  const resolved = await resolveActivePersona(
    settings({ activeCharacterProfileId: 'card-1' }),
    { bridge: harness.bridge, cache: freshCache() },
  )

  assert.equal(resolved.source, 'profile')
  assert.equal(resolved.id, 'card-1')
  assert.equal(resolved.soul, 'CARD-SOUL')
  assert.deepEqual(resolved.style.signaturePhrases, ['嗯'])
  assert.equal(resolved.examples.length, 1)
  assert.deepEqual(harness.calls, ['card-1'])
})

test('an empty active profile falls back to the default profile, then SOUL.md', async () => {
  const harness = makeBridge({
    profiles: { [DEFAULT_PERSONA_PROFILE_ID]: profile(DEFAULT_PERSONA_PROFILE_ID, 'DEFAULT-PROFILE-SOUL') },
    soul: 'GLOBAL-SOUL',
  })

  const resolved = await resolveActivePersona(
    settings({ activeCharacterProfileId: 'card-missing' }),
    { bridge: harness.bridge, cache: freshCache() },
  )

  assert.equal(resolved.source, 'profile')
  assert.equal(resolved.id, DEFAULT_PERSONA_PROFILE_ID)
  assert.equal(resolved.soul, 'DEFAULT-PROFILE-SOUL')
  assert.deepEqual(harness.calls, ['card-missing', DEFAULT_PERSONA_PROFILE_ID])
})

test('with no profile, the global SOUL.md supplies the identity', async () => {
  const harness = makeBridge({ soul: 'SOUL-FILE-ONLY' })

  const resolved = await resolveActivePersona(settings(), {
    bridge: harness.bridge,
    cache: freshCache(),
  })

  assert.equal(resolved.source, 'soul')
  assert.equal(resolved.soul, 'SOUL-FILE-ONLY')
  // A user-written soul must not inherit the bundled character's voice.
  assert.deepEqual(resolved.style, {})
  assert.deepEqual(resolved.examples, [])
  assert.deepEqual(harness.calls, [DEFAULT_PERSONA_PROFILE_ID])
})

test('an untouched default soul keeps the bundled style and examples', async () => {
  const harness = makeBridge({ soul: getDefaultSystemPrompt('zh-CN') })

  const resolved = await resolveActivePersona(settings(), {
    bridge: harness.bridge,
    cache: freshCache(),
  })

  assert.equal(resolved.source, 'soul')
  assert.ok(resolved.style.forbiddenPhrases?.includes('作为 AI'))
  assert.ok(resolved.examples.length > 0)
})

test('a custom settings.systemPrompt is used verbatim with empty style', async () => {
  const harness = makeBridge()

  const resolved = await resolveActivePersona(
    settings({ systemPrompt: 'CUSTOM-PROMPT-ALMOND' }),
    { bridge: harness.bridge, cache: freshCache() },
  )

  assert.equal(resolved.source, 'systemPrompt')
  assert.equal(resolved.soul, 'CUSTOM-PROMPT-ALMOND')
  assert.deepEqual(resolved.style, {})
  assert.deepEqual(resolved.examples, [])
})

test('the shipped system prompt keeps the bundled style and examples', async () => {
  const harness = makeBridge()

  const resolved = await resolveActivePersona(settings(), {
    bridge: harness.bridge,
    cache: freshCache(),
  })

  assert.equal(resolved.source, 'systemPrompt')
  assert.ok(resolved.style.forbiddenPhrases?.includes('作为 AI'))
  assert.ok(resolved.examples.length > 0)
})

test('nothing configured still resolves the bundled persona as present', async () => {
  const harness = makeBridge()

  const resolved = await resolveActivePersona(
    settings({ systemPrompt: '' }),
    { bridge: harness.bridge, cache: freshCache() },
  )

  assert.equal(resolved.source, 'builtin')
  assert.equal(resolved.present, true)
  assert.equal(resolved.soul, BUNDLED_DEFAULT_PERSONA.soul)
  assert.ok(resolved.examples.length > 0)
})

test('every source carries the companion and user names', async () => {
  const harness = makeBridge({ soul: 'NAMED-SOUL' })

  const resolved = await resolveActivePersona(
    settings({ companionName: ' 小绘 ', userName: ' 阿岚 ' }),
    { bridge: harness.bridge, cache: freshCache() },
  )

  assert.equal(resolved.companionName, '小绘')
  assert.equal(resolved.userName, '阿岚')
})

test('a default install resolves a named, present persona through the bridge', async () => {
  // No persona directory and no SOUL.md: exactly what a fresh install has.
  const resolved = await resolveActivePersona(settings({ companionName: '星绘', systemPrompt: '' }))

  assert.equal(resolved.present, true)
  assert.equal(resolved.source, 'builtin')
  assert.equal(resolved.companionName, '星绘')
  assert.ok(resolved.soul.trim().length > 0)
})

test('a profile hit is cached until the soul-saved invalidation', async () => {
  const harness = makeBridge({ profiles: { 'card-1': profile('card-1', 'CARD-SOUL') } })
  const cache = freshCache()
  const readSettings = settings({ activeCharacterProfileId: 'card-1' })

  const first = await resolveActivePersona(readSettings, { bridge: harness.bridge, cache })
  assert.equal(first.soul, 'CARD-SOUL')
  assert.deepEqual(harness.calls, ['card-1'])

  harness.setProfile('card-1', profile('card-1', 'CARD-SOUL-EDITED'))
  const cached = await resolveActivePersona(readSettings, { bridge: harness.bridge, cache })
  assert.equal(cached.soul, 'CARD-SOUL')
  assert.deepEqual(harness.calls, ['card-1'])

  invalidateResolvedPersonaCache(cache)
  const fresh = await resolveActivePersona(readSettings, { bridge: harness.bridge, cache })
  assert.equal(fresh.soul, 'CARD-SOUL-EDITED')
  assert.deepEqual(harness.calls, ['card-1', 'card-1'])
})

test('a profile soul mtime travels with the resolved persona', async () => {
  const harness = makeBridge({
    profiles: { 'card-1': profile('card-1', 'CARD-SOUL', { soulMtimeMs: 1_770_000_000_000 }) },
  })

  const resolved = await resolveActivePersona(
    settings({ activeCharacterProfileId: 'card-1' }),
    { bridge: harness.bridge, cache: freshCache() },
  )

  assert.equal(resolved.soulMtimeMs, 1_770_000_000_000)
})

test('a failing profile bridge still reaches the system prompt', async () => {
  const originalWarn = console.warn
  const warnings: unknown[][] = []
  console.warn = (...args: unknown[]) => { warnings.push(args) }
  try {
    const resolved = await resolveActivePersona(
      settings({ systemPrompt: 'FALLBACK-AFTER-ERROR' }),
      {
        bridge: {
          loadProfile: async () => { throw new Error('ipc exploded') },
          loadSoul: async () => '',
        },
        cache: freshCache(),
      },
    )
    assert.equal(resolved.source, 'systemPrompt')
    assert.equal(resolved.soul, 'FALLBACK-AFTER-ERROR')
  } finally {
    console.warn = originalWarn
  }
  assert.equal(warnings.length, 1)
})

// ── one persona for chat, V2, and letters ───────────────────────────────

function decisionContext(): AutonomyContextV2 {
  return {
    timestamp: '2026-06-20T10:00:00.000Z',
    hour: 10,
    dayOfWeek: 6,
    focusState: 'active',
    activeWindowTitle: 'Nexus',
    activityClass: 'coding',
    userDeepFocused: false,
    idleSeconds: 2,
    consecutiveIdleTicks: 0,
    phase: 'awake',
    lastWakeAt: '2026-06-20T09:30:00.000Z',
    lastSleepAt: null,
    emotion: createDefaultEmotionState(),
    relationshipLevel: 'friend',
    relationshipScore: 40,
    daysInteracted: 30,
    streak: 4,
    recentMessages: [],
    topMemories: [],
    nearReminders: [],
    activeGoals: [],
    activityWindow: 'short',
    lastProactiveUtterance: null,
  }
}

function letterData(): SundayLetterDataReady {
  return {
    shouldFire: true,
    themes: [],
    highlights: [],
    stressors: [],
    reflectionLines: [],
    diaryLines: [],
    milestonesNotedThisWeek: [],
    weekDayCount: 3,
  }
}

test('chat, V2, and letters receive the same soul for the same settings', async () => {
  const marker = 'SHARED-SOUL-MARKER-WALNUT'
  installWindow({ profiles: { 'card-1': profile('card-1', marker) } })
  const base = loadSettings()
  const appSettings: AppSettings = { ...base, activeCharacterProfileId: 'card-1' }
  const history: ChatMessage[] = [{
    id: 'u1',
    role: 'user',
    content: 'hello',
    createdAt: '2026-04-01T00:00:00.000Z',
  }]
  const memoryContext: MemoryRecallContext = {
    longTerm: [],
    daily: [],
    semantic: [],
    searchModeUsed: 'keyword',
    vectorSearchAvailable: false,
  }

  const chat = await buildChatRequestPayload(appSettings, history, memoryContext, {
    currentTime: new Date('2026-04-01T00:00:00.000Z'),
  })
  const chatSystem = String(chat.messages[0]?.content ?? '')

  const persona = await resolveActivePersona(appSettings)
  const v2 = buildDecisionPrompt(decisionContext(), persona, { uiLanguage: 'zh-CN' })
  const letter = buildLetterPrompt({
    persona,
    data: letterData(),
    uiLanguage: 'zh-CN',
    letterDate: '2026-04-26',
  })

  assert.ok(chatSystem.includes(marker), 'chat uses the resolved soul')
  assert.ok(String(v2[0]?.content).includes(marker), 'V2 uses the resolved soul')
  assert.ok(letter[0].content.includes(marker), 'letter uses the resolved soul')
})

// ── bundled seed parity ─────────────────────────────────────────────────

test('the bundled default stays byte-equal to the shipped Xinghui seed', async () => {
  const soul = (await readFile(join(XINGHUI_SEED_DIR, 'soul.md'), 'utf8')).trim()
  const examplesRaw = (await readFile(join(XINGHUI_SEED_DIR, 'examples.md'), 'utf8')).trim()

  assert.equal(BUNDLED_DEFAULT_PERSONA.soul, soul)
  assert.equal(BUNDLED_DEFAULT_PERSONA.examplesRaw, examplesRaw)
  assert.deepEqual(
    BUNDLED_DEFAULT_PERSONA.style,
    JSON.parse(await readFile(join(XINGHUI_SEED_DIR, 'style.json'), 'utf8')),
  )
  assert.deepEqual(
    BUNDLED_DEFAULT_PERSONA.voice,
    JSON.parse(await readFile(join(XINGHUI_SEED_DIR, 'voice.json'), 'utf8')),
  )
  assert.deepEqual(
    BUNDLED_DEFAULT_PERSONA.tools,
    JSON.parse(await readFile(join(XINGHUI_SEED_DIR, 'tools.json'), 'utf8')),
  )

  const parsed = await loadPersonaProfileFromReader({
    id: 'xinghui',
    rootDir: XINGHUI_SEED_DIR,
    read: async (relativePath) => readFile(join(XINGHUI_SEED_DIR, relativePath), 'utf8'),
  })
  assert.deepEqual(BUNDLED_DEFAULT_PERSONA.examples, parsed.examples)
})
