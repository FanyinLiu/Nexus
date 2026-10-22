import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  createModelSetupRequestStore,
  hasModelSetupRequest,
  requestModelSetupOnVoiceUse,
  shouldRequestModelSetupForWakewordChange,
  subscribeModelSetupRequests,
} from '../src/features/setup/modelSetupRequests.ts'
import { shouldShowModelSetupOverlay } from '../src/features/setup/modelSetupState.ts'
import type { VoiceTriggerMode } from '../src/types/voice.ts'

const missingInventory = {
  suppressed: false,
  dismissed: false,
  inventoryReady: false,
}

function wakewordFlags(wakewordAlwaysOn: boolean, voiceTriggerMode: VoiceTriggerMode) {
  return { wakewordAlwaysOn, voiceTriggerMode }
}

test('finishing onboarding leaves the installer closed even while models are missing', () => {
  const store = createModelSetupRequestStore()

  assert.equal(store.hasRequest(), false)
  assert.equal(
    shouldShowModelSetupOverlay({ ...missingInventory, requested: store.hasRequest() }),
    false,
  )
})

test('the first voice use flips the latch once and notifies every mounted listener', () => {
  const store = createModelSetupRequestStore()
  const notified: string[] = []
  const unsubscribeFirst = store.subscribe(() => { notified.push('first') })
  store.subscribe(() => { notified.push('second') })

  store.request()
  store.request()

  assert.equal(store.hasRequest(), true)
  assert.deepEqual(notified, ['first', 'second'])

  unsubscribeFirst()
  store.request()
  assert.deepEqual(notified, ['first', 'second'])
})

test('a voice request opens setup only for missing models the user has not deferred', () => {
  const store = createModelSetupRequestStore()
  store.request()

  assert.equal(
    shouldShowModelSetupOverlay({ ...missingInventory, requested: store.hasRequest() }),
    true,
  )
  assert.equal(
    shouldShowModelSetupOverlay({
      ...missingInventory,
      requested: store.hasRequest(),
      dismissed: true,
    }),
    false,
  )
  assert.equal(
    shouldShowModelSetupOverlay({
      ...missingInventory,
      requested: store.hasRequest(),
      suppressed: true,
    }),
    false,
  )
  assert.equal(
    shouldShowModelSetupOverlay({
      ...missingInventory,
      requested: store.hasRequest(),
      inventoryReady: true,
    }),
    false,
  )
})

test('switching a wake-word control on counts as voice use', () => {
  assert.equal(
    shouldRequestModelSetupForWakewordChange(
      wakewordFlags(false, 'direct_send'),
      wakewordFlags(true, 'direct_send'),
    ),
    true,
  )
  assert.equal(
    shouldRequestModelSetupForWakewordChange(
      wakewordFlags(false, 'direct_send'),
      wakewordFlags(false, 'wake_word'),
    ),
    true,
  )
})

test('an already-enabled wake word does not reopen the installer on launch', () => {
  assert.equal(
    shouldRequestModelSetupForWakewordChange(
      wakewordFlags(true, 'direct_send'),
      wakewordFlags(true, 'direct_send'),
    ),
    false,
  )
  assert.equal(
    shouldRequestModelSetupForWakewordChange(
      wakewordFlags(true, 'wake_word'),
      wakewordFlags(true, 'wake_word'),
    ),
    false,
  )
  assert.equal(
    shouldRequestModelSetupForWakewordChange(
      wakewordFlags(false, 'wake_word'),
      wakewordFlags(false, 'direct_send'),
    ),
    false,
  )
})

test('the shared latch starts quiet and surfaces setup after the first voice action', () => {
  assert.equal(hasModelSetupRequest(), false)

  let overlayNotified = false
  const unsubscribe = subscribeModelSetupRequests(() => { overlayNotified = true })
  requestModelSetupOnVoiceUse()
  unsubscribe()

  assert.equal(hasModelSetupRequest(), true)
  assert.equal(overlayNotified, true)
  assert.equal(
    shouldShowModelSetupOverlay({ ...missingInventory, requested: hasModelSetupRequest() }),
    true,
  )
})
