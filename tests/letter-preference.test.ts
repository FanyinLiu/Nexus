import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  normalizeProactiveLetterChoice,
  resolveProactiveLetterEnabled,
} from '../src/features/letter/letterPreference.ts'

test('new installs and untouched legacy stores default the weekly letter on', () => {
  assert.equal(resolveProactiveLetterEnabled({}), true)
  assert.equal(resolveProactiveLetterEnabled({ choice: 'auto' }), true)
  assert.equal(resolveProactiveLetterEnabled({
    choice: 'auto',
    storedEnabled: false,
    companionInitiative: 'quiet',
  }), true)
  assert.equal(resolveProactiveLetterEnabled({
    storedEnabled: false,
    companionInitiative: 'custom',
  }), true)
})

test('a stored legacy true stays on', () => {
  assert.equal(resolveProactiveLetterEnabled({
    storedEnabled: true,
    companionInitiative: 'quiet',
  }), true)
})

test('the old Sometimes/Often letter switch keeps an explicit legacy off', () => {
  assert.equal(resolveProactiveLetterEnabled({
    storedEnabled: false,
    companionInitiative: 'sometimes',
  }), false)
  assert.equal(resolveProactiveLetterEnabled({
    storedEnabled: false,
    companionInitiative: 'often',
  }), false)
})

test('an explicit on/off choice always wins over the legacy value', () => {
  assert.equal(resolveProactiveLetterEnabled({
    choice: 'off',
    storedEnabled: true,
    companionInitiative: 'sometimes',
  }), false)
  assert.equal(resolveProactiveLetterEnabled({
    choice: 'on',
    storedEnabled: false,
    companionInitiative: 'quiet',
  }), true)
})

test('unknown choice values normalize to auto', () => {
  assert.equal(normalizeProactiveLetterChoice('ON'), 'auto')
  assert.equal(normalizeProactiveLetterChoice(null), 'auto')
  assert.equal(normalizeProactiveLetterChoice(undefined), 'auto')
  assert.equal(normalizeProactiveLetterChoice('on'), 'on')
  assert.equal(normalizeProactiveLetterChoice('off'), 'off')
})
