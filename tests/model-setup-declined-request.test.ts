import assert from 'node:assert/strict'
import { register } from 'node:module'
import { test } from 'node:test'

register(new URL('./helpers/window-ipc-stub-hooks.mjs', import.meta.url))

const { register: registerWindowIpc } = await import('../electron/ipc/windowIpc.js')

registerWindowIpc()

type MainProcessState = {
  handlers: Map<string, (event: unknown, payload?: unknown) => unknown>
  panelRequests: string[]
  panelShown: Array<{ section: string; options?: unknown }>
}

function mainProcessState(): MainProcessState {
  const state = (globalThis as unknown as { __nexusTestMainProcess?: MainProcessState })
    .__nexusTestMainProcess
  assert.ok(state, 'the main process stub state is missing')
  return state
}

function handler(channel: string) {
  const found = mainProcessState().handlers.get(channel)
  assert.ok(found, `the main process did not register the ${channel} handler`)
  return found
}

test('a declined installer never raises the chat panel for a later pet voice action', () => {
  const state = mainProcessState()
  const request = handler('window:request-model-setup')
  const decline = handler('window:decline-model-setup')
  const consume = handler('window:consume-model-setup-request')

  // The pet window asks for the installer while the models are missing.
  request({ sender: { id: 1 } }, {})

  assert.deepEqual(
    state.panelShown,
    [{ section: 'chat', options: undefined }],
    'the panel is raised for the offer',
  )
  assert.deepEqual(state.panelRequests, ['models:setup-requested'])
  assert.equal(consume({ sender: { id: 1 } }), true, 'the panel can claim the offer')

  // The user answers "maybe later" in the installer.
  decline({ sender: { id: 1 } })

  // The pet window asks again on the next mic press or double click.
  request({ sender: { id: 1 } }, {})

  assert.deepEqual(
    state.panelShown,
    [{ section: 'chat', options: undefined }],
    'the chat panel is not pulled to the front again',
  )
  assert.deepEqual(
    state.panelRequests,
    ['models:setup-requested'],
    'the request is not replayed to the panel',
  )
  assert.equal(consume({ sender: { id: 1 } }), false, 'no offer waits for the panel')
})
