import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  createContextComparisonSalt,
  createContextTextFingerprint,
  evaluateCondition,
  type ContextSnapshot,
} from '../src/features/autonomy/contextScheduler.ts'

function snapshot(overrides: Partial<ContextSnapshot> = {}): ContextSnapshot {
  return {
    focusState: 'active',
    previousFocusState: 'active',
    activeWindowTitle: null,
    activeWindowChanged: false,
    clipboardText: null,
    clipboardChanged: false,
    currentHour: 12,
    idleSeconds: 0,
    ...overrides,
  }
}

test('context scheduler detects app switches without retaining previous window title', () => {
  assert.equal(evaluateCondition(
    { kind: 'app_switched', appName: 'Messages' },
    snapshot({ activeWindowTitle: 'Messages - Alice', activeWindowChanged: false }),
  ), false)

  assert.equal(evaluateCondition(
    { kind: 'app_switched', appName: 'Messages' },
    snapshot({ activeWindowTitle: 'Messages - Alice', activeWindowChanged: true }),
  ), true)
})

test('context scheduler detects clipboard changes without retaining previous clipboard text', () => {
  assert.equal(evaluateCondition(
    { kind: 'clipboard_changed' },
    snapshot({ clipboardText: 'private message contents', clipboardChanged: false }),
  ), false)

  assert.equal(evaluateCondition(
    { kind: 'clipboard_changed' },
    snapshot({ clipboardText: 'private message contents', clipboardChanged: true }),
  ), true)

  assert.equal(evaluateCondition(
    { kind: 'clipboard_changed', pattern: 'message' },
    snapshot({ clipboardText: 'private message contents', clipboardChanged: true }),
  ), true)
})

test('context text fingerprints are salted and do not expose source text', () => {
  const source = 'private clipboard message contents'
  const salt = createContextComparisonSalt()
  const sameSaltFingerprint = createContextTextFingerprint(source, salt)
  const repeatedFingerprint = createContextTextFingerprint(source, salt)
  const differentTextFingerprint = createContextTextFingerprint(`${source}!`, salt)
  const differentSaltFingerprint = createContextTextFingerprint(source, `${salt}:other`)

  assert.equal(typeof sameSaltFingerprint, 'string')
  assert.equal(sameSaltFingerprint, repeatedFingerprint)
  assert.notEqual(sameSaltFingerprint, differentTextFingerprint)
  assert.notEqual(sameSaltFingerprint, differentSaltFingerprint)
  assert.doesNotMatch(sameSaltFingerprint ?? '', /private|clipboard|message|contents/)
})
