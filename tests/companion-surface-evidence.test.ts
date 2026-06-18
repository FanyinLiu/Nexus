import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  buildCompanionSurfaceEvidenceReport,
  type CompanionSurfaceEvidenceSettings,
} from '../src/features/stabilization/companionSurfaceEvidence.ts'
import { getPetModelPreset } from '../src/features/pet/models.ts'

function makeSettings(
  overrides: Partial<CompanionSurfaceEvidenceSettings> = {},
): CompanionSurfaceEvidenceSettings {
  return {
    activeCharacterProfileId: '',
    characterProfiles: [],
    petActionMapOverrides: {},
    petModelId: 'mao',
    profilePersonaInChatEnabled: false,
    speechOutputInstructions: '',
    speechOutputModel: '',
    speechOutputProviderId: 'edge-tts',
    speechOutputVoice: 'zh-CN-XiaoxiaoNeural',
    ...overrides,
  }
}

test('companion surface evidence summarizes Live2D and role package readiness without private profile payloads', () => {
  const report = buildCompanionSurfaceEvidenceReport(makeSettings({
    activeCharacterProfileId: 'secret-profile',
    characterProfiles: [{
      id: 'secret-profile',
      label: 'secret profile label',
      companionName: 'secret companion',
      userName: 'secret user',
      companionRelationshipType: 'mentor',
      systemPrompt: 'secret system prompt',
      petModelId: 'mao',
      speechOutputProviderId: 'local-tts',
      speechOutputVoice: 'secret voice id',
      speechOutputModel: 'secret voice model',
      speechOutputInstructions: 'secret voice instructions',
    }],
    petActionMapOverrides: {
      mao: {
        gestures: {
          wave: 'secret-wave-motion',
        },
      },
    },
    profilePersonaInChatEnabled: true,
    speechOutputProviderId: 'volcengine-tts',
    speechOutputVoice: 'fallback secret voice',
  }), getPetModelPreset('mao'), { generatedAt: '2026-06-17T10:00:00Z' })
  const json = JSON.stringify(report)

  assert.equal(report.gate, 'companion-surface-observability')
  assert.equal(report.generatedAt, '2026-06-17T10:00:00.000Z')
  assert.deepEqual(report.checks.map((check) => [check.id, check.pass]), [
    ['has-pet-model', true],
    ['has-action-map-coverage', true],
    ['has-action-map-editor-targets', true],
    ['has-character-profiles', true],
    ['has-active-profile-preset', true],
    ['has-keyless-voice-preset', true],
  ])
  assert.equal(report.petModel.kind, 'live2d')
  assert.equal(report.actionMap.coverage, 1)
  assert.equal(report.actionMap.presenceStates, 7)
  assert.equal(report.actionMap.mappedPresenceStates, 7)
  assert.equal(report.actionMap.activeModelHasOverride, true)
  assert.equal(report.characterProfiles.total, 1)
  assert.equal(report.characterProfiles.hasActiveProfile, true)
  assert.equal(report.characterProfiles.profilesWithPetPreset, 1)
  assert.equal(report.characterProfiles.profilesWithVoicePreset, 1)
  assert.equal(report.characterProfiles.profilesWithInstructions, 1)
  assert.equal(report.voicePreset.activeUsesKeylessOrLocalProvider, true)
  assert.equal(json.includes('secret-profile'), false)
  assert.equal(json.includes('secret profile label'), false)
  assert.equal(json.includes('secret companion'), false)
  assert.equal(json.includes('secret system prompt'), false)
  assert.equal(json.includes('secret voice id'), false)
  assert.equal(json.includes('secret voice instructions'), false)
  assert.equal(json.includes('secret-wave-motion'), false)
})

test('companion surface evidence keeps missing model and profile evidence explicit', () => {
  const report = buildCompanionSurfaceEvidenceReport(makeSettings({
    petModelId: '',
    speechOutputProviderId: '',
    speechOutputVoice: '',
  }), undefined, { generatedAt: 'bad-date' })

  assert.equal(Number.isFinite(Date.parse(report.generatedAt)), true)
  assert.equal(report.petModel.present, false)
  assert.equal(report.petModel.kind, 'missing')
  assert.equal(report.actionMap.coverage, 0)
  assert.equal(report.characterProfiles.total, 0)
  assert.equal(report.voicePreset.activeUsesKeylessOrLocalProvider, false)
  assert.equal(report.checks.find((check) => check.id === 'has-pet-model')?.pass, false)
  assert.equal(report.checks.find((check) => check.id === 'has-character-profiles')?.pass, false)
  assert.equal(report.checks.find((check) => check.id === 'has-keyless-voice-preset')?.pass, false)
  assert.equal(report.qualityIssues.some((issue) => issue.id === 'missing-pet-model'), true)
  assert.equal(report.qualityIssues.some((issue) => issue.id === 'no-character-profiles'), true)
})
