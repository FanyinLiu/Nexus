import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { register } from 'node:module'
import { after, test } from 'node:test'

// The module-level `preferences` object is the fallback when
// startDesktopPresence() runs before any settings have been applied. It must
// keep typing awareness off: a fresh start may never install a global keyboard
// hook on its own. This file needs its own process (node:test runs each file
// separately) so the module loads with its untouched in-memory default.
register(new URL('./helpers/desktop-presence-stub-hooks.mjs', import.meta.url))

// Non-darwin makes accessibilityGranted() true without a system permission, so
// the only thing that can start the hook here is the in-memory default itself.
const platformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform')
Object.defineProperty(process, 'platform', { value: 'linux', configurable: true })

type HookState = {
  starts: number
  stops: number
  keydown: number
  keyup: number
  listeners: Map<string, Set<(event: unknown) => void>>
  startError: Error | null
  emit: (event: string, payload?: unknown) => void
}

type DesktopPresenceStubState = {
  trustAccessibility: boolean | 'throw'
  accessibilityError: Error | null
  windows: unknown[]
}

const stubGlobal = globalThis as unknown as {
  __nexusDesktopPresenceStub?: DesktopPresenceStubState
  __nexusDesktopPresenceHook?: HookState
}

// The loader's own globals live on a separate module-hooks thread, so the
// state bags the imported module will see must be created here first.
stubGlobal.__nexusDesktopPresenceStub ??= {
  trustAccessibility: false,
  accessibilityError: null,
  windows: [],
}
stubGlobal.__nexusDesktopPresenceHook ??= {
  starts: 0,
  stops: 0,
  keydown: 0,
  keyup: 0,
  listeners: new Map(),
  startError: null,
  emit: () => {},
}

const presence = await import('../electron/services/desktopPresence.js')

function hookState(): HookState {
  const state = stubGlobal.__nexusDesktopPresenceHook
  assert.ok(state, 'the uiohook stub must be initialized before the test runs')
  return state
}

function resetStub(): void {
  const state = stubGlobal.__nexusDesktopPresenceStub
  assert.ok(state, 'the electron stub must be initialized before the test runs')
  state.trustAccessibility = true
  state.accessibilityError = null
  state.windows = []
}

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

after(() => {
  presence.stopDesktopPresence()
  if (platformDescriptor) Object.defineProperty(process, 'platform', platformDescriptor)
})

test('the in-memory default declares typing awareness off', () => {
  const source = readFileSync(
    new URL('../electron/services/desktopPresence.js', import.meta.url),
    'utf8',
  )
  const declared = source.match(
    /let preferences = \{\s*gazeFollowEnabled:\s*true,\s*typingAwarenessEnabled:\s*(true|false),?\s*\}/,
  )
  assert.ok(declared, 'the in-memory preferences literal must remain locatable')
  assert.equal(
    declared[1],
    'false',
    'flipping the in-memory default on would start the keyboard hook without an opt-in',
  )
})

test('starting without an applied preference never starts the typing hook', async () => {
  resetStub()
  const hook = hookState()
  hook.starts = 0
  hook.stops = 0
  hook.keydown = 0
  hook.keyup = 0
  hook.startError = null

  // No applyDesktopPresencePreferences() before this start: only the module's
  // own default decides whether typing is on.
  presence.startDesktopPresence()
  await delay(100)

  assert.equal(hook.starts, 0, 'the native hook must not start without an explicit opt-in')
  assert.equal(hook.keydown, 0)
  assert.equal(hook.keyup, 0)

  const status = presence.getTypingStatus() as { running: boolean; permission: string }
  assert.equal(status.running, false, 'typing must stay off')
  assert.equal(status.permission, 'not-applicable')
  assert.equal(presence.getTypingQuietState(), false)
})
