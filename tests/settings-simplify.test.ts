import assert from 'node:assert/strict'
import test from 'node:test'
import {
  companionInitiativePatch,
  desktopAwarenessPatch,
  endpointEditorPlacement,
  inferCompanionInitiative,
  keepTalkingPatch,
  lookupPatch,
  quietHoursPatch,
  sharedLookup,
  showsVoiceWakeWord,
  unifiedQuietHours,
  voiceLanguagesAfterSettingsOpen,
  voiceTriggerPatch,
  weatherCityPlacement,
  VOICE_TRIGGER_MODES,
} from '../src/features/settingsSimplify/index.ts'
import { API_PROVIDER_PRESETS } from '../src/features/models/providerCatalog.ts'
import type { VoiceTriggerMode } from '../src/types/voice.ts'

const factory = {
  autonomyEnabled: false,
  proactivePresenceEnabled: false,
  proactivePresenceIntervalMinutes: 25,
  proactiveAwayNotificationsEnabled: false,
  proactiveBracketEnabled: false,
  proactiveLetterEnabled: false,
}

test('factory switches read as quiet and reading does not write', () => {
  const stored = { ...factory }
  assert.equal(inferCompanionInitiative(stored), 'quiet')
  assert.deepEqual(stored, factory)
})

test('sometimes and often match only their own switches', () => {
  assert.equal(inferCompanionInitiative({
    ...factory,
    ...companionInitiativePatch('sometimes'),
  }), 'sometimes')
  assert.equal(inferCompanionInitiative({
    ...factory,
    ...companionInitiativePatch('often'),
  }), 'often')
  assert.equal(companionInitiativePatch('sometimes').autonomyEnabled, false)
  const often = companionInitiativePatch('often')
  assert.equal(often.autonomyEnabled, true)
  assert.equal(often.proactivePresenceEnabled, true)
  assert.equal(often.proactiveAwayNotificationsEnabled, true)
  assert.equal(often.proactiveLetterEnabled, true)
  assert.equal(often.proactiveFrequency, 'normal')
  assert.equal('proactiveAgendaEnabled' in often, false)
  assert.equal(inferCompanionInitiative({ ...factory, ...often, autonomyEnabled: false }), 'often')
  assert.equal(inferCompanionInitiative({ ...factory, ...often, proactiveFrequency: 'low' }), 'custom')
})

test('often turns the autonomy tick on', () => {
  const often = companionInitiativePatch('often')
  assert.equal(often.autonomyEnabled, true)
  assert.equal(inferCompanionInitiative({ ...factory, ...often }), 'often')
  assert.equal(companionInitiativePatch('sometimes').autonomyEnabled, false)
  assert.equal(companionInitiativePatch('quiet').autonomyEnabled, false)
})

test('a pace that does not match stays custom and the patch leaves unfinished items alone', () => {
  const custom = {
    ...factory,
    proactivePresenceEnabled: true,
    proactivePresenceIntervalMinutes: 10,
  }
  assert.equal(inferCompanionInitiative(custom), 'custom')
  const quiet = companionInitiativePatch('quiet')
  assert.equal('proactiveAgendaEnabled' in quiet, false)
})

test('quiet hours stay split when the two pairs were customized differently', () => {
  assert.equal(unifiedQuietHours({ start: 22, end: 7 }, { start: 23, end: 8 }), null)
  assert.deepEqual(unifiedQuietHours({ start: 23, end: 7 }, { start: 23, end: 8 }), { start: 23, end: 8 })
  assert.deepEqual(unifiedQuietHours({ start: 22, end: 6 }, { start: 22, end: 6 }), { start: 22, end: 6 })
  const written = quietHoursPatch({ start: 22, end: 6 })
  assert.equal(written.autonomyQuietHoursEnd, 6)
  assert.equal(written.proactiveQuietHoursEnd, 6)
})

test('search and weather are not flipped together when they disagree', () => {
  assert.equal(sharedLookup(true, false), null)
  assert.equal(sharedLookup(false, false), false)
  assert.deepEqual(lookupPatch(true), {
    toolWebSearchEnabled: true,
    toolWeatherEnabled: true,
  })
})

test('the weather city has one editor for every switch combination', () => {
  assert.equal(weatherCityPlacement(true, true), 'simple')
  assert.equal(weatherCityPlacement(false, true), 'advanced')
  assert.equal(weatherCityPlacement(true, false), null)
  assert.equal(weatherCityPlacement(false, false), null)
  assert.equal(sharedLookup(true, true), true)
})

test('every service keeps exactly one place to edit its address', () => {
  assert.equal(endpointEditorPlacement('custom'), 'simple')
  assert.equal(endpointEditorPlacement('openai'), 'advanced')
  assert.equal(endpointEditorPlacement('anthropic'), 'advanced')
  assert.equal(endpointEditorPlacement('ollama'), 'advanced')
  for (const provider of API_PROVIDER_PRESETS) {
    const placement = endpointEditorPlacement(provider.id)
    assert.equal(
      placement === 'simple' || placement === 'advanced',
      true,
      `${provider.id} needs one address editor`,
    )
  }
})

test('desktop awareness turns on the window title only when every source is off', () => {
  assert.deepEqual(desktopAwarenessPatch(true, {
    activeWindowContextEnabled: false,
    clipboardContextEnabled: false,
    screenContextEnabled: false,
  }), {
    contextAwarenessEnabled: true,
    activeWindowContextEnabled: true,
  })
  assert.deepEqual(desktopAwarenessPatch(false, {
    activeWindowContextEnabled: true,
    clipboardContextEnabled: true,
    screenContextEnabled: false,
  }), { contextAwarenessEnabled: false })
})

test('keep talking turns detection on, and off leaves detection stored', () => {
  assert.equal(keepTalkingPatch(true).voiceActivityDetectionEnabled, true)
  assert.deepEqual(keepTalkingPatch(false), { continuousVoiceModeEnabled: false })
})

test('opening settings does not rewrite a customized speech language', () => {
  const customized = voiceLanguagesAfterSettingsOpen({
    uiLanguage: 'zh-CN',
    speechRecognitionLang: 'ja-JP',
    speechSynthesisLang: 'en-US',
  })
  assert.equal(customized.speechRecognitionLang, 'ja-JP')
  assert.equal(customized.speechSynthesisLang, 'en-US')
})

test('the trigger mode can go back to manual confirm and keeps the wake word', () => {
  const manual = voiceTriggerPatch('manual_confirm', {
    voiceTriggerMode: 'wake_word',
    wakeWord: '小N',
    wakeWordEnabled: true,
    companionName: 'Nexus',
  })
  assert.equal(manual.voiceTriggerMode, 'manual_confirm')
  assert.equal(manual.wakeWordEnabled, false)
  assert.equal(manual.wakeWord, '小N')
})

test('an empty wake word is filled in when the wake word mode is picked', () => {
  const wake = voiceTriggerPatch('wake_word', {
    voiceTriggerMode: 'direct_send',
    wakeWord: '',
    wakeWordEnabled: false,
    companionName: 'Nexus',
  })
  assert.equal(wake.voiceTriggerMode, 'wake_word')
  assert.equal(wake.wakeWordEnabled, true)
  assert.equal(wake.wakeWord, 'Nexus')
})

test('every trigger mode stays selectable in the advanced section', () => {
  assert.deepEqual([...VOICE_TRIGGER_MODES], ['direct_send', 'wake_word', 'manual_confirm'])
  assert.equal(showsVoiceWakeWord('rest', 'wake_word'), false)
  assert.equal(showsVoiceWakeWord('full', 'wake_word'), true)
  assert.equal(showsVoiceWakeWord('rest', 'direct_send'), false)
})

test('the trigger mode survives a round trip through every mode', () => {
  let draft: {
    voiceTriggerMode: VoiceTriggerMode
    wakeWord: string
    wakeWordEnabled: boolean
    companionName: string
  } = {
    voiceTriggerMode: 'direct_send',
    wakeWord: '小N',
    wakeWordEnabled: false,
    companionName: 'Nexus',
  }
  for (const mode of ['manual_confirm', 'direct_send', 'manual_confirm'] as const) {
    draft = { ...draft, ...voiceTriggerPatch(mode, draft) }
    assert.equal(draft.voiceTriggerMode, mode)
    assert.equal(draft.wakeWordEnabled, mode === 'wake_word')
    assert.equal(draft.wakeWord, '小N')
  }
})
