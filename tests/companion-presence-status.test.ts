import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  resolveCompanionPresenceStatus,
  type CompanionPresenceStatusInput,
} from '../src/features/presence/companionPresenceStatus.ts'
import type { TranslationKey } from '../src/types/index.ts'

function ti(key: TranslationKey, params?: Record<string, string | number>): string {
  if (key === 'panel.status.quiet_locked_reason') return 'screen is locked'
  if (key === 'panel.status.quiet_hours_reason') return 'quiet hours are active'
  if (key === 'panel.status.quiet_with_reason') return `quiet: ${params?.reason ?? ''}`
  return key
}

function resolve(patch: Partial<CompanionPresenceStatusInput> = {}) {
  return resolveCompanionPresenceStatus({
    assistantActivity: 'idle',
    chatBusy: false,
    focusState: 'active',
    now: new Date('2026-06-17T14:00:00'),
    quietHoursEnd: 8,
    quietHoursStart: 23,
    voiceState: 'idle',
    ...patch,
  }, ti)
}

test('resolveCompanionPresenceStatus reports the resting baseline', () => {
  const status = resolve()

  assert.equal(status.state, 'resting')
  assert.equal(status.statusLabelKey, 'panel.status.resting')
  assert.equal(status.chipLabel, 'panel.chip.resting')
  assert.equal(status.quietReason, null)
})

test('resolveCompanionPresenceStatus treats omitted assistant activity as idle', () => {
  const status = resolveCompanionPresenceStatus({
    chatBusy: false,
    focusState: 'active',
    voiceState: 'idle',
  }, ti)

  assert.equal(status.state, 'resting')
  assert.equal(status.statusLabelKey, 'panel.status.resting')
})

test('resolveCompanionPresenceStatus prioritizes voice states over quiet gates', () => {
  const status = resolve({
    focusState: 'locked',
    now: new Date('2026-06-17T23:30:00'),
    voiceState: 'speaking',
  })

  assert.equal(status.state, 'speaking')
  assert.equal(status.statusLabelKey, 'panel.status.speaking')
  assert.equal(status.quietReason, null)
})

test('resolveCompanionPresenceStatus maps background work to thinking', () => {
  const status = resolve({ assistantActivity: 'searching' })

  assert.equal(status.state, 'thinking')
  assert.equal(status.statusLabelKey, 'panel.status.searching')
  assert.equal(status.chipLabel, 'panel.chip.thinking')
})

test('resolveCompanionPresenceStatus surfaces explicit quiet reasons', () => {
  const status = resolve({
    focusState: 'away',
    quietReason: 'manual quiet mode',
  })

  assert.equal(status.state, 'quiet')
  assert.equal(status.statusLabel, 'quiet: manual quiet mode')
  assert.equal(status.quietReason, 'manual quiet mode')
})

test('resolveCompanionPresenceStatus explains locked-screen silence', () => {
  const status = resolve({ focusState: 'locked' })

  assert.equal(status.state, 'quiet')
  assert.equal(status.statusLabel, 'quiet: screen is locked')
  assert.equal(status.quietReason, 'screen is locked')
})

test('resolveCompanionPresenceStatus explains quiet-hours silence', () => {
  const status = resolve({ now: new Date('2026-06-17T23:30:00') })

  assert.equal(status.state, 'quiet')
  assert.equal(status.statusLabel, 'quiet: quiet hours are active')
  assert.equal(status.quietReason, 'quiet hours are active')
})

test('resolveCompanionPresenceStatus reports away after active work is clear', () => {
  const status = resolve({ focusState: 'away' })

  assert.equal(status.state, 'away')
  assert.equal(status.statusLabelKey, 'panel.status.away')
  assert.equal(status.chipLabel, 'panel.chip.away')
})
