import assert from 'node:assert/strict'
import { test } from 'node:test'

import { ensureLocaleLoaded } from '../src/i18n/runtime.ts'
import { resolveCompanionAwarenessRuntime } from '../src/features/context/companionAwarenessRuntime.ts'

await Promise.all([
  ensureLocaleLoaded('en-US'),
  ensureLocaleLoaded('zh-CN'),
])

test('companion awareness runtime records active chat as the local check-in guard', () => {
  const state = resolveCompanionAwarenessRuntime({
    contextAwarenessEnabled: true,
    companionAwarenessPaused: false,
    activeWindowContextEnabled: true,
    isActiveChatSession: true,
    nexusOpenSince: '2026-06-21T17:00:00.000Z',
    lastNexusInteractionAt: '2026-06-21T17:00:00.000Z',
    now: '2026-06-21T19:00:00.000Z',
    activeWindowTitle: 'Secret Client Plan - Chrome',
    uiLanguage: 'en-US',
  })
  const payload = JSON.stringify(state)

  assert.equal(state.summary?.elapsedBucket, 'two_hours_or_more')
  assert.equal(state.summary?.activityClass, 'browsing')
  assert.equal(state.checkInDecision.shouldCheckIn, false)
  assert.equal(state.checkInDecision.reason, 'active_chat')
  assert.equal(state.checkInDecision.surface, 'none')
  assert.equal(state.checkInDecision.priority, 'none')
  assert.match(state.promptText, /couple of hours or more/)
  assert.match(state.promptText, /browsing/)
  assert.doesNotMatch(payload, /Secret Client Plan/)
  assert.doesNotMatch(payload, /Chrome/)
})

test('companion awareness runtime disables check-in decisions without active-window awareness', () => {
  const state = resolveCompanionAwarenessRuntime({
    contextAwarenessEnabled: true,
    companionAwarenessPaused: false,
    activeWindowContextEnabled: false,
    isActiveChatSession: false,
    nexusOpenSince: '2026-06-21T17:00:00.000Z',
    lastNexusInteractionAt: '2026-06-21T17:00:00.000Z',
    now: '2026-06-21T19:00:00.000Z',
    activeWindowTitle: 'main.ts - Visual Studio Code',
    uiLanguage: 'en-US',
  })

  assert.equal(state.summary, null)
  assert.equal(state.promptText, '')
  assert.equal(state.checkInDecision.shouldCheckIn, false)
  assert.equal(state.checkInDecision.reason, 'disabled')
})

test('companion awareness runtime can produce eligible local check-ins from coarse segments only', () => {
  const state = resolveCompanionAwarenessRuntime({
    contextAwarenessEnabled: true,
    companionAwarenessPaused: false,
    activeWindowContextEnabled: true,
    isActiveChatSession: false,
    nexusOpenSince: '2026-06-21T17:00:00.000Z',
    lastNexusInteractionAt: '2026-06-21T17:00:00.000Z',
    now: '2026-06-21T18:00:00.000Z',
    activeWindowTitle: 'Private Research Thread - Chrome',
    uiLanguage: 'en-US',
  })
  const payload = JSON.stringify(state)

  assert.equal(state.summary?.elapsedBucket, 'about_hour')
  assert.equal(state.summary?.activityClass, 'browsing')
  assert.equal(state.checkInDecision.shouldCheckIn, true)
  assert.equal(state.checkInDecision.reason, 'long_continuous_activity')
  assert.equal(state.checkInDecision.surface, 'in_app')
  assert.equal(state.checkInDecision.priority, 'low')
  assert.equal(state.checkInDecision.signalKey, 'long_continuous_activity:browsing-about_hour')
  assert.doesNotMatch(state.checkInDecision.signalKey ?? '', /Private|Research|Chrome/)
  assert.doesNotMatch(payload, /Private Research Thread/)
})
