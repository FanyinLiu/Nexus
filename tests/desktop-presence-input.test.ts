import assert from 'node:assert/strict'
import test from 'node:test'

import { createPresenceInput } from '../electron/services/presenceInput.js'
import { createLinuxPointerQuery, parseXdotoolLocation } from '../electron/services/linuxPointer.js'
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

test('Linux pointer query falls back once and never runs on Wayland', async () => {
  let failures = 0
  const failing: ExecLike = (_command, _args, _options, callback) => {
    failures += 1
    callback(new Error('xdotool is missing'))
  }
  const missing = createLinuxPointerQuery({
    platform: 'linux',
    sessionType: 'x11',
    hasWaylandDisplay: false,
    execFileFn: failing,
    log: { warn: () => {} },
  })
  assert.equal(await missing(), null)
  assert.equal(await missing(), null)
  assert.equal(failures, 1)

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
