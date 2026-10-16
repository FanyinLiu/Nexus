import assert from 'node:assert/strict'
import { beforeEach, test } from 'node:test'

import {
  PROACTIVE_HARD_CAP,
  PROACTIVE_MIN_GAP_MS,
  PROACTIVE_RESUME_GRACE_MS,
  evaluateProactiveEtiquette,
  isLikelyFullscreenSurface,
  isQuietHour,
  proactiveDailyCap,
  type ProactiveEtiquetteInput,
} from '../src/features/autonomy/proactiveBudget.ts'
import { isUserTyping, noteUserTyping } from '../src/features/autonomy/userTyping.ts'
import { loadSettings, SETTINGS_STORAGE_KEY } from '../src/lib/storage.ts'
import { CURRENT_SETTINGS_SCHEMA_VERSION } from '../src/lib/settingsMigrations.ts'

function atLocal(year: number, month: number, day: number, hour: number, minute = 0): number {
  return new Date(year, month - 1, day, hour, minute, 0, 0).getTime()
}

const NOW = atLocal(2026, 10, 15, 12)

function input(patch: Partial<ProactiveEtiquetteInput> = {}): ProactiveEtiquetteInput {
  return {
    nowMs: NOW,
    enabled: true,
    preset: 'normal',
    quietStart: 23,
    quietEnd: 8,
    firedAt: [],
    userTyping: false,
    fullscreen: false,
    focusState: 'active',
    channel: 'next_turn',
    ...patch,
  }
}

beforeEach(() => {
  noteUserTyping(0)
  const store = new Map<string, string>()
  Object.defineProperty(globalThis, 'window', {
    value: {
      localStorage: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => { store.set(key, String(value)) },
        removeItem: (key: string) => { store.delete(key) },
      },
    },
    configurable: true,
    writable: true,
  })
})

test('quiet hours wrap midnight and equal bounds turn the window off', () => {
  assert.equal(isQuietHour(23, 23, 8), true)
  assert.equal(isQuietHour(7, 23, 8), true)
  assert.equal(isQuietHour(8, 23, 8), false)
  assert.equal(isQuietHour(22, 23, 8), false)
  assert.equal(isQuietHour(12, 23, 23), false)
})

test('the hard cap is 3 and the low preset is 1', () => {
  assert.equal(PROACTIVE_HARD_CAP, 3)
  assert.equal(proactiveDailyCap('normal'), 3)
  assert.equal(proactiveDailyCap('low'), 1)
})

test('delivery stops at the daily cap, the 90 minute gap, and quiet hours', () => {
  const today = [atLocal(2026, 10, 15, 9), atLocal(2026, 10, 15, 10, 30)]
  const yesterday = atLocal(2026, 10, 14, 12)
  assert.equal(evaluateProactiveEtiquette(input({ firedAt: [...today, yesterday] })).reason, 'ok')
  assert.equal(evaluateProactiveEtiquette(input({
    firedAt: [...today, atLocal(2026, 10, 15, 12)],
  })).reason, 'daily-cap')
  assert.equal(evaluateProactiveEtiquette(input({
    preset: 'low',
    firedAt: [atLocal(2026, 10, 15, 9)],
  })).reason, 'daily-cap')

  const recent = NOW - PROACTIVE_MIN_GAP_MS + 60_000
  assert.equal(evaluateProactiveEtiquette(input({ firedAt: [recent] })).reason, 'gap')
  assert.equal(evaluateProactiveEtiquette(input({
    firedAt: [NOW - PROACTIVE_MIN_GAP_MS],
  })).reason, 'ok')

  assert.equal(evaluateProactiveEtiquette(input({ nowMs: atLocal(2026, 10, 15, 23, 30) })).reason, 'quiet-hours')
  assert.equal(evaluateProactiveEtiquette(input({ nowMs: atLocal(2026, 10, 15, 7, 30) })).reason, 'quiet-hours')
  assert.equal(evaluateProactiveEtiquette(input({ nowMs: atLocal(2026, 10, 15, 8, 5) })).reason, 'ok')
})

test('typing, fullscreen, and being away block both channels', () => {
  assert.equal(evaluateProactiveEtiquette(input({ userTyping: true })).reason, 'typing')
  assert.equal(evaluateProactiveEtiquette(input({ fullscreen: true, channel: 'return', resumedAtMs: NOW - PROACTIVE_RESUME_GRACE_MS })).reason, 'fullscreen')
  assert.equal(evaluateProactiveEtiquette(input({ focusState: 'away' })).reason, 'away')
  assert.equal(evaluateProactiveEtiquette(input({ focusState: 'locked', channel: 'return' })).reason, 'away')
  assert.equal(isLikelyFullscreenSurface('Game', 'Fullscreen Player'), true)
  assert.equal(isLikelyFullscreenSurface('全屏笔记', null), true)
  assert.equal(isLikelyFullscreenSurface('전체 화면', 'game'), true)
  assert.equal(isLikelyFullscreenSurface('Notes', 'TextEdit'), false)
})

test('a return bubble waits until the user is back and the resume grace has passed', () => {
  assert.equal(evaluateProactiveEtiquette(input({
    channel: 'return',
    focusState: 'idle',
  })).reason, 'not-back')
  assert.equal(evaluateProactiveEtiquette(input({
    channel: 'return',
    resumedAtMs: NOW - 5_000,
  })).reason, 'resume-grace')
  assert.equal(evaluateProactiveEtiquette(input({
    channel: 'return',
    resumedAtMs: NOW - PROACTIVE_RESUME_GRACE_MS,
  })).reason, 'ok')
  assert.equal(evaluateProactiveEtiquette(input({
    channel: 'return',
    resumedAtMs: NOW,
    resumeGraceMs: 0,
  })).reason, 'ok')
  assert.equal(evaluateProactiveEtiquette(input({ enabled: false })).reason, 'disabled')
})

test('typing state expires and does not stick across later checks', () => {
  noteUserTyping(1_000)
  assert.equal(isUserTyping(1_000 + 1_000), true)
  assert.equal(isUserTyping(1_000 + 2_500), false)
  noteUserTyping(0)
})

test('proactive settings default on, and bad stored values fall back', () => {
  const fresh = loadSettings()
  assert.equal(fresh.proactiveAgendaEnabled, true)
  assert.equal(fresh.proactiveFrequency, 'normal')
  assert.equal(fresh.proactiveQuietHoursStart, 23)
  assert.equal(fresh.proactiveQuietHoursEnd, 8)

  window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({
    settingsSchemaVersion: CURRENT_SETTINGS_SCHEMA_VERSION,
    proactiveAgendaEnabled: false,
    proactiveFrequency: 'often',
    proactiveQuietHoursStart: 99,
    proactiveQuietHoursEnd: -3,
  }))
  const loaded = loadSettings()
  assert.equal(loaded.proactiveAgendaEnabled, false)
  assert.equal(loaded.proactiveFrequency, 'normal')
  assert.equal(loaded.proactiveQuietHoursStart, 23)
  assert.equal(loaded.proactiveQuietHoursEnd, 0)
})
