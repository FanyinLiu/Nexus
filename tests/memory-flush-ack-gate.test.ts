import assert from 'node:assert/strict'
import { register } from 'node:module'
import { test } from 'node:test'

import {
  createMemoryFlushAckGate,
  createMemoryQuitFlushHandler,
} from '../electron/services/memoryFlushAckGate.js'
import {
  isUpdateInstallQuit,
} from '../electron/services/updateInstallQuitFlag.js'
import { autoUpdater } from './helpers/electron-main-stub-hooks.mjs'

// updaterService statically imports electron and electron-updater; the shared
// main-process stub hook resolves both to its in-memory implementations.
register(new URL('./helpers/electron-main-stub-hooks.mjs', import.meta.url))

function createWindow(sends: string[]) {
  return {
    isDestroyed: () => false,
    webContents: {
      isDestroyed: () => false,
      send: (channel: string) => { sends.push(channel) },
    },
  }
}

function createEvent() {
  const state = { prevented: 0 }
  return {
    state,
    event: { preventDefault: () => { state.prevented += 1 } },
  }
}

test('a renderer ack releases the quit wait before the timeout', async () => {
  const gate = createMemoryFlushAckGate()
  gate.expect(1)
  const wait = gate.waitForAck(1_000)

  gate.acknowledge()

  assert.equal(await wait, true)
})

test('a missing ack resolves after the timeout instead of blocking quit', async () => {
  const gate = createMemoryFlushAckGate()
  gate.expect(1)

  const startedAt = Date.now()
  const acked = await gate.waitForAck(20)

  assert.equal(acked, false)
  assert.ok(Date.now() - startedAt >= 10)
})

test('an update-install quit bypasses the memory flush handshake', () => {
  const sends: string[] = []
  let quitCalls = 0
  const { event, state } = createEvent()
  const handler = createMemoryQuitFlushHandler({
    getWindows: () => [createWindow(sends)],
    gate: createMemoryFlushAckGate(),
    timeoutMs: 1_000,
    quit: () => { quitCalls += 1 },
    isUpdateInstallQuit: () => true,
  })

  handler(event)

  assert.equal(state.prevented, 0)
  assert.deepEqual(sends, [])
  assert.equal(quitCalls, 0)
})

test('a normal quit waits for every window ack before quitting', async () => {
  const sends: string[] = []
  let quitCalls = 0
  const gate = createMemoryFlushAckGate()
  let resolveQuit = () => {}
  const quitDone = new Promise<void>((resolve) => { resolveQuit = resolve })
  const { event, state } = createEvent()
  const handler = createMemoryQuitFlushHandler({
    getWindows: () => [createWindow(sends), createWindow(sends)],
    gate,
    timeoutMs: 1_000,
    quit: () => { quitCalls += 1; resolveQuit() },
    isUpdateInstallQuit: () => false,
  })

  handler(event)

  assert.equal(state.prevented, 1)
  assert.deepEqual(sends, ['memory:flush-request', 'memory:flush-request'])
  gate.acknowledge()
  gate.acknowledge()
  await quitDone

  assert.equal(quitCalls, 1)
})

test('a normal quit still quits when no window acks before the timeout', async () => {
  const sends: string[] = []
  let quitCalls = 0
  let resolveQuit = () => {}
  const quitDone = new Promise<void>((resolve) => { resolveQuit = resolve })
  const { event } = createEvent()
  const handler = createMemoryQuitFlushHandler({
    getWindows: () => [createWindow(sends)],
    gate: createMemoryFlushAckGate(),
    timeoutMs: 20,
    quit: () => { quitCalls += 1; resolveQuit() },
    isUpdateInstallQuit: () => false,
  })

  handler(event)
  await quitDone

  assert.equal(quitCalls, 1)
})

test('a second before-quit after the flush started does not prevent default', async () => {
  const sends: string[] = []
  const gate = createMemoryFlushAckGate()
  let resolveQuit = () => {}
  const quitDone = new Promise<void>((resolve) => { resolveQuit = resolve })
  const first = createEvent()
  const second = createEvent()
  const handler = createMemoryQuitFlushHandler({
    getWindows: () => [createWindow(sends)],
    gate,
    timeoutMs: 1_000,
    quit: () => { resolveQuit() },
    isUpdateInstallQuit: () => false,
  })

  handler(first.event)
  handler(second.event)
  gate.acknowledge()
  await quitDone

  assert.equal(first.state.prevented, 1)
  assert.equal(second.state.prevented, 0)
  assert.deepEqual(sends, ['memory:flush-request'])
})

test('a cancelled quit re-arms the flush so the next quit waits again', async () => {
  const sends: string[] = []
  let quitCalls = 0
  const quitWaiters: Array<() => void> = []
  const nextQuit = () => new Promise<void>((resolve) => { quitWaiters.push(resolve) })
  const gate = createMemoryFlushAckGate()
  const first = createEvent()
  const handler = createMemoryQuitFlushHandler({
    getWindows: () => [createWindow(sends)],
    gate,
    timeoutMs: 1_000,
    quit: () => { quitCalls += 1; quitWaiters.shift()?.() },
    isUpdateInstallQuit: () => false,
  })

  const firstDone = nextQuit()
  handler(first.event)
  assert.equal(first.state.prevented, 1)
  gate.acknowledge()
  await firstDone

  // Another handler cancelled that quit: no will-quit follows, so the flush
  // gate must re-arm for the next quit attempt.
  await new Promise<void>((resolve) => setImmediate(resolve))

  const second = createEvent()
  const secondDone = nextQuit()
  handler(second.event)
  assert.equal(second.state.prevented, 1, 'the next quit waits for a fresh save')
  assert.deepEqual(sends, ['memory:flush-request', 'memory:flush-request'])
  assert.equal(quitCalls, 1, 'ack from the cancelled quit cannot release the next one')
  gate.acknowledge()
  await secondDone
  assert.equal(quitCalls, 2)
})

test('an updater error clears the install flag so the next normal quit waits for the save', async (t) => {
  process.env.NEXUS_MAC_AUTO_UPDATE_MODE = 'electron-updater'
  t.after(() => {
    delete process.env.NEXUS_MAC_AUTO_UPDATE_MODE
  })
  t.mock.timers.enable({ apis: ['setTimeout'] })

  const updater = await import('../electron/services/updaterService.js')
  updater.initAutoUpdater({ getWindows: () => [] })
  t.mock.timers.tick(8_000)

  // The installer starts its own quit, then fails before it can take over.
  autoUpdater.emit('before-quit-for-update')
  assert.equal(isUpdateInstallQuit(), true)
  autoUpdater.emit('error', new Error('installer failed'))
  assert.equal(isUpdateInstallQuit(), false)

  const sends: string[] = []
  let quitCalls = 0
  let resolveQuit = () => {}
  const quitDone = new Promise<void>((resolve) => { resolveQuit = resolve })
  const gate = createMemoryFlushAckGate()
  const { event, state } = createEvent()
  const handler = createMemoryQuitFlushHandler({
    getWindows: () => [createWindow(sends)],
    gate,
    timeoutMs: 2_500,
    quit: () => { quitCalls += 1; resolveQuit() },
    isUpdateInstallQuit,
  })

  handler(event)

  assert.equal(state.prevented, 1, 'the normal quit waits for the memory save')
  assert.deepEqual(sends, ['memory:flush-request'])
  assert.equal(quitCalls, 0, 'quit is held until the renderer acks')
  gate.acknowledge()
  await quitDone
  assert.equal(quitCalls, 1)
})

test('the 2500 ms quit budget holds at the boundary and an update install returns untouched', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })

  const installSends: string[] = []
  let installQuitCalls = 0
  const installEvent = createEvent()
  const installHandler = createMemoryQuitFlushHandler({
    getWindows: () => [createWindow(installSends)],
    gate: createMemoryFlushAckGate(),
    timeoutMs: 2_500,
    quit: () => { installQuitCalls += 1 },
    isUpdateInstallQuit: () => true,
  })

  assert.equal(installHandler(installEvent.event), undefined)
  assert.equal(installEvent.state.prevented, 0)
  assert.equal(installQuitCalls, 0)
  assert.deepEqual(installSends, [])

  const sends: string[] = []
  let quitCalls = 0
  let resolveQuit = () => {}
  const quitDone = new Promise<void>((resolve) => { resolveQuit = resolve })
  const { event, state } = createEvent()
  const handler = createMemoryQuitFlushHandler({
    getWindows: () => [createWindow(sends)],
    gate: createMemoryFlushAckGate(),
    timeoutMs: 2_500,
    quit: () => { quitCalls += 1; resolveQuit() },
    isUpdateInstallQuit: () => false,
  })

  handler(event)

  assert.equal(state.prevented, 1)
  assert.deepEqual(sends, ['memory:flush-request'])
  t.mock.timers.tick(2_499)
  assert.equal(quitCalls, 0)
  t.mock.timers.tick(1)
  return quitDone.then(() => {
    assert.equal(quitCalls, 1)
  })
})
