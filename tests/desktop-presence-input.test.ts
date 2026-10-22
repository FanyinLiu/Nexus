import assert from 'node:assert/strict'
import test from 'node:test'

import { createPresenceInput } from '../electron/services/presenceInput.js'
import {
  LINUX_POINTER_MAX_RETRY_MS,
  LINUX_POINTER_MISSING_RETRY_MS,
  LINUX_POINTER_RETRY_MS,
  createLinuxPointerQuery,
  parseXdotoolLocation,
} from '../electron/services/linuxPointer.js'
import { selectGazeCursor } from '../shared/gazeFollow.js'

type Listener = (event: unknown) => void
type ExecCallback = (error: Error | null, stdout?: string) => void
type ExecLike = (command: string, args: string[], options: unknown, callback: ExecCallback) => void

function createFakeHook() {
  const listeners = new Map<string, Set<Listener>>()
  const calls = { starts: 0, stops: 0 }
  const hook = {
    on(event: string, listener: Listener) {
      const set = listeners.get(event) ?? new Set<Listener>()
      set.add(listener)
      listeners.set(event, set)
      return hook
    },
    off(event: string, listener: Listener) {
      listeners.get(event)?.delete(listener)
      return hook
    },
    start() {
      calls.starts += 1
    },
    stop() {
      calls.stops += 1
    },
  }
  return {
    hook,
    calls,
    emit(event: string, payload?: unknown) {
      for (const listener of listeners.get(event) ?? []) listener(payload)
    },
    count(event: string) {
      return listeners.get(event)?.size ?? 0
    },
  }
}

test('typing off keeps uiohook out of the Linux gaze path', async () => {
  const fake = createFakeHook()
  let loads = 0
  const input = createPresenceInput({
    platform: 'linux',
    loadHook: async () => {
      loads += 1
      return fake.hook
    },
    pointerQuery: async () => ({ x: 80, y: 180 }),
  })

  const result = await input.applyPreferences({
    gazeFollowEnabled: true,
    typingAwarenessEnabled: false,
  })

  assert.equal(result.running, false)
  assert.equal(loads, 0)
  assert.equal(fake.calls.starts, 0)
  assert.equal(fake.count('keydown'), 0)
  assert.equal(fake.count('keyup'), 0)
  assert.equal(input.isTypingRunning(), false)

  assert.deepEqual(await input.pollCursor(), { x: 80, y: 180 })
  assert.deepEqual(input.readCursor(), { x: 80, y: 180 })
  assert.deepEqual(selectGazeCursor({
    platform: 'linux',
    globalPoint: input.readCursor(),
    electronPoint: { x: 1, y: 1 },
  }), { source: 'global', physical: { x: 80, y: 180 } })
})

test('turning typing off while gaze stays on stops the native hook', async () => {
  const fake = createFakeHook()
  const keys: string[] = []
  const input = createPresenceInput({
    platform: 'linux',
    loadHook: async () => fake.hook,
    pointerQuery: async () => ({ x: 12, y: 34 }),
    onKeyDown: () => keys.push('down'),
    onKeyUp: () => keys.push('up'),
  })

  const enabled = await input.applyPreferences({
    gazeFollowEnabled: true,
    typingAwarenessEnabled: true,
  })
  assert.equal(enabled.running, true)
  assert.equal(fake.calls.starts, 1)
  assert.equal(fake.count('keydown'), 1)
  assert.equal(fake.count('keyup'), 1)
  fake.emit('keydown', { keycode: 30 })
  fake.emit('keyup', { keycode: 30 })
  assert.deepEqual(keys, ['down', 'up'])

  const disabled = await input.applyPreferences({
    gazeFollowEnabled: true,
    typingAwarenessEnabled: false,
  })
  assert.equal(disabled.running, false)
  assert.equal(fake.calls.stops, 1)
  assert.equal(fake.count('keydown'), 0)
  assert.equal(fake.count('keyup'), 0)
  assert.equal(input.isTypingRunning(), false)

  // Gaze keeps working through the pointer query after the hook is gone.
  await input.pollCursor()
  assert.deepEqual(input.readCursor(), { x: 12, y: 34 })
})

test('turning typing on installs one hook and keeps it across repeated preferences', async () => {
  const fake = createFakeHook()
  let loads = 0
  const input = createPresenceInput({
    platform: 'linux',
    loadHook: async () => {
      loads += 1
      return fake.hook
    },
    pointerQuery: async () => ({ x: 4, y: 5 }),
  })

  const first = await input.applyPreferences({
    gazeFollowEnabled: true,
    typingAwarenessEnabled: true,
  })
  const second = await input.applyPreferences({
    gazeFollowEnabled: true,
    typingAwarenessEnabled: true,
  })

  assert.equal(first.running, true)
  assert.equal(second.running, true)
  assert.equal(loads, 1)
  assert.equal(fake.calls.starts, 1)
  assert.equal(fake.count('keydown'), 1)
  assert.equal(fake.count('keyup'), 1)
  assert.equal(input.isTypingRunning(), true)
})

test('turning both gaze and typing off stops the hook and removes its listeners', async () => {
  const fake = createFakeHook()
  const input = createPresenceInput({
    platform: 'linux',
    loadHook: async () => fake.hook,
    pointerQuery: async () => ({ x: 10, y: 20 }),
  })

  const enabled = await input.applyPreferences({
    gazeFollowEnabled: true,
    typingAwarenessEnabled: true,
  })
  assert.equal(enabled.running, true)
  assert.equal(fake.calls.starts, 1)
  assert.equal(fake.count('keydown'), 1)
  assert.equal(fake.count('keyup'), 1)

  const disabled = await input.applyPreferences({
    gazeFollowEnabled: false,
    typingAwarenessEnabled: false,
  })
  assert.equal(disabled.running, false)
  assert.equal(fake.calls.stops, 1)
  assert.equal(fake.count('keydown'), 0)
  assert.equal(fake.count('keyup'), 0)
  assert.equal(input.isTypingRunning(), false)
})

test('turning typing off then on reattaches a running hook with key listeners', async () => {
  const fake = createFakeHook()
  const keys: string[] = []
  const input = createPresenceInput({
    platform: 'linux',
    loadHook: async () => fake.hook,
    pointerQuery: async () => null,
    onKeyDown: () => keys.push('down'),
    onKeyUp: () => keys.push('up'),
  })

  const first = await input.applyPreferences({
    gazeFollowEnabled: true,
    typingAwarenessEnabled: true,
  })
  assert.equal(first.running, true)
  assert.equal(fake.calls.starts, 1)
  assert.equal(fake.count('keydown'), 1)
  assert.equal(fake.count('keyup'), 1)

  const off = await input.applyPreferences({
    gazeFollowEnabled: true,
    typingAwarenessEnabled: false,
  })
  assert.equal(off.running, false)
  assert.equal(input.isTypingRunning(), false)
  assert.equal(fake.count('keydown'), 0)
  assert.equal(fake.count('keyup'), 0)

  const again = await input.applyPreferences({
    gazeFollowEnabled: true,
    typingAwarenessEnabled: true,
  })
  assert.equal(again.running, true)
  assert.equal(input.isTypingRunning(), true)
  assert.equal(fake.calls.starts, 2)
  assert.equal(fake.count('keydown'), 1)
  assert.equal(fake.count('keyup'), 1)

  fake.emit('keydown', { keycode: 30 })
  fake.emit('keyup', { keycode: 30 })
  assert.deepEqual(keys, ['down', 'up'])
})

test('xdotool output parses into a root pointer point', () => {
  assert.deepEqual(
    parseXdotoolLocation('X=80\nY=180\nSCREEN=0\nWINDOW=1\n'),
    { x: 80, y: 180 },
  )
  assert.deepEqual(
    parseXdotoolLocation('X=-1600\nY=240\nSCREEN=1\nWINDOW=2\n'),
    { x: -1600, y: 240 },
  )
  assert.equal(parseXdotoolLocation('WINDOW=1\nSCREEN=0\n'), null)
  assert.equal(parseXdotoolLocation('X=abc\nY=1\n'), null)
})

test('Linux pointer query samples the root pointer without touching the hook', async () => {
  const calls: Array<{ command: string, args: string[] }> = []
  const execFileFn: ExecLike = (command, args, _options, callback) => {
    calls.push({ command, args })
    callback(null, 'X=80\nY=180\nSCREEN=0\nWINDOW=1\n')
  }
  const query = createLinuxPointerQuery({
    platform: 'linux',
    sessionType: 'x11',
    hasWaylandDisplay: false,
    execFileFn,
    log: { warn: () => {} },
  })

  assert.deepEqual(await query(), { x: 80, y: 180 })
  assert.equal(calls.length, 1)
  assert.equal(calls[0].command, 'xdotool')
  assert.deepEqual(calls[0].args, ['getmouselocation', '--shell'])
})

test('Linux pointer query falls back on failure and retries after the cooldown', async () => {
  let now = 1_000
  let failures = 0
  const failing: ExecLike = (_command, _args, _options, callback) => {
    failures += 1
    callback(new Error('xdotool failed'))
  }
  const query = createLinuxPointerQuery({
    platform: 'linux',
    sessionType: 'x11',
    hasWaylandDisplay: false,
    execFileFn: failing,
    now: () => now,
    log: { warn: () => {} },
  })

  // A failed sample returns null so gaze uses the Electron cursor.
  assert.equal(await query(), null)
  assert.equal(failures, 1)

  // The cooldown keeps xdotool from spawning on every gaze frame.
  assert.equal(await query(), null)
  assert.equal(failures, 1)
  now += LINUX_POINTER_RETRY_MS - 1
  assert.equal(await query(), null)
  assert.equal(failures, 1)

  now += 1
  assert.equal(await query(), null)
  assert.equal(failures, 2)
})

test('Linux pointer query recovers on success and resets its backoff', async () => {
  let now = 0
  let calls = 0
  const flaky: ExecLike = (_command, _args, _options, callback) => {
    calls += 1
    if (calls % 2 === 1) {
      callback(new Error('xdotool failed'))
      return
    }
    callback(null, 'X=7\nY=9\n')
  }
  const query = createLinuxPointerQuery({
    platform: 'linux',
    sessionType: 'x11',
    hasWaylandDisplay: false,
    execFileFn: flaky,
    now: () => now,
    log: { warn: () => {} },
  })

  assert.equal(await query(), null)
  now = LINUX_POINTER_RETRY_MS
  assert.deepEqual(await query(), { x: 7, y: 9 })
  assert.equal(calls, 2)

  // Success reset the backoff, so the next failure waits the base delay again
  // instead of doubling the previous one.
  assert.equal(await query(), null)
  assert.equal(calls, 3)
  now += LINUX_POINTER_RETRY_MS - 1
  assert.equal(await query(), null)
  assert.equal(calls, 3)
  now += 1
  assert.deepEqual(await query(), { x: 7, y: 9 })
  assert.equal(calls, 4)
})

test('Linux pointer query grows the retry delay up to the cap', async () => {
  let now = 0
  const attempts: number[] = []
  const failing: ExecLike = (_command, _args, _options, callback) => {
    attempts.push(now)
    callback(new Error('xdotool failed'))
  }
  const query = createLinuxPointerQuery({
    platform: 'linux',
    sessionType: 'x11',
    hasWaylandDisplay: false,
    execFileFn: failing,
    now: () => now,
    log: { warn: () => {} },
  })

  const expected = [0, 5_000, 15_000, 35_000, 75_000, 135_000]
  for (const attemptAt of expected) {
    now = attemptAt
    assert.equal(await query(), null)
  }
  assert.deepEqual(attempts, expected)

  // The delay caps at 60s: no spawn one millisecond before the window ends.
  now = 135_000 + LINUX_POINTER_MAX_RETRY_MS - 1
  assert.equal(await query(), null)
  assert.equal(attempts.length, expected.length)
  now += 1
  assert.equal(await query(), null)
  assert.deepEqual(attempts, [...expected, 195_000])
})

test('Linux pointer query waits longer when xdotool is not installed', async () => {
  let now = 0
  let calls = 0
  const missingCommand: ExecLike = (_command, _args, _options, callback) => {
    calls += 1
    const error = Object.assign(new Error('spawn xdotool ENOENT'), { code: 'ENOENT' })
    callback(error)
  }
  const query = createLinuxPointerQuery({
    platform: 'linux',
    sessionType: 'x11',
    hasWaylandDisplay: false,
    execFileFn: missingCommand,
    now: () => now,
    log: { warn: () => {} },
  })

  assert.equal(await query(), null)
  assert.equal(calls, 1)
  now = LINUX_POINTER_RETRY_MS
  assert.equal(await query(), null)
  assert.equal(calls, 1)
  now = LINUX_POINTER_MISSING_RETRY_MS
  assert.equal(await query(), null)
  assert.equal(calls, 2)
})

test('a failed xdotool sample drops the cached pointer so gaze falls back to Electron', async () => {
  let now = 10_000
  let calls = 0
  const flaky: ExecLike = (_command, _args, _options, callback) => {
    calls += 1
    if (calls === 1) {
      callback(null, 'X=80\nY=180\n')
      return
    }
    callback(new Error('xdotool failed'))
  }
  const query = createLinuxPointerQuery({
    platform: 'linux',
    sessionType: 'x11',
    hasWaylandDisplay: false,
    execFileFn: flaky,
    now: () => now,
    log: { warn: () => {} },
  })
  const input = createPresenceInput({
    platform: 'linux',
    loadHook: async () => null,
    pointerQuery: query,
    now: () => now,
  })
  await input.applyPreferences({ gazeFollowEnabled: true, typingAwarenessEnabled: false })

  now += 100
  assert.deepEqual(await input.pollCursor(), { x: 80, y: 180 })
  assert.deepEqual(input.readCursor(), { x: 80, y: 180 })

  // The failed sample must clear the last point; keeping it would freeze gaze
  // at the stale coordinate for the whole retry cooldown.
  now += 100
  assert.equal(await input.pollCursor(), null)
  assert.equal(calls, 2)
  assert.equal(input.readCursor(), null)
  assert.deepEqual(selectGazeCursor({
    platform: 'linux',
    globalPoint: input.readCursor(),
    electronPoint: { x: 11, y: 22 },
  }), { source: 'electron', dip: { x: 11, y: 22 } })
})

test('Linux pointer query logs once per failure episode and again after recovery', async () => {
  let now = 0
  let calls = 0
  const warnings: unknown[] = []
  const scripted: ExecLike = (_command, _args, _options, callback) => {
    calls += 1
    if (calls !== 3) {
      callback(new Error('xdotool failed'))
      return
    }
    callback(null, 'X=1\nY=2\n')
  }
  const query = createLinuxPointerQuery({
    platform: 'linux',
    sessionType: 'x11',
    hasWaylandDisplay: false,
    execFileFn: scripted,
    now: () => now,
    log: { warn: (...args: unknown[]) => { warnings.push(args) } },
  })

  assert.equal(await query(), null)
  assert.equal(warnings.length, 1)

  // The backoff retries stay quiet while the same failure episode continues.
  now += LINUX_POINTER_RETRY_MS
  assert.equal(await query(), null)
  assert.equal(warnings.length, 1)

  // A successful read closes the episode.
  now += LINUX_POINTER_RETRY_MS * 2
  assert.deepEqual(await query(), { x: 1, y: 2 })
  assert.equal(warnings.length, 1)

  // The next new failure warns again, and its retry stays quiet.
  now += LINUX_POINTER_RETRY_MS
  assert.equal(await query(), null)
  assert.equal(warnings.length, 2)
  now += LINUX_POINTER_RETRY_MS
  assert.equal(await query(), null)
  assert.equal(warnings.length, 2)
})

test('disposing the Linux pointer query kills the in-flight child and stops new queries', async () => {
  let execCalls = 0
  let kills = 0
  const callbacks: ExecCallback[] = []
  const execFileFn: ExecLike = (_command, _args, _options, callback) => {
    execCalls += 1
    callbacks.push(callback)
    return { kill: () => { kills += 1 } }
  }
  const query = createLinuxPointerQuery({
    platform: 'linux',
    sessionType: 'x11',
    hasWaylandDisplay: false,
    execFileFn,
    now: () => 0,
    log: { warn: () => {} },
  })

  const sample = query()
  assert.equal(execCalls, 1)
  query.dispose()
  assert.equal(kills, 1)

  callbacks.shift()?.(new Error('killed'))
  assert.equal(await sample, null)
  assert.equal(await query(), null)
  assert.equal(execCalls, 1)
})

test('presence input stop disposes the Linux pointer query', async () => {
  let disposals = 0
  const pointerQuery = Object.assign(async () => null, {
    dispose: () => { disposals += 1 },
  })
  const input = createPresenceInput({
    platform: 'linux',
    loadHook: async () => null,
    pointerQuery,
  })
  await input.applyPreferences({ gazeFollowEnabled: true, typingAwarenessEnabled: false })

  await input.stop()

  assert.equal(disposals, 1)
})

test('Linux pointer query never runs on Wayland', async () => {
  let waylandSpawns = 0
  const waylandExec: ExecLike = (_command, _args, _options, callback) => {
    waylandSpawns += 1
    callback(null, 'X=1\nY=1\n')
  }
  const wayland = createLinuxPointerQuery({
    platform: 'linux',
    sessionType: 'wayland',
    hasWaylandDisplay: true,
    execFileFn: waylandExec,
    log: { warn: () => {} },
  })
  assert.equal(await wayland(), null)
  assert.equal(waylandSpawns, 0)
})
