import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  sanitizePanelWindowStatePatch,
  sanitizePetWindowStatePatch,
  sanitizeRuntimeStatePatch,
} from '../electron/windowStateSanitizers.js'

test('sanitizeRuntimeStatePatch keeps allowed fields and drops unknown or wrong typed values', () => {
  const out = sanitizeRuntimeStatePatch({
    mood: 'happy',
    voiceState: 'speaking',
    wakewordActive: true,
    ttsInProgress: false,
    searchInProgress: 'yes',
    unknown: 'drop',
  })

  assert.deepEqual({ ...out }, {
    mood: 'happy',
    voiceState: 'speaking',
    wakewordActive: true,
    ttsInProgress: false,
  })
})

test('sanitizeRuntimeStatePatch clamps string fields to 256 chars', () => {
  const out = sanitizeRuntimeStatePatch({
    activeTaskLabel: 'x'.repeat(300),
  })

  assert.equal(out.activeTaskLabel.length, 256)
})

test('sanitizePetWindowStatePatch keeps only pet window fields', () => {
  const out = sanitizePetWindowStatePatch({
    isPinned: true,
    clickThrough: false,
    petHotspotActive: true,
    locomotionActivity: 'roaming',
    freeMode: true,
    roamCapable: false,
    collapsed: true,
    mood: 'curious',
  })

  assert.deepEqual({ ...out }, {
    isPinned: true,
    clickThrough: false,
    petHotspotActive: true,
    locomotionActivity: 'roaming',
    freeMode: true,
    roamCapable: false,
  })
})

test('sanitizePanelWindowStatePatch accepts only collapsed boolean', () => {
  assert.deepEqual({ ...sanitizePanelWindowStatePatch({ collapsed: true }) }, { collapsed: true })
  assert.deepEqual({ ...sanitizePanelWindowStatePatch({ collapsed: 'yes' }) }, {})
})

test('sanitizers return empty null-prototype objects for non-object payloads', () => {
  assert.equal(Object.getPrototypeOf(sanitizeRuntimeStatePatch(null)), null)
  assert.deepEqual({ ...sanitizeRuntimeStatePatch(null) }, {})
  assert.deepEqual({ ...sanitizePetWindowStatePatch('bad') }, {})
  assert.deepEqual({ ...sanitizePanelWindowStatePatch(undefined) }, {})
})
