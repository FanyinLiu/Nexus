import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { beforeEach, test } from 'node:test'

import {
  clearDesktopTyping,
  isDesktopTyping,
  isUserTypingAnywhere,
  noteDesktopTyping,
  noteUserTyping,
} from '../src/features/autonomy/userTyping.ts'
import { emptyProactiveEtiquetteState, evaluateProactiveMessage } from '../src/features/autonomy/proactiveEtiquette.ts'
import { TYPING_QUIET_RESUME_MS } from '../shared/typingActivity.js'
import {
  createTypingQuietGate,
  shouldHoldForTypingQuiet,
} from '../shared/typingQuietGate.js'

const NOW = new Date(2026, 10, 3, 12, 0, 0).getTime()

beforeEach(() => {
  clearDesktopTyping()
  noteUserTyping(0)
})

test('typing is off by default and an opted-out desktop signal never holds', () => {
  const settings = { typingAwarenessEnabled: false }
  noteDesktopTyping(true, NOW)
  assert.equal(isDesktopTyping(NOW), true)
  assert.equal(isUserTypingAnywhere(settings, NOW), false)
  assert.equal(isUserTypingAnywhere(null, NOW), false)
  assert.equal(isUserTypingAnywhere(undefined, NOW), false)
})

test('typing awareness opts in and quiet ends exactly after the grace', () => {
  const settings = { typingAwarenessEnabled: true }
  noteDesktopTyping(true, NOW)
  assert.equal(isUserTypingAnywhere(settings, NOW), true)
  assert.equal(isUserTypingAnywhere(settings, NOW + TYPING_QUIET_RESUME_MS - 1), true)
  assert.equal(isUserTypingAnywhere(settings, NOW + TYPING_QUIET_RESUME_MS), false)
})

test('a natural stop keeps the full grace from the stop edge', () => {
  const settings = { typingAwarenessEnabled: true }
  noteDesktopTyping(true, NOW)
  const stopAt = NOW + 1_000
  noteDesktopTyping(false, stopAt)
  assert.equal(isUserTypingAnywhere(settings, stopAt), true)
  assert.equal(isUserTypingAnywhere(settings, stopAt + TYPING_QUIET_RESUME_MS - 1), true)
  assert.equal(isUserTypingAnywhere(settings, stopAt + TYPING_QUIET_RESUME_MS), false)
})

test('repeated stop signals do not keep extending the grace', () => {
  const settings = { typingAwarenessEnabled: true }
  noteDesktopTyping(true, NOW)
  noteDesktopTyping(false, NOW + 1_000)
  noteDesktopTyping(false, NOW + 2_000)
  noteDesktopTyping(false, NOW + 3_000)
  assert.equal(
    isUserTypingAnywhere(settings, NOW + 1_000 + TYPING_QUIET_RESUME_MS),
    false,
  )
})

test('clearing the hold is immediate, before the grace would expire', () => {
  const settings = { typingAwarenessEnabled: true }
  noteDesktopTyping(true, NOW)
  clearDesktopTyping()
  assert.equal(isDesktopTyping(NOW), false)
  assert.equal(isUserTypingAnywhere(settings, NOW), false)
})

test('the main-process quiet gate requires the setting, a running hook and unexpired grace', () => {
  const base = { settingEnabled: true, hookRunning: true, quietUntil: NOW + 1, now: NOW }
  assert.equal(shouldHoldForTypingQuiet(base), true)
  assert.equal(shouldHoldForTypingQuiet({ ...base, settingEnabled: false }), false)
  // Denied, unavailable or never-started all reach us as a stopped hook.
  assert.equal(shouldHoldForTypingQuiet({ ...base, hookRunning: false }), false)
  assert.equal(shouldHoldForTypingQuiet({ ...base, quietUntil: NOW }), false)
  assert.equal(shouldHoldForTypingQuiet({ ...base, quietUntil: Number.NaN }), false)
  assert.equal(shouldHoldForTypingQuiet({ ...base, now: Number.NaN }), false)
  assert.equal(shouldHoldForTypingQuiet(null), false)
})

test('the renderer etiquette gate holds while typing quiet is active', () => {
  noteDesktopTyping(true, NOW)
  const decision = evaluateProactiveMessage({
    nowMs: NOW,
    kind: 'bracket',
    text: 'Morning check-in',
    enabled: true,
    preset: 'normal',
    userTyping: isUserTypingAnywhere({ typingAwarenessEnabled: true }, NOW),
    focusState: 'active',
    channel: 'next_turn',
  }, emptyProactiveEtiquetteState(NOW))
  assert.equal(decision.allow, false)
  assert.equal(decision.reason, 'typing')
})

test('the quiet gate releases waiting deliveries in arrival order', async () => {
  let typing = true
  const listeners = new Set<(typing: boolean) => void>()
  const gate = createTypingQuietGate({
    isTyping: () => typing,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  })
  const order: string[] = []
  const first = gate.whenFree().then(() => order.push('first'))
  const second = gate.whenFree().then(() => order.push('second'))
  await Promise.resolve()
  assert.deepEqual(order, [])
  assert.equal(gate.pending(), 2)

  typing = false
  for (const listener of [...listeners]) listener(false)
  await Promise.all([first, second])
  assert.deepEqual(order, ['first', 'second'])
  assert.equal(gate.pending(), 0)
})

test('a flag that flips repeatedly only holds the deliveries still waiting', async () => {
  let typing = true
  const listeners = new Set<(typing: boolean) => void>()
  const gate = createTypingQuietGate({
    isTyping: () => typing,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  })
  const notify = () => {
    for (const listener of [...listeners]) listener(typing)
  }

  let firstDone = false
  const first = gate.whenFree().then(() => { firstDone = true })
  typing = false
  notify()
  typing = true
  await first
  assert.equal(firstDone, true, 'an already-released delivery is not re-held')

  let secondDone = false
  const second = gate.whenFree().then(() => { secondDone = true })
  await Promise.resolve()
  assert.equal(secondDone, false, 'the next delivery re-checks the flag')

  typing = false
  notify()
  await second
  assert.equal(secondDone, true)
})

test('the gate reads at most a boolean and logs nothing', async () => {
  const calls: string[][] = []
  const target = console as unknown as Record<string, (...args: unknown[]) => void>
  const methods = ['log', 'info', 'warn', 'error', 'debug'] as const
  const originals = methods.map((method) => target[method])
  for (const method of methods) {
    target[method] = (...args: unknown[]) => { calls.push(args.map((arg) => String(arg))) }
  }
  try {
    let typing = true
    let reads = 0
    const listeners = new Set<(typing: boolean) => void>()
    const gate = createTypingQuietGate({
      isTyping: () => {
        reads += 1
        return typing
      },
      subscribe: (listener) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
    })
    const waiting = gate.whenFree()
    typing = false
    for (const listener of [...listeners]) listener(false)
    await waiting
    assert.ok(reads >= 1)
    assert.deepEqual(calls, [])
  } finally {
    methods.forEach((method, index) => { target[method] = originals[index]! })
  }
})

// Security boundary: the uiohook event object must never be forwarded into
// the typing machine and no new code path may name a key character field.
test('the typing path forwards only the existing opaque keycode token', () => {
  const root = new URL('..', import.meta.url)
  const read = (relative: string) => readFileSync(new URL(relative, root), 'utf8')
  const service = read('electron/services/desktopPresence.js')
  assert.match(service, /event\?\.keycode/)
  assert.doesNotMatch(service, /machine\.(?:keyDown|keyUp)\(\s*event\b/)
  assert.doesNotMatch(service, /JSON\.stringify\(event\)/)

  const files = [
    'electron/services/desktopPresence.js',
    'electron/services/presenceInput.js',
    'shared/typingActivity.js',
    'shared/typingQuietGate.js',
    'src/features/autonomy/userTyping.ts',
    'src/features/desktopPresence/typingPresence.ts',
    'src/features/desktopPresence/mouseNear.ts',
    'src/hooks/useDesktopPresence.ts',
  ]
  for (const file of files) {
    const source = read(file)
    assert.doesNotMatch(source, /keychar|rawcode|keyName|unicodeChar|event\.key\b/i, file)
  }
})

