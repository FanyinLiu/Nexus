import assert from 'node:assert/strict'
import test from 'node:test'
import {
  companionInitiativePatch,
  desktopAwarenessPatch,
  inferCompanionInitiative,
  keepTalkingPatch,
  lookupPatch,
  quietHoursPatch,
  sharedLookup,
  unifiedQuietHours,
  voiceLanguagesAfterSettingsOpen,
} from '../src/features/settingsSimplify/index.ts'

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
  assert.equal(companionInitiativePatch('often').autonomyEnabled, true)
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
