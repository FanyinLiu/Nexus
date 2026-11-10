import assert from 'node:assert/strict'
import { register } from 'node:module'
import { test } from 'node:test'

register(new URL('./helpers/window-ipc-stub-hooks.mjs', import.meta.url))

const mediaPermissionIpc = await import('../electron/ipc/mediaPermissionIpc.js')

type ForwardedRequest = {
  microphone: boolean
  screenContextActive: boolean
}

function installHandler() {
  const requests: ForwardedRequest[] = []
  const lifecycle = {
    inspectReadOnly: async (enabled: ForwardedRequest) => {
      requests.push(enabled)
      return { platform: 'darwin', microphone: 'denied', screenRecording: 'denied' }
    },
  }
  mediaPermissionIpc.register({ mediaPermissionLifecycle: lifecycle })
  const state = (globalThis as {
    __nexusTestMainProcess?: { handlers: Map<string, (event: unknown, payload: unknown) => unknown> }
  }).__nexusTestMainProcess
  const handler = state?.handlers.get('media-permission:status')
  assert.equal(typeof handler, 'function')
  return { requests, handler: handler! }
}

test('media-permission:status forwards only the features the caller says are on', async () => {
  const { requests, handler } = installHandler()

  await handler(undefined, { microphoneEnabled: true, screenContextActive: false })
  await handler(undefined, { microphoneEnabled: false, screenContextActive: true })

  assert.deepEqual(requests, [
    { microphone: true, screenContextActive: false },
    { microphone: false, screenContextActive: true },
  ])
})

test('media-permission:status rejects malformed feature flags', async () => {
  const { requests, handler } = installHandler()

  await assert.rejects(
    async () => handler(undefined, { microphoneEnabled: 'yes', screenContextActive: false }),
    /media permission status request/,
  )
  assert.deepEqual(requests, [])
})
