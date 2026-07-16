import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

import {
  buildSettingsSavePayload,
  ensureDraftPetModelPreset,
  mergeHydratedSettingsSecrets,
} from '../src/components/settingsDrawerHooks/settingsDraftModel.ts'
import type { AppSettings } from '../src/types/index.ts'

function makeSettings(overrides: Partial<AppSettings> = {}): AppSettings {
  return {
    themeId: 'nexus-default',
    petModelId: 'mao',
    proactivePresenceIntervalMinutes: 25,
    apiKey: '',
    speechInputApiKey: '',
    speechOutputApiKey: '',
    toolWebSearchApiKey: '',
    screenVlmApiKey: '',
    telegramBotToken: '',
    discordBotToken: '',
    ...overrides,
  } as AppSettings
}

test('settings save payload clamps the proactive-presence interval', () => {
  const payload = buildSettingsSavePayload(makeSettings({
    proactivePresenceIntervalMinutes: 999,
  }))

  assert.equal(payload.proactivePresenceIntervalMinutes, 120)
})

test('vault hydration fills only blank draft secrets', () => {
  const current = makeSettings({
    apiKey: '',
    speechInputApiKey: 'draft-stt',
    toolWebSearchApiKey: '',
  })
  const incoming = makeSettings({
    apiKey: 'hydrated-text',
    speechInputApiKey: 'hydrated-stt',
    toolWebSearchApiKey: 'hydrated-search',
  })

  const merged = mergeHydratedSettingsSecrets(current, incoming)

  assert.equal(merged.apiKey, 'hydrated-text')
  assert.equal(merged.speechInputApiKey, 'draft-stt')
  assert.equal(merged.toolWebSearchApiKey, 'hydrated-search')
  assert.equal(
    mergeHydratedSettingsSecrets(makeSettings({ apiKey: 'draft' }), incoming).apiKey,
    'draft',
  )
})

test('invalid pet model drafts fall back to an available preset', () => {
  const repaired = ensureDraftPetModelPreset(
    makeSettings({ petModelId: 'missing' }),
    [{ id: 'mao' }, { id: 'xinghui' }],
  )

  assert.equal(repaired.petModelId, 'mao')
  assert.equal(
    ensureDraftPetModelPreset(
      makeSettings({ petModelId: 'xinghui' }),
      [{ id: 'mao' }, { id: 'xinghui' }],
    ).petModelId,
    'xinghui',
  )
})

test('SettingsDrawer delegates draft normalization to useSettingsDraftState', async () => {
  const drawerSource = await readFile(
    new URL('../src/components/SettingsDrawer.tsx', import.meta.url),
    'utf8',
  )
  const draftStateSource = await readFile(
    new URL('../src/components/settingsDrawerHooks/useSettingsDraftState.ts', import.meta.url),
    'utf8',
  )

  assert.match(drawerSource, /useSettingsDraftState\(settings\)/)
  assert.match(drawerSource, /createSavePayload/)
  assert.match(drawerSource, /mergeHydratedSecrets\(settings\)/)
  assert.match(drawerSource, /ensurePetModelPreset\(petModelPresets\)/)
  assert.match(draftStateSource, /return \{[\s\S]*baseline,/)
  assert.match(drawerSource, /onSave: \(settings: AppSettings, baseline: AppSettings\) => Promise<void>/)
  assert.match(drawerSource, /committed: baseline,[\s\S]*onSave: \(nextDraft\) => onSave\(nextDraft, baseline\)/)
  assert.equal(drawerSource.includes('clampPresenceIntervalMinutes'), false)
})
