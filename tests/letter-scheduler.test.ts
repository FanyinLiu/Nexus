import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  decideLetter,
  resolveLetterSlot,
  type LetterDecisionInput,
} from '../src/features/letter/letterScheduler.ts'
import { localDayKey } from '../src/lib/localDate.ts'
import { getDefaultSystemPrompt } from '../src/lib/settingsMigrations.ts'
import { resolveActivePersona } from '../src/features/persona/resolveActivePersona.ts'
import { buildLetterPrompt } from '../src/features/letter/letterPromptBuilder.ts'

const SUN_19 = new Date('2026-04-26T19:00:00').getTime() // Sunday 7pm local
const SUN_10 = new Date('2026-04-26T10:00:00').getTime() // Sunday 10am
const SUN_23 = new Date('2026-04-26T23:00:00').getTime()
const SAT_19 = new Date('2026-04-25T19:00:00').getTime()
const MON_09 = new Date('2026-04-27T09:00:00').getTime()
const WED_10 = new Date('2026-05-13T10:00:00').getTime()
const SUN_DATE = localDayKey(SUN_19)
const PREV_SUN_DATE = localDayKey(new Date('2026-04-19T19:00:00').getTime())

function base(overrides: Partial<LetterDecisionInput> = {}): LetterDecisionInput {
  return {
    enabled: true,
    nowMs: SUN_19,
    lastLetterDate: null,
    relationshipType: 'friend',
    ...overrides,
  }
}

test('fires on Sunday evening with the Sunday slot date', () => {
  const r = decideLetter(base())
  assert.equal(r.shouldFire, true)
  if (r.shouldFire !== true) return
  assert.equal(r.reason, 'fire')
  assert.equal(r.letterDate, SUN_DATE)
  assert.equal(r.catchUp, false)
})

test('does not fire when disabled', () => {
  const r = decideLetter(base({ enabled: false }))
  assert.equal(r.shouldFire, false)
  assert.equal(r.reason, 'disabled')
})

test('quiet_companion opts out', () => {
  const r = decideLetter(base({ relationshipType: 'quiet_companion' }))
  assert.equal(r.shouldFire, false)
  assert.equal(r.reason, 'relationship_type_opted_out')
})

test('memory pause skips without consuming the week', () => {
  const paused = decideLetter(base({ memoryPaused: true }))
  assert.equal(paused.shouldFire, false)
  assert.equal(paused.reason, 'memory_paused')
  // Same store state, memory resumed: the same week is still available.
  assert.equal(decideLetter(base({ memoryPaused: false })).shouldFire, true)
})

test('Sunday morning stays quiet so the same day cannot deliver twice', () => {
  const r = decideLetter(base({ nowMs: SUN_10 }))
  assert.equal(r.shouldFire, false)
  assert.equal(r.reason, 'outside_window')
})

test('Sunday after the window still delivers that evening slot', () => {
  const r = decideLetter(base({ nowMs: SUN_23 }))
  assert.equal(r.shouldFire, true)
  if (r.shouldFire !== true) return
  assert.equal(r.letterDate, SUN_DATE)
})

test('Saturday delivers the latest missed Sunday only', () => {
  const r = decideLetter(base({ nowMs: SAT_19 }))
  assert.equal(r.shouldFire, true)
  if (r.shouldFire !== true) return
  assert.equal(r.letterDate, PREV_SUN_DATE)
  assert.equal(r.catchUp, true)
})

test('does not fire twice for the same Sunday week', () => {
  assert.equal(decideLetter(base({ lastLetterDate: SUN_DATE })).shouldFire, false)
  const monday = decideLetter(base({ nowMs: MON_09, lastLetterDate: SUN_DATE }))
  assert.equal(monday.shouldFire, false)
  assert.equal(monday.shouldFire === false && monday.reason, 'already_fired_this_week')
})

test('next open after a missed Sunday delivers that letter once', () => {
  const r = decideLetter(base({ nowMs: MON_09, lastLetterDate: PREV_SUN_DATE }))
  assert.equal(r.shouldFire, true)
  if (r.shouldFire !== true) return
  assert.equal(r.letterDate, SUN_DATE)
  assert.equal(r.catchUp, true)
})

test('multiple missed weeks produce one letter for the latest Sunday', () => {
  const oldLetter = localDayKey(new Date('2026-04-19T19:00:00').getTime())
  const r = decideLetter(base({ nowMs: WED_10, lastLetterDate: oldLetter }))
  assert.equal(r.shouldFire, true)
  if (r.shouldFire !== true) return
  assert.equal(r.letterDate, localDayKey(new Date('2026-05-10T18:00:00').getTime()))
  assert.equal(r.catchUp, true)
})

test('respects a custom Sunday start hour', () => {
  const sun9pm = new Date('2026-04-26T21:00:00').getTime()
  assert.equal(decideLetter(base({
    nowMs: sun9pm,
    window: { startHour: 22 },
  })).shouldFire, false)
  assert.equal(decideLetter(base({
    nowMs: sun9pm,
    window: { startHour: 20 },
  })).shouldFire, true)
})

test('resolveLetterSlot returns the latest due Sunday evening', () => {
  assert.equal(resolveLetterSlot(SUN_10), null)
  const sunday = resolveLetterSlot(SUN_19)
  assert.ok(sunday)
  assert.equal(sunday?.letterDate, SUN_DATE)
  assert.equal(sunday?.catchUp, false)
  const monday = resolveLetterSlot(MON_09)
  assert.ok(monday)
  assert.equal(monday?.letterDate, SUN_DATE)
  assert.equal(monday?.catchUp, true)
})

test('a default install hands the letter a real persona, not an empty soul', async () => {
  const persona = await resolveActivePersona({
    activeCharacterProfileId: '',
    systemPrompt: getDefaultSystemPrompt('zh-CN'),
    uiLanguage: 'zh-CN',
    companionName: '星绘',
    userName: '主人',
  }, { bridge: {} })

  assert.equal(persona.present, true)
  assert.ok(persona.soul.trim().length > 0)

  const messages = buildLetterPrompt({
    persona,
    data: {
      shouldFire: true,
      themes: [],
      highlights: [],
      stressors: [],
      reflectionLines: [],
      diaryLines: [],
      milestonesNotedThisWeek: [],
      weekDayCount: 3,
    },
    uiLanguage: 'zh-CN',
    letterDate: SUN_DATE,
  })
  assert.ok(messages[0].content.includes(persona.soul))
})
