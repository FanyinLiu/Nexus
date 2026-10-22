import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { register } from 'node:module'
import { join } from 'node:path'
import { test } from 'node:test'

import { createModelSetupDeferralStore, MODEL_SETUP_DEFERRAL_FILE_NAME } from '../electron/services/modelSetupDeferralStore.js'
import { createModelSetupRequestGate } from '../electron/services/modelSetupRequestGate.js'

register(new URL('./helpers/window-ipc-stub-hooks.mjs', import.meta.url))

const { register: registerWindowIpc } = await import('../electron/ipc/windowIpc.js')

registerWindowIpc()

type MainProcessState = {
  handlers: Map<string, (event: unknown, payload?: unknown) => unknown>
  panelShown: Array<{ section: string; options?: unknown }>
  userData?: string
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

test('a declined installer reloads from disk and does not focus the panel', async () => {
  const state = mainProcessState()
  const decline = handler('window:decline-model-setup')
  const request = handler('window:request-model-setup')

  await decline({ sender: { id: 1 } })

  assert.ok(state.userData, 'the deferral file lives under userData')
  const file = join(state.userData, MODEL_SETUP_DEFERRAL_FILE_NAME)
  const saved = JSON.parse(readFileSync(file, 'utf8')) as { declined: boolean; reminded: boolean }
  assert.equal(saved.declined, true)
  assert.equal(saved.reminded, false, 'the reminder is still owed across the restart')

  // A new process reads the same file. The in-memory gate from this
  // process is not consulted.
  let focused = 0
  const store = createModelSetupDeferralStore({ getStorePath: () => file })
  const restarted = createModelSetupRequestGate({
    deliver: () => { focused += 1 },
    loadDeferral: () => store.load(),
    saveDeferral: (next) => store.save(next),
  })

  assert.equal(restarted.isDeclined(), true)
  assert.equal(restarted.request(), false)
  assert.equal(focused, 0, 'mic or double-click does not pull the chat panel forward')
  assert.equal(restarted.claimReminder(), true)
  await restarted.whenPersisted()

  const afterReminder = createModelSetupRequestGate({
    deliver: () => { focused += 1 },
    loadDeferral: () => createModelSetupDeferralStore({ getStorePath: () => file }).load(),
  })
  assert.equal(afterReminder.claimReminder(), false, 'the reminder is shown once in total')
  assert.equal(afterReminder.request(), false)
  assert.equal(focused, 0)

  const shownBefore = state.panelShown.length
  await request({ sender: { id: 1 } }, {})
  assert.equal(state.panelShown.length, shownBefore, 'the live gate does not focus the panel either')
})
