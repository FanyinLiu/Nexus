import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  MODEL_SETUP_WAKEWORD_REQUEST_DELAY_MS,
  applyModelSetupWakewordChange,
  cancelModelSetupWakewordRequest,
  createModelSetupRequestStore,
  hasModelSetupRequest,
  requestModelSetupOnVoiceUse,
  requestModelSetupOnWakewordEnabled,
  resolveModelSetupRequestRoute,
  shouldCancelModelSetupForWakewordChange,
  shouldRequestModelSetupForWakewordChange,
  subscribeModelSetupRequests,
} from '../src/features/setup/modelSetupRequests.ts'
import { shouldShowModelSetupOverlay } from '../src/features/setup/modelSetupState.ts'
import { enMessages } from '../src/i18n/locales/en/index.ts'
import { jaMessages } from '../src/i18n/locales/ja/index.ts'
import { koMessages } from '../src/i18n/locales/ko/index.ts'
import { zhCNMessages } from '../src/i18n/locales/zh-CN/index.ts'
import { zhTWMessages } from '../src/i18n/locales/zh-TW/index.ts'
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

test('a wake-word request waits for the delay before the installer may cover the pet view', () => {
  const scheduled: Array<{ task: () => void; delayMs: number }> = []
  const store = createModelSetupRequestStore((task, delayMs) => {
    scheduled.push({ task, delayMs })
    return () => {}
  })
  const overlayVisible = () => shouldShowModelSetupOverlay({
    ...missingInventory,
    requested: store.hasRequest(),
  })

  store.requestAfter(MODEL_SETUP_WAKEWORD_REQUEST_DELAY_MS)

  // The instant Finish lands, the pet view is still alone on screen.
  assert.equal(store.hasRequest(), false)
  assert.equal(overlayVisible(), false)
  assert.equal(scheduled.length, 1)
  assert.equal(scheduled[0].delayMs, 3_000)

  scheduled[0].task()

  // A few seconds later the installer may offer itself.
  assert.equal(store.hasRequest(), true)
  assert.equal(overlayVisible(), true)
})

test('the mic button latches immediately and never takes the wake-word delay', () => {
  const scheduled: number[] = []
  const store = createModelSetupRequestStore((_task, delayMs) => {
    scheduled.push(delayMs)
    return () => {}
  })

  store.request()

  assert.equal(store.hasRequest(), true)
  assert.deepEqual(scheduled, [])
  assert.equal(
    shouldShowModelSetupOverlay({ ...missingInventory, requested: store.hasRequest() }),
    true,
  )
})

test('cancelling a deferred request keeps the installer quiet', () => {
  let pending: (() => void) | null = null
  const store = createModelSetupRequestStore((task) => {
    pending = task
    return () => { pending = null }
  })

  store.requestAfter(MODEL_SETUP_WAKEWORD_REQUEST_DELAY_MS)()

  assert.equal(pending, null)
  assert.equal(store.hasRequest(), false)
})

test('a pending wake-word request is cancelled on unmount', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let delivered = false

  requestModelSetupOnWakewordEnabled(() => { delivered = true })
  // The settings surface cancels from an unmount cleanup.
  cancelModelSetupWakewordRequest()

  t.mock.timers.tick(MODEL_SETUP_WAKEWORD_REQUEST_DELAY_MS)
  assert.equal(delivered, false)
})

test('switching the wake word off before the delay cancels the pending request', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let delivered = false
  requestModelSetupOnWakewordEnabled(() => { delivered = true })

  const outcome = applyModelSetupWakewordChange(
    wakewordFlags(true, 'wake_word'),
    wakewordFlags(false, 'direct_send'),
    {
      request: () => { requestModelSetupOnWakewordEnabled(() => { delivered = true }) },
      cancel: () => cancelModelSetupWakewordRequest(),
    },
  )

  assert.equal(outcome, 'cancel')
  t.mock.timers.tick(MODEL_SETUP_WAKEWORD_REQUEST_DELAY_MS)
  assert.equal(delivered, false)
})

test('saving with the wake word newly on schedules the delayed request and saving without it does not', () => {
  const scheduled: number[] = []
  const store = createModelSetupRequestStore((_task, delayMs) => {
    scheduled.push(delayMs)
    return () => {}
  })
  let cancels = 0
  const actions = {
    request: () => { store.requestAfter(MODEL_SETUP_WAKEWORD_REQUEST_DELAY_MS) },
    cancel: () => { cancels += 1 },
  }

  assert.equal(
    applyModelSetupWakewordChange(
      wakewordFlags(false, 'direct_send'),
      wakewordFlags(true, 'direct_send'),
      actions,
    ),
    'request',
  )
  assert.deepEqual(scheduled, [MODEL_SETUP_WAKEWORD_REQUEST_DELAY_MS])

  assert.equal(
    applyModelSetupWakewordChange(
      wakewordFlags(false, 'direct_send'),
      wakewordFlags(false, 'direct_send'),
      actions,
    ),
    'none',
  )
  assert.deepEqual(scheduled, [MODEL_SETUP_WAKEWORD_REQUEST_DELAY_MS])
  assert.equal(cancels, 0)
  assert.equal(store.hasRequest(), false)
})

test('wake-word off is detected as a cancel transition but never as a request', () => {
  assert.equal(
    shouldCancelModelSetupForWakewordChange(
      wakewordFlags(false, 'wake_word'),
      wakewordFlags(false, 'direct_send'),
    ),
    true,
  )
  assert.equal(
    shouldCancelModelSetupForWakewordChange(
      wakewordFlags(true, 'direct_send'),
      wakewordFlags(false, 'direct_send'),
    ),
    true,
  )
  assert.equal(
    shouldCancelModelSetupForWakewordChange(
      wakewordFlags(false, 'direct_send'),
      wakewordFlags(true, 'direct_send'),
    ),
    false,
  )
})

test('pet-side requests route to the panel while panel-side requests stay local', () => {
  assert.equal(resolveModelSetupRequestRoute('pet'), 'panel')
  assert.equal(resolveModelSetupRequestRoute('panel'), 'local')
})

test('the installer opens with the voice invite in every locale', () => {
  const dictionaries = [
    [zhCNMessages, '想跟我说话的话，要先装一下语音模型。'],
    [zhTWMessages, '想跟我說話的話，要先裝一下語音模型。'],
    [enMessages, 'Want to talk to me out loud? Install the voice models first.'],
    [jaMessages, '声で話したいなら、先に音声モデルを入れてね。'],
    [koMessages, '목소리로 대화하려면 먼저 음성 모델을 설치해 주세요.'],
  ] as const

  for (const [dictionary, expected] of dictionaries) {
    assert.equal(dictionary['model_setup.voice_invite'], expected)
  }
})
