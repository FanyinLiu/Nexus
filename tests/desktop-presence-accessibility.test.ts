import assert from 'node:assert/strict'
import { register } from 'node:module'
import { after, afterEach, beforeEach, test } from 'node:test'

// desktopPresence.js statically imports 'electron' and typing awareness
// dynamically imports the real uiohook native module. Both are stubbed so
// this test only observes whether the hook would start: no window is created,
// no permission prompt is shown, no keyboard event is captured.
register(new URL('./helpers/desktop-presence-stub-hooks.mjs', import.meta.url))

// force the macOS branch on every runner; the accessibility-denied guard is
// what this file protects.
const platformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform')
Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true })

type StubState = { trustAccessibility: boolean }
type HookCounts = { starts: number; stops: number; keydown: number; keyup: number }

const stubGlobal = globalThis as unknown as {
  __nexusDesktopPresenceStub?: StubState
  __nexusDesktopPresenceHookCounts?: HookCounts
}

function stubState(): StubState {
  return (stubGlobal.__nexusDesktopPresenceStub ??= { trustAccessibility: false })
}

function hookCounts(): HookCounts {
  return (stubGlobal.__nexusDesktopPresenceHookCounts ??= {
    starts: 0,
    stops: 0,
    keydown: 0,
    keyup: 0,
  })
}

const presence = await import('../electron/services/desktopPresence.js')

type TypingStatus = {
  running: boolean
  permission: string
  platform: string
}

function typingStatus(): TypingStatus {
  return presence.getTypingStatus() as TypingStatus
}

async function waitFor(condition: () => boolean, label: string, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (condition()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  assert.fail(`timed out waiting for ${label}`)
}

function applyTyping(enabled: boolean) {
  presence.applyDesktopPresencePreferences({
    gazeFollowEnabled: false,
    typingAwarenessEnabled: enabled,
  })
}

beforeEach(() => {
  stubState().trustAccessibility = false
  Object.assign(hookCounts(), { starts: 0, stops: 0, keydown: 0, keyup: 0 })
})

afterEach(async () => {
  applyTyping(false)
  await waitFor(
    () => typingStatus().running === false,
    'typing hook to stop before the next test',
  )
})

after(() => {
  if (platformDescriptor) Object.defineProperty(process, 'platform', platformDescriptor)
})

test('macOS without Accessibility never starts the typing hook', async () => {
  stubState().trustAccessibility = false

  applyTyping(true)
  await waitFor(
    () => typingStatus().permission === 'denied',
    'typing status to report denied Accessibility',
  )

  const counts = hookCounts()
  assert.equal(counts.starts, 0, 'the native hook must not start without Accessibility')
  assert.equal(counts.keydown, 0, 'no keydown listener may attach without Accessibility')
  assert.equal(counts.keyup, 0, 'no keyup listener may attach without Accessibility')
  assert.equal(typingStatus().running, false)
})

test('macOS with Accessibility starts the typing hook when typing is enabled', async () => {
  stubState().trustAccessibility = true

  applyTyping(true)
  await waitFor(
    () => typingStatus().running === true && typingStatus().permission === 'granted',
    'typing hook to start with Accessibility granted',
  )

  const counts = hookCounts()
  assert.equal(counts.starts, 1)
  assert.equal(counts.keydown, 1)
  assert.equal(counts.keyup, 1)
})

test('revoking Accessibility stops an already running typing hook', async () => {
  stubState().trustAccessibility = true
  applyTyping(true)
  await waitFor(
    () => typingStatus().running === true,
    'typing hook to start before trust is revoked',
  )
  assert.equal(hookCounts().starts, 1)

  stubState().trustAccessibility = false
  applyTyping(true)
  await waitFor(
    () => typingStatus().permission === 'denied' && typingStatus().running === false,
    'typing hook to stop after Accessibility is revoked',
  )

  assert.equal(hookCounts().stops, 1)
  assert.equal(hookCounts().starts, 1, 'no restart is allowed without Accessibility')
  assert.equal(hookCounts().keydown, 0)
  assert.equal(hookCounts().keyup, 0)
})
