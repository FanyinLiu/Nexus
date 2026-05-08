import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  applyCharacterProfile,
  createCharacterProfile,
  resolveCharacterSettingsSummary,
  syncCurrentToProfile,
} from '../src/features/character/index.ts'
import { PET_MODEL_PRESETS } from '../src/features/pet/models.ts'
import type { AppSettings, CharacterProfile } from '../src/types/app.ts'

function makeSettings(overrides: Partial<AppSettings> = {}): AppSettings {
  return {
    activeCharacterProfileId: '',
    characterProfiles: [],
    companionName: '星绘',
    companionRelationshipType: 'friend',
    petModelId: 'nexus-mini',
    speechOutputApiBaseUrl: '',
    speechOutputApiKey: '',
    speechOutputInstructions: 'gentle',
    speechOutputModel: '',
    speechOutputProviderId: 'edge-tts',
    speechOutputVoice: 'zh-CN-XiaoxiaoNeural',
    systemPrompt: 'warm companion',
    userName: '主人',
    ...overrides,
  } as AppSettings
}

test('character profiles preserve user label and relationship framing', () => {
  const settings = makeSettings()
  const profile = createCharacterProfile(settings, '工作伙伴')

  assert.equal(profile.userName, '主人')
  assert.equal(profile.companionRelationshipType, 'friend')

  const switched = applyCharacterProfile(makeSettings({
    companionName: '旧名',
    companionRelationshipType: 'mentor',
    userName: 'User',
  }), {
    ...profile,
    companionName: '星绘',
    companionRelationshipType: 'quiet_companion',
    userName: '你',
  })

  assert.equal(switched.companionName, '星绘')
  assert.equal(switched.userName, '你')
  assert.equal(switched.companionRelationshipType, 'quiet_companion')
})

test('syncCurrentToProfile writes current companion identity back to the active profile', () => {
  const profile: CharacterProfile = {
    id: 'char-a',
    label: '默认',
    companionName: '旧星绘',
    companionRelationshipType: 'open_ended',
    petModelId: 'mao',
    systemPrompt: 'old',
    userName: '旧称呼',
  }

  const synced = syncCurrentToProfile(makeSettings({
    activeCharacterProfileId: 'char-a',
    characterProfiles: [profile],
    companionName: '星绘',
    companionRelationshipType: 'mentor',
    petModelId: 'nexus-mini',
    systemPrompt: 'new',
    userName: '主人',
  }))

  assert.equal(synced.characterProfiles[0]?.companionName, '星绘')
  assert.equal(synced.characterProfiles[0]?.userName, '主人')
  assert.equal(synced.characterProfiles[0]?.companionRelationshipType, 'mentor')
  assert.equal(synced.characterProfiles[0]?.petModelId, 'nexus-mini')
})

test('resolveCharacterSettingsSummary exposes compact labels for the settings page', () => {
  const summary = resolveCharacterSettingsSummary(
    makeSettings({
      activeCharacterProfileId: 'char-a',
      characterProfiles: [{
        id: 'char-a',
        label: '夜间伙伴',
        companionName: '星绘',
        petModelId: 'nexus-mini',
        systemPrompt: 'warm',
      }],
      companionName: ' 星绘 ',
      companionRelationshipType: 'quiet_companion',
      userName: ' 主人 ',
    }),
    PET_MODEL_PRESETS[0],
  )

  assert.equal(summary.activeProfileLabel, '夜间伙伴')
  assert.equal(summary.companionName, '星绘')
  assert.equal(summary.userName, '主人')
  assert.equal(summary.relationshipLabelKey, 'onboarding.companion.relationship_quiet_companion')
  assert.equal(summary.petModelLabel, 'pet.model.nexus-mini.label')
  assert.equal(summary.profileCount, 1)
})
