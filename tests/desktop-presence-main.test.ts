import assert from 'node:assert/strict'
import { register } from 'node:module'
import { after, afterEach, beforeEach, test } from 'node:test'

// desktopPresence.js owns the state machine that turns global key events into
// the aggregate { phase, keysPerSecond } IPC signal. This file drives that
// state machine through a stubbed native hook: no real keyboard, window,
// permission prompt, or user setting is touched.
register(new URL('./helpers/desktop-presence-stub-hooks.mjs', import.meta.url))

// Force the macOS branch so the Accessibility guard is exercised on every
// runner. The stub answers from globalThis.__nexusDesktopPresenceStub.
const platformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform')
Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true })

type SentMessage = { channel: string; payload: unknown }
type TypingPayload = { phase: string; keysPerSecond: number }

type FakeWindow = {
  isDestroyed: () => boolean
  isVisible: () => boolean
  isMinimized: () => boolean
  getContentBounds: () => { x: number; y: number; width: number; height: number }
  webContents: {
    id: number
    send: (channel: string, payload: unknown) => void
  }
}

type DesktopPresenceStubState = {
  trustAccessibility: boolean | 'throw'
  accessibilityError: Error | null
  windows: FakeWindow[]
}

type HookState = {
  starts: number
  stops: number
  keydown: number
  keyup: number
  listeners: Map<string, Set<(event: unknown) => void>>
  startError: Error | null
  emit: (event: string, payload?: unknown) => void
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

function stubState(): DesktopPresenceStubState {
  const state = stubGlobal.__nexusDesktopPresenceStub
  assert.ok(state, 'the electron stub must be initialized before the test runs')
  return state
}

function hookState(): HookState {
  const state = stubGlobal.__nexusDesktopPresenceHook
  assert.ok(state, 'the uiohook stub must be initialized before the test runs')
  return state
}

function resetStub(): void {
  const state = stubState()
  state.trustAccessibility = true
  state.accessibilityError = null
  state.windows = []
}

function resetHook(): void {
  const state = hookState()
  state.starts = 0
  state.stops = 0
  state.keydown = 0
  state.keyup = 0
  state.startError = null
  state.listeners.clear()
}

function installWindow(): SentMessage[] {
  const sent: SentMessage[] = []
  const win: FakeWindow = {
    isDestroyed: () => false,
    isVisible: () => true,
    isMinimized: () => false,
    getContentBounds: () => ({ x: 0, y: 0, width: 400, height: 400 }),
    webContents: {
      id: 11,
      send: (channel, payload) => {
        sent.push({ channel, payload })
      },
    },
  }
  stubState().windows = [win]
  return sent
}

function typingPayloads(sent: SentMessage[]): TypingPayload[] {
  return sent
    .filter((message) => message.channel === 'desktop-presence:typing')
    .map((message) => message.payload as TypingPayload)
}

function emitKey(event: string, payload: unknown): void {
  hookState().emit(event, payload)
}

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitFor(condition: () => boolean, label: string, timeoutMs = 3_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (condition()) return
    await delay(10)
  }
  assert.fail(`timed out waiting for ${label}`)
}

function typingStatus(): { running: boolean; permission: string; platform: string } {
  return presence.getTypingStatus() as { running: boolean; permission: string; platform: string }
}

function captureWarnings(): { warnings: string[]; restore: () => void } {
  const warnings: string[] = []
  const original = console.warn
  console.warn = (...args: unknown[]) => {
    warnings.push(args.map((arg) => String(arg)).join(' '))
  }
  return {
    warnings,
    restore: () => {
      console.warn = original
    },
  }
}

type LogCapture = {
  logged: string[]
  restore: () => void
}

type MachineTokenState = {
  tokens: { down: unknown[]; up: unknown[] }
}

function logText(value: unknown): string {
  if (typeof value === 'string') return value
  if (value instanceof Uint8Array) return new TextDecoder().decode(value)
  if (value instanceof Error) return `${value.name}: ${value.message}`
  if (value && typeof value === 'object') {
    try {
      return JSON.stringify(value)
    } catch {
      return String(value)
    }
  }
  return String(value)
}

function logTextMany(values: unknown[]): string {
  return values.map(logText).join(' ')
}

// Intercept the process-local logger sinks a key code could escape through:
// every console method and direct stdout/stderr writes. The wrappers call
// through to the real functions, so this only records what production logged.
function captureLoggerSinks(): LogCapture {
  const logged: string[] = []
  const restores: Array<() => void> = []

  const consoleSink = console as unknown as Record<string, (...args: unknown[]) => void>
  for (const method of ['log', 'info', 'warn', 'error', 'debug', 'trace']) {
    const original = consoleSink[method]
    if (typeof original !== 'function') continue
    consoleSink[method] = (...args: unknown[]) => {
      logged.push(logTextMany(args))
      original.apply(consoleSink, args)
    }
    restores.push(() => {
      consoleSink[method] = original
    })
  }

  const streams = [
    process.stdout as unknown as { write: (...args: unknown[]) => boolean },
    process.stderr as unknown as { write: (...args: unknown[]) => boolean },
  ]
  for (const stream of streams) {
    const original = stream.write
    stream.write = (chunk: unknown, ...rest: unknown[]) => {
      logged.push(logText(chunk))
      return original.call(stream, chunk, ...rest)
    }
    restores.push(() => {
      stream.write = original
    })
  }

  return {
    logged,
    restore: () => {
      for (const restore of [...restores].reverse()) restore()
    },
  }
}

function machineTokenState(): MachineTokenState {
  const state = (globalThis as unknown as {
    __nexusDesktopPresenceMachine?: MachineTokenState
  }).__nexusDesktopPresenceMachine
  assert.ok(state, 'the typing-activity wrapper must record machine tokens')
  return state
}

async function enableTyping(): Promise<void> {
  presence.applyDesktopPresencePreferences({
    gazeFollowEnabled: false,
    typingAwarenessEnabled: true,
  })
  await waitFor(
    () => typingStatus().running === true && hookState().keydown === 1 && hookState().keyup === 1,
    'the typing hook to start with Accessibility granted',
  )
}

beforeEach(() => {
  resetStub()
  resetHook()
})

afterEach(async () => {
  // Return the shared module to its stopped, opted-out state so no timer or
  // native hook survives into the next case.
  presence.applyDesktopPresencePreferences({
    gazeFollowEnabled: false,
    typingAwarenessEnabled: false,
  })
  presence.stopDesktopPresence()
  await waitFor(
    () => hookState().keydown === 0 && hookState().keyup === 0 && presence.getTypingQuietState() === false,
    'the module to stop between cases',
  )
  resetStub()
  resetHook()
})

after(() => {
  if (platformDescriptor) Object.defineProperty(process, 'platform', platformDescriptor)
})

test('typing IPC carries only aggregate phase and rate, never a key token', async () => {
  const sent = installWindow()
  await enableTyping()

  const quietSignals: unknown[] = []
  const unsubscribe = presence.subscribeTypingQuiet((typing) => quietSignals.push(typing))

  // The event shape uiohook reports is deliberately broader than the module
  // may forward. Only keycode is allowed to become the opaque machine token.
  const syntheticKey = {
    keycode: 30,
    keychar: 'a',
    rawcode: 999,
    key: 'a',
    unicodeChar: 97,
  }
  emitKey('keydown', syntheticKey)
  assert.equal(presence.getTypingQuietState(), true, 'keydown starts the quiet window')

  emitKey('keyup', syntheticKey)
  await waitFor(
    () => typingPayloads(sent).some((payload) => payload.phase === 'start'),
    'the start signal',
  )
  await waitFor(
    () => typingPayloads(sent).some((payload) => payload.phase === 'stop'),
    'the idle stop signal',
    3_000,
  )

  const payloads = typingPayloads(sent)
  assert.ok(payloads.length >= 2, 'the aggregate signal must be published')
  for (const payload of payloads) {
    assert.deepEqual(Object.keys(payload).sort(), ['keysPerSecond', 'phase'])
    assert.ok(['start', 'update', 'stop'].includes(payload.phase))
    assert.equal(typeof payload.keysPerSecond, 'number')
  }

  const start = payloads.find((payload) => payload.phase === 'start')
  assert.ok(start, 'a keydown must publish a start signal')
  assert.equal(start.keysPerSecond, 1)

  const stop = payloads.find((payload) => payload.phase === 'stop')
  assert.ok(stop, 'an idle pause must publish a stop signal')
  assert.equal(stop.keysPerSecond, 0, 'the stop signal drops the tracked key rate')

  const serialized = JSON.stringify(payloads)
  for (const forbidden of ['keycode', 'keychar', 'rawcode', 'unicodeChar', '"key"', '"a"']) {
    assert.equal(
      serialized.includes(forbidden),
      false,
      `typing IPC must not contain ${forbidden}`,
    )
  }

  // A reset gesture must not resurrect the swallowed keyup as new activity.
  const beforeKeyUp = typingPayloads(sent).length
  emitKey('keyup', syntheticKey)
  await delay(200)
  assert.equal(typingPayloads(sent).length, beforeKeyUp, 'a stale keyup after stop publishes nothing')

  assert.ok(quietSignals.length > 0, 'the quiet subscriber must see the start edge')
  assert.ok(
    quietSignals.every((signal) => typeof signal === 'boolean'),
    'the quiet subscriber sees only a boolean, never a key or event object',
  )
  unsubscribe()
})

test('key handlers tokenize on the numeric keycode and keep it out of logs', async () => {
  const sent = installWindow()
  await enableTyping()

  // A keycode far outside uiohook's real range makes any leak into a log line
  // unambiguous. The handler tokenizes on event.keycode; event.key is not used.
  const distinctiveKeycode = 424242
  const machine = machineTokenState()
  machine.tokens.down.length = 0
  machine.tokens.up.length = 0

  const capture = captureLoggerSinks()
  try {
    emitKey('keydown', { keycode: distinctiveKeycode })
    emitKey('keyup', { keycode: distinctiveKeycode })
    // A missing keycode must fall back to 'unknown', never to event.key.
    emitKey('keydown', { key: 'qZ_marker_key_character_9f3c' })
    emitKey('keyup', { key: 'qZ_marker_key_character_9f3c' })

    await waitFor(
      () => typingPayloads(sent).some((payload) => payload.phase === 'start'),
      'the start signal',
    )
    await waitFor(
      () => typingPayloads(sent).some((payload) => payload.phase === 'stop'),
      'the idle stop signal',
      3_000,
    )
  } finally {
    capture.restore()
  }

  assert.deepEqual(
    machine.tokens.down,
    [distinctiveKeycode, 'unknown'],
    'keydown must pass the numeric event.keycode, or "unknown" when it is missing',
  )
  assert.deepEqual(
    machine.tokens.up,
    [distinctiveKeycode, 'unknown'],
    'keyup must pass the numeric event.keycode, or "unknown" when it is missing',
  )

  assert.equal(
    capture.logged.some((line) => line.includes(String(distinctiveKeycode))),
    false,
    'the keycode must never be passed to a logger',
  )
})

test('stop unloads the typing hook, drops activity, and can start again', async () => {
  const sent = installWindow()
  await enableTyping()
  assert.equal(hookState().starts, 1)

  emitKey('keydown', { keycode: 30 })
  emitKey('keyup', { keycode: 30 })
  await waitFor(
    () => typingPayloads(sent).some((payload) => payload.phase === 'start'),
    'typing to be published before the stop',
  )
  assert.equal(presence.getTypingQuietState(), true)

  presence.stopDesktopPresence()
  await waitFor(
    () => hookState().stops >= 1 && hookState().keydown === 0 && hookState().keyup === 0,
    'the typing hook to stop and detach its listeners',
  )
  assert.equal(presence.getTypingQuietState(), false, 'stop clears the quiet window')

  const stopPayload = typingPayloads(sent).find((payload) => payload.phase === 'stop')
  assert.ok(stopPayload, 'stop publishes one final aggregate stop')
  assert.equal(stopPayload.keysPerSecond, 0)

  // Detached listeners mean later native events are neither counted nor sent.
  const beforeEvents = typingPayloads(sent).length
  emitKey('keydown', { keycode: 31 })
  emitKey('keyup', { keycode: 31 })
  await delay(200)
  assert.equal(typingPayloads(sent).length, beforeEvents, 'stopped hook events publish nothing')
  assert.equal(hookState().keydown, 0)
  assert.equal(hookState().keyup, 0)
  assert.equal(hookState().starts, 1)

  // Preferences still ask for typing, so a fresh start must rebuild the hook.
  presence.startDesktopPresence()
  await waitFor(
    () => hookState().starts >= 2 && hookState().keydown === 1 && hookState().keyup === 1,
    'the typing hook to start again',
  )
  emitKey('keydown', { keycode: 32 })
  await waitFor(
    () => typingPayloads(sent).some((payload) => payload.phase === 'start'),
    'typing after the restart',
  )

  presence.stopDesktopPresence()
  await waitFor(() => hookState().keydown === 0, 'the restarted hook to stop')
})

test('a superseded typing refresh cannot publish a stale status', async () => {
  const sent = installWindow()

  // Establish a settled opted-out baseline on this window first.
  presence.applyDesktopPresencePreferences({
    gazeFollowEnabled: false,
    typingAwarenessEnabled: false,
  })
  await waitFor(
    () => sent.some((message) => message.channel === 'desktop-presence:typing-status'),
    'the baseline status',
  )
  await delay(50)
  const baselineSends = sent.length

  // Both refreshes overlap before either applyPreferences can settle: the
  // second one is the only one allowed to publish.
  presence.applyDesktopPresencePreferences({
    gazeFollowEnabled: false,
    typingAwarenessEnabled: true,
  })
  presence.applyDesktopPresencePreferences({
    gazeFollowEnabled: false,
    typingAwarenessEnabled: false,
  })
  await waitFor(
    () => typingStatus().running === false && typingStatus().permission === 'not-applicable',
    'the latest generation to report typing off',
  )
  await delay(100)

  const statusUpdates = sent
    .slice(baselineSends)
    .filter((message) => message.channel === 'desktop-presence:typing-status')
  assert.equal(
    statusUpdates.length,
    1,
    'only the last refresh generation may publish a typing status',
  )
  assert.equal(hookState().starts, 0, 'a superseded enable must not start the native hook')
  assert.equal(hookState().keydown, 0)
  assert.equal(typingPayloads(sent).length, 0, 'a superseded enable must not emit typing activity')
})

test('an accessibility-check failure logs a redacted error', async () => {
  installWindow()
  const syntheticSecret = 'token=xai-testdeadbeefsecret'
  const syntheticPath = '/Users/klein/secret-path'
  stubState().trustAccessibility = 'throw'
  stubState().accessibilityError = new Error(
    `accessibility probe failed ${syntheticSecret} at ${syntheticPath}`,
  )

  const capture = captureWarnings()
  try {
    presence.applyDesktopPresencePreferences({
      gazeFollowEnabled: false,
      typingAwarenessEnabled: true,
    })
    await waitFor(
      () => typingStatus().permission === 'denied',
      'the accessibility failure to report denied',
    )
  } finally {
    capture.restore()
  }

  const matching = capture.warnings.filter((line) => (
    line.includes('[desktop-presence] accessibility check failed:')
  ))
  assert.equal(matching.length, 1, 'the accessibility failure must be logged once')
  const joined = capture.warnings.join('\n')
  assert.equal(joined.includes('xai-testdeadbeefsecret'), false, 'the raw token must not be logged')
  assert.equal(joined.includes(syntheticPath), false, 'the raw user path must not be logged')
  assert.equal(joined.includes('/Users/klein'), false, 'the home-directory prefix must be redacted')
  assert.equal(hookState().starts, 0, 'a failed accessibility probe must not start the hook')
})

test('a typing-hook start failure logs a redacted error', async () => {
  installWindow()
  const syntheticSecret = 'token=xai-testdeadbeefsecret'
  const syntheticPath = '/Users/klein/secret-path'
  hookState().startError = new Error(
    `hook start failed ${syntheticSecret} at ${syntheticPath}`,
  )

  const capture = captureWarnings()
  try {
    presence.applyDesktopPresencePreferences({
      gazeFollowEnabled: false,
      typingAwarenessEnabled: true,
    })
    await waitFor(
      () => typingStatus().permission === 'denied' && typingStatus().running === false,
      'the hook start failure to report denied',
    )
  } finally {
    capture.restore()
  }

  assert.equal(hookState().starts, 1, 'the native hook start must have been attempted')
  const matching = capture.warnings.filter((line) => (
    line.includes('[desktop-presence] typing hook start failed:')
  ))
  assert.equal(matching.length, 1, 'the hook start failure must be logged once')
  const joined = capture.warnings.join('\n')
  assert.equal(joined.includes('xai-testdeadbeefsecret'), false, 'the raw token must not be logged')
  assert.equal(joined.includes(syntheticPath), false, 'the raw user path must not be logged')
  assert.equal(joined.includes('/Users/klein'), false, 'the home-directory prefix must be redacted')
})
