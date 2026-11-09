import assert from 'node:assert/strict'
import { register } from 'node:module'
import { test } from 'node:test'

register(new URL('./helpers/window-ipc-stub-hooks.mjs', import.meta.url))

const { register: registerWindowIpc } = await import('../electron/ipc/windowIpc.js')
const { createModelSetupRequestStore } = await import('../src/features/setup/modelSetupRequests.ts')

registerWindowIpc()

type MainProcessState = {
  handlers: Map<string, (event: unknown, payload?: unknown) => unknown>
  panelRequests: string[]
  panelLoading: boolean
}

function state(): MainProcessState {
  const found = (globalThis as unknown as { __nexusTestMainProcess?: MainProcessState })
    .__nexusTestMainProcess
  assert.ok(found, 'the main process stub state is missing')
  return found
}

function handler(channel: string) {
  const found = state().handlers.get(channel)
  assert.ok(found, `the main process did not register the ${channel} handler`)
  return found
}

function resetPending() {
  handler('window:request-model-setup')({ sender: { id: 1 } }, { cancel: true })
  state().panelRequests.length = 0
}

test('a request that arrives before the panel subscribes stays pending and is acked once', () => {
  resetPending()
  const request = handler('window:request-model-setup')
  const consume = handler('window:consume-model-setup-request')
  const resolve = handler('window:resolve-model-setup-request')
  const sender = { sender: { id: 1 } }

  request(sender, {})
  assert.deepEqual(state().panelRequests, ['models:setup-requested'], 'the opportunistic push fires')

  assert.equal(consume(sender), true, 'a late subscriber pulls the lost push')
  assert.equal(consume(sender), true, 'the push and the pull do not spend the request')
  assert.equal(resolve(sender, { reason: 'shown' }), true, 'the renderer confirms the paint')

  assert.equal(consume(sender), false, 'a painted prompt is not replayed after reload')
})

test('a loading panel receives no push but still pulls the pending request', () => {
  resetPending()
  state().panelLoading = true
  const request = handler('window:request-model-setup')
  const consume = handler('window:consume-model-setup-request')
  const sender = { sender: { id: 1 } }

  request(sender, {})
  assert.deepEqual(state().panelRequests, [], 'a loading page would lose the event')
  assert.equal(consume(sender), true, 'the mount pull still finds the request')

  state().panelLoading = false
  request(sender, {})
  assert.deepEqual(state().panelRequests, ['models:setup-requested'], 'a loaded panel gets the live push')
  resetPending()
})

test('the renderer latch shows one prompt when push and pull race', () => {
  const store = createModelSetupRequestStore()
  let notifications = 0
  const unsubscribe = store.subscribe(() => { notifications += 1 })

  // The push event and the mount pull both land on the same latch.
  store.request()
  store.request()
  assert.equal(notifications, 1)
  assert.equal(store.hasRequest(), true)
  unsubscribe()
})

test('a reload before the paint keeps the request for the next panel', () => {
  resetPending()
  const request = handler('window:request-model-setup')
  const consume = handler('window:consume-model-setup-request')
  const resolve = handler('window:resolve-model-setup-request')
  const sender = { sender: { id: 1 } }

  request(sender, {})
  assert.equal(consume(sender), true, 'the first panel sees the pending request')
  // The first panel reloads before the overlay paints: no ack yet.
  assert.equal(consume(sender), true, 'the rebuilt panel still sees it exactly once')
  assert.equal(resolve(sender, { reason: 'shown' }), true)
  assert.equal(consume(sender), false)
})

test('the resolve payload rejects unknown fields and missing reasons', () => {
  const resolve = handler('window:resolve-model-setup-request')
  const sender = { sender: { id: 1 } }

  assert.throws(
    () => resolve(sender, { reason: 'shown', extra: true }),
    /not allowed/i,
  )
  assert.throws(
    () => resolve(sender, {}),
    /reason/i,
  )
  assert.throws(
    () => resolve(sender, { reason: 'later' }),
    /reason/i,
  )
})
