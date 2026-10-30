import assert from 'node:assert/strict'
import { test } from 'node:test'

import { PERSONA_SOUL_MAX_CHARS } from '../shared/personaSoul.js'
import { buildChatRequestPayload } from '../src/features/chat/systemPromptBuilder.ts'
import {
  loadSoulCard,
  saveSoulCard,
} from '../src/features/settingsV3/soulCardPersona.ts'
import { PERSONA_SOUL_SAVED_CHANNEL } from '../src/features/persona/personaEvents.ts'
import { COMPANION_SOUL_STORAGE_KEY } from '../src/lib/storage/core.ts'
import { loadSettings } from '../src/lib/storage.ts'
import type { AppSettings, ChatMessage, MemoryRecallContext } from '../src/types'

const PROFILE_EDIT = 'profile-soul-edit-apricot'
const GLOBAL_EDIT = 'global-soul-edit-barley'
const LEGACY = 'legacy-soul-card-cinder'
const KEPT = 'kept-soul-driftwood'

type ProfileFile = { present: boolean; soul: string }

type Harness = {
  saves: Array<{ content: string; profileId?: string }>
  profiles: Map<string, ProfileFile>
  globalSoul: { value: string }
  storage: Map<string, string>
}

function install(options: {
  panel: boolean
  globalSoul?: string
  profiles?: Record<string, ProfileFile>
  legacy?: string | null
}): Harness {
  const profiles = new Map(Object.entries(options.profiles ?? {}))
  const globalSoul = { value: options.globalSoul ?? '' }
  const saves: Harness['saves'] = []
  const storage = new Map<string, string>()
  if (options.legacy) {
    storage.set(COMPANION_SOUL_STORAGE_KEY, JSON.stringify({
      text: options.legacy,
      updatedAt: '2026-01-02T03:04:05.000Z',
    }))
  }
  const desktopPet = {
    isPanelWindow: async () => options.panel,
    personaLoadMemory: async () => '',
    personaLoadSoul: async () => globalSoul.value,
    personaSaveSoul: async (payload: { content: string; profileId?: string }) => {
      saves.push({ content: payload.content, profileId: payload.profileId })
      if (!options.panel) return { ok: false }
      if (payload.profileId) {
        const current = profiles.get(payload.profileId) ?? { present: true, soul: '' }
        profiles.set(payload.profileId, { ...current, present: true, soul: payload.content })
      } else {
        globalSoul.value = payload.content
      }
      return { ok: true }
    },
    personaLoadProfile: async (id: string) => {
      const row = profiles.get(id)
      if (!row?.present) {
        return {
          id,
          present: false,
          soul: '',
          memory: '',
          examplesRaw: '',
          examples: [],
          style: {},
          voice: {},
          tools: {},
          rootDir: `personas/${id}`,
        }
      }
      return {
        id,
        present: true,
        soul: row.soul,
        memory: '',
        examplesRaw: '',
        examples: [],
        style: {},
        voice: {},
        tools: {},
        rootDir: `personas/${id}`,
      }
    },
  }
  Object.defineProperty(globalThis, 'window', {
    value: {
      localStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => { storage.set(key, String(value)) },
        removeItem: (key: string) => { storage.delete(key) },
        clear: () => { storage.clear() },
      },
      desktopPet,
    },
    configurable: true,
    writable: true,
  })
  return { saves, profiles, globalSoul, storage }
}

const memoryContext: MemoryRecallContext = {
  longTerm: [],
  daily: [],
  semantic: [],
  searchModeUsed: 'keyword',
  vectorSearchAvailable: false,
}

function settingsWith(partial: Partial<AppSettings>): AppSettings {
  return { ...loadSettings(), ...partial }
}

async function systemPromptFor(settings: AppSettings): Promise<string> {
  const history: ChatMessage[] = [{
    id: 'user-soul',
    role: 'user',
    content: 'hello',
    createdAt: '2026-04-01T00:00:00.000Z',
  }]
  const payload = await buildChatRequestPayload(settings, history, memoryContext, {
    currentTime: new Date('2026-04-01T00:00:00.000Z'),
  })
  const content = payload.messages[0]?.content
  return typeof content === 'string' ? content : ''
}

test('editing the soul card updates the active profile persona in the next system prompt', async () => {
  const harness = install({
    panel: true,
    globalSoul: 'global-soul-should-stay',
    profiles: { 'card-1': { present: true, soul: 'profile-soul-before' } },
  })
  const settings = settingsWith({
    activeCharacterProfileId: 'card-1',
  })

  const saved = await saveSoulCard(settings, `  ${PROFILE_EDIT}\nsecond line  `)
  const prompt = await systemPromptFor(settings)

  assert.equal(saved.ok, true)
  if (!saved.ok) return
  assert.equal(saved.note.text, `${PROFILE_EDIT}\nsecond line`)
  assert.equal(saved.note.target.kind, 'profile')
  assert.equal(saved.restoredDefault, false)
  assert.equal(harness.profiles.get('card-1')?.soul, `${PROFILE_EDIT}\nsecond line`)
  assert.equal(harness.globalSoul.value, 'global-soul-should-stay')
  assert.deepEqual(harness.saves, [{ content: `${PROFILE_EDIT}\nsecond line`, profileId: 'card-1' }])
  assert.equal(harness.storage.get(COMPANION_SOUL_STORAGE_KEY), undefined)
  assert.match(prompt, new RegExp(PROFILE_EDIT))
  assert.match(prompt, /second line/)
  assert.doesNotMatch(prompt, /profile-soul-before/)
  assert.doesNotMatch(prompt, /global-soul-should-stay/)
})

test('editing the soul card updates SOUL.md when no profile persona is active', async () => {
  const harness = install({
    panel: true,
    globalSoul: 'global-soul-before',
  })
  const settings = settingsWith({
    activeCharacterProfileId: 'card-1',
  })

  const saved = await saveSoulCard(settings, GLOBAL_EDIT)
  const prompt = await systemPromptFor(settings)

  assert.equal(saved.ok, true)
  if (!saved.ok) return
  assert.equal(saved.note.target.kind, 'soul-file')
  assert.equal(saved.restoredDefault, false)
  assert.equal(harness.globalSoul.value, GLOBAL_EDIT)
  assert.deepEqual(harness.saves, [{ content: GLOBAL_EDIT, profileId: undefined }])
  assert.equal(harness.storage.get(COMPANION_SOUL_STORAGE_KEY), undefined)
  assert.match(prompt, new RegExp(GLOBAL_EDIT))
  assert.doesNotMatch(prompt, /global-soul-before/)
})

test('editing the soul card updates the fallback profile persona the prompt actually uses', async () => {
  const harness = install({
    panel: true,
    globalSoul: 'global-soul-should-stay',
    profiles: {
      'card-missing': { present: false, soul: '' },
      xinghui: { present: true, soul: 'xinghui-soul-before' },
    },
  })
  const settings = settingsWith({
    activeCharacterProfileId: 'card-missing',
  })

  await saveSoulCard(settings, 'xinghui-soul-edit-elm')
  const prompt = await systemPromptFor(settings)

  assert.equal(harness.profiles.get('xinghui')?.soul, 'xinghui-soul-edit-elm')
  assert.equal(harness.saves[0]?.profileId, 'xinghui')
  assert.match(prompt, /xinghui-soul-edit-elm/)
  assert.doesNotMatch(prompt, /xinghui-soul-before/)
  assert.doesNotMatch(prompt, /global-soul-should-stay/)
})

test('a legacy soul note is copied once into an empty SOUL file and then dropped', async () => {
  const harness = install({
    panel: true,
    globalSoul: '',
    legacy: LEGACY,
  })
  const settings = settingsWith({
    activeCharacterProfileId: '',
  })

  const migrated = await loadSoulCard(settings)
  const prompt = await systemPromptFor(settings)
  await loadSoulCard(settings)

  assert.equal(migrated.text, LEGACY)
  assert.equal(harness.globalSoul.value, LEGACY)
  assert.equal(harness.saves.length, 1)
  assert.equal(harness.storage.get(COMPANION_SOUL_STORAGE_KEY), undefined)
  assert.match(prompt, new RegExp(LEGACY))
})

test('a legacy soul note is copied into an empty profile persona and not into SOUL.md', async () => {
  const harness = install({
    panel: true,
    globalSoul: 'global-fallback-should-lose',
    profiles: { 'card-1': { present: true, soul: '' } },
    legacy: LEGACY,
  })
  const settings = settingsWith({
    activeCharacterProfileId: 'card-1',
  })

  const migrated = await loadSoulCard(settings)
  const prompt = await systemPromptFor(settings)

  assert.equal(migrated.text, LEGACY)
  assert.equal(migrated.target.kind, 'profile')
  assert.equal(harness.profiles.get('card-1')?.soul, LEGACY)
  assert.equal(harness.globalSoul.value, 'global-fallback-should-lose')
  assert.equal(harness.storage.get(COMPANION_SOUL_STORAGE_KEY), undefined)
  assert.match(prompt, new RegExp(LEGACY))
  assert.doesNotMatch(prompt, /global-fallback-should-lose/)
})

test('a legacy soul note is not copied over an existing persona, and is not applied later', async () => {
  const harness = install({
    panel: true,
    globalSoul: KEPT,
    legacy: LEGACY,
  })
  const settings = settingsWith({
    activeCharacterProfileId: '',
    systemPrompt: 'ENGLISH-DEFAULT-PROMPT',
  })

  const first = await loadSoulCard(settings)
  assert.equal(first.text, KEPT)
  assert.equal(harness.saves.length, 0)
  assert.equal(harness.storage.get(COMPANION_SOUL_STORAGE_KEY), undefined)

  harness.globalSoul.value = ''
  const second = await loadSoulCard(settings)
  const prompt = await systemPromptFor(settings)

  assert.equal(second.text, 'ENGLISH-DEFAULT-PROMPT')
  assert.doesNotMatch(second.text, /我是星绘/)
  assert.equal(harness.saves.length, 0)
  assert.equal(harness.globalSoul.value, '')
  assert.doesNotMatch(prompt, new RegExp(LEGACY))
  assert.doesNotMatch(prompt, new RegExp(KEPT))
})

test('a window that cannot save persona files does not write the soul card or the legacy note', async () => {
  const harness = install({
    panel: false,
    globalSoul: 'global-soul-before',
    legacy: LEGACY,
  })
  const settings = settingsWith({
    activeCharacterProfileId: '',
  })

  const saved = await saveSoulCard(settings, GLOBAL_EDIT)
  const prompt = await systemPromptFor(settings)

  assert.deepEqual(saved, { ok: false, reason: 'rejected' })
  assert.equal(harness.saves.length, 0)
  assert.equal(harness.globalSoul.value, 'global-soul-before')
  const legacyRaw = harness.storage.get(COMPANION_SOUL_STORAGE_KEY) ?? ''
  assert.match(legacyRaw, new RegExp(LEGACY))
  assert.doesNotMatch(legacyRaw, new RegExp(GLOBAL_EDIT))
  assert.match(prompt, /global-soul-before/)
  assert.doesNotMatch(prompt, new RegExp(GLOBAL_EDIT))
  assert.doesNotMatch(prompt, new RegExp(LEGACY))
})

test('a window that cannot save persona files keeps a legacy note when the target is empty', async () => {
  const harness = install({
    panel: false,
    globalSoul: '',
    legacy: LEGACY,
  })
  const settings = settingsWith({
    activeCharacterProfileId: '',
    systemPrompt: 'ENGLISH-DEFAULT-PROMPT',
  })

  const loaded = await loadSoulCard(settings)
  const prompt = await systemPromptFor(settings)

  assert.equal(loaded.text, 'ENGLISH-DEFAULT-PROMPT')
  assert.doesNotMatch(loaded.text, /我是星绘/)
  assert.match(prompt, /ENGLISH-DEFAULT-PROMPT/)
  assert.equal(harness.saves.length, 0)
  assert.equal(harness.globalSoul.value, '')
  assert.equal(harness.storage.has(COMPANION_SOUL_STORAGE_KEY), true)
  assert.doesNotMatch(prompt, new RegExp(LEGACY))
})

test('a soul save tells other windows the text changed without sending the text', async () => {
  install({
    panel: true,
    globalSoul: 'global-soul-before',
  })
  const settings = settingsWith({
    activeCharacterProfileId: '',
  })
  const received: unknown[] = []
  const channel = new BroadcastChannel(PERSONA_SOUL_SAVED_CHANNEL)
  channel.addEventListener('message', (event) => {
    received.push(event.data)
  })

  try {
    await saveSoulCard(settings, GLOBAL_EDIT)
    await new Promise((resolve) => setImmediate(resolve))
    assert.deepEqual(received, [{ saved: true }])
    assert.doesNotMatch(JSON.stringify(received), new RegExp(GLOBAL_EDIT))
  } finally {
    channel.close()
  }
})

test('an empty persona file shows the system prompt the model receives, not a translated sample', async () => {
  install({
    panel: true,
    globalSoul: '',
  })
  const settings = settingsWith({
    activeCharacterProfileId: '',
    systemPrompt: 'ENGLISH-DEFAULT-PROMPT',
  })

  const loaded = await loadSoulCard(settings)
  const prompt = await systemPromptFor(settings)

  assert.equal(loaded.text, 'ENGLISH-DEFAULT-PROMPT')
  assert.doesNotMatch(loaded.text, /我是星绘/)
  assert.match(prompt, /ENGLISH-DEFAULT-PROMPT/)
  assert.doesNotMatch(prompt, /我是星绘/)
})

test('whitespace in a persona file is the text the model receives', async () => {
  install({
    panel: true,
    globalSoul: '   ',
  })
  const settings = settingsWith({
    activeCharacterProfileId: '',
    systemPrompt: 'ENGLISH-DEFAULT-PROMPT',
  })

  const loaded = await loadSoulCard(settings)
  const prompt = await systemPromptFor(settings)

  assert.equal(loaded.text, '   ')
  // The header now opens the prompt; the whitespace-only persona text is
  // still passed through verbatim as the next section.
  assert.equal(prompt.split('\n\n')[1], '   ')
  assert.doesNotMatch(prompt, /ENGLISH-DEFAULT-PROMPT/)
})

test('an empty profile soul falls through to SOUL.md, then the system prompt', async () => {
  install({
    panel: true,
    globalSoul: '',
    profiles: { 'card-1': { present: true, soul: '' } },
  })
  const settings = settingsWith({
    activeCharacterProfileId: 'card-1',
    systemPrompt: 'ENGLISH-DEFAULT-PROMPT',
  })

  const loaded = await loadSoulCard(settings)
  assert.equal(loaded.target.kind, 'profile')
  assert.equal(loaded.text, 'ENGLISH-DEFAULT-PROMPT')

  const withGlobal = install({
    panel: true,
    globalSoul: 'global-soul-fallback',
    profiles: { 'card-1': { present: true, soul: '' } },
  })
  const again = await loadSoulCard(settings)
  assert.equal(again.text, 'global-soul-fallback')
  assert.equal(again.target.kind, 'profile')
  assert.equal(withGlobal.globalSoul.value, 'global-soul-fallback')
})

test('clearing the soul card removes the override and the model receives the system prompt again', async () => {
  const harness = install({
    panel: true,
    globalSoul: 'old-soul-override',
  })
  const settings = settingsWith({
    activeCharacterProfileId: '',
    systemPrompt: 'ENGLISH-DEFAULT-PROMPT',
  })

  const cleared = await saveSoulCard(settings, '   ')
  const prompt = await systemPromptFor(settings)

  assert.equal(cleared.ok, true)
  if (!cleared.ok) return
  assert.equal(cleared.restoredDefault, true)
  assert.equal(cleared.note.text, 'ENGLISH-DEFAULT-PROMPT')
  assert.doesNotMatch(cleared.note.text, /我是星绘/)
  assert.equal(harness.globalSoul.value, '')
  assert.deepEqual(harness.saves, [{ content: '', profileId: undefined }])
  assert.match(prompt, /ENGLISH-DEFAULT-PROMPT/)
  assert.doesNotMatch(prompt, /old-soul-override/)
})

test('a soul card over the size limit is refused and the previous persona stays', async () => {
  const harness = install({
    panel: true,
    globalSoul: 'old-soul-override',
  })
  const settings = settingsWith({
    activeCharacterProfileId: '',
    systemPrompt: 'ENGLISH-DEFAULT-PROMPT',
  })

  const refused = await saveSoulCard(settings, 'x'.repeat(PERSONA_SOUL_MAX_CHARS + 1))
  const prompt = await systemPromptFor(settings)

  assert.deepEqual(refused, { ok: false, reason: 'too-long' })
  assert.equal(harness.saves.length, 0)
  assert.equal(harness.globalSoul.value, 'old-soul-override')
  assert.match(prompt, /old-soul-override/)
})
