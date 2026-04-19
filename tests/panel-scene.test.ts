import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  normalizePanelSceneMode,
  pickSceneByHour,
  resolveActivePanelScene,
} from '../src/features/panelScene/resolver.ts'

test('pickSceneByHour covers all 24 hours without gaps', () => {
  const seen = new Set<string>()
  for (let hour = 0; hour < 24; hour += 1) {
    seen.add(pickSceneByHour(hour))
  }
  // Must only produce valid scene ids.
  for (const id of seen) {
    assert.ok(['morning', 'noon', 'afternoon', 'dusk', 'night'].includes(id), `unexpected id ${id}`)
  }
  // Should produce at least three distinct scenes over 24 hours (sanity).
  assert.ok(seen.size >= 3, 'pickSceneByHour is suspiciously flat across the day')
})

test('pickSceneByHour matches greeting buckets at boundary hours', () => {
  assert.equal(pickSceneByHour(5), 'morning')
  assert.equal(pickSceneByHour(9), 'morning')
  assert.equal(pickSceneByHour(10), 'noon')
  assert.equal(pickSceneByHour(13), 'noon')
  assert.equal(pickSceneByHour(14), 'afternoon')
  assert.equal(pickSceneByHour(17), 'afternoon')
  assert.equal(pickSceneByHour(18), 'dusk')
  assert.equal(pickSceneByHour(20), 'dusk')
  assert.equal(pickSceneByHour(21), 'night')
  assert.equal(pickSceneByHour(4), 'night')
})

test('resolveActivePanelScene returns null when mode is off', () => {
  assert.equal(resolveActivePanelScene('off'), null)
})

test('resolveActivePanelScene honors pinned scene ids regardless of clock', () => {
  const highNoon = new Date('2026-04-19T12:00:00Z')
  assert.equal(resolveActivePanelScene('night', highNoon), 'night')
  assert.equal(resolveActivePanelScene('dusk', highNoon), 'dusk')
})

test('resolveActivePanelScene in auto mode tracks clock hour', () => {
  const morning = new Date()
  morning.setHours(7, 0, 0, 0)
  assert.equal(resolveActivePanelScene('auto', morning), 'morning')

  const lateNight = new Date()
  lateNight.setHours(23, 0, 0, 0)
  assert.equal(resolveActivePanelScene('auto', lateNight), 'night')
})

test('normalizePanelSceneMode collapses unknown values to auto', () => {
  assert.equal(normalizePanelSceneMode('nonsense'), 'auto')
  assert.equal(normalizePanelSceneMode(42), 'auto')
  assert.equal(normalizePanelSceneMode(undefined), 'auto')
  assert.equal(normalizePanelSceneMode(null), 'auto')
})

test('normalizePanelSceneMode preserves valid modes', () => {
  assert.equal(normalizePanelSceneMode('off'), 'off')
  assert.equal(normalizePanelSceneMode('auto'), 'auto')
  assert.equal(normalizePanelSceneMode('morning'), 'morning')
  assert.equal(normalizePanelSceneMode('night'), 'night')
})
