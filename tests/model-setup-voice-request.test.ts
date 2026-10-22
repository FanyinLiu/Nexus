import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  applyModelSetupWakewordChange,
  createModelSetupRequestStore,
  hasModelSetupRequest,
  requestModelSetupOnVoiceUse,
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

test('the wake-word delay belongs to the main process, not to the request store', () => {
  const store = createModelSetupRequestStore()

  // Nothing latches here before the main process hands the request over, so
  // a saving surface that hides or reloads cannot lose the offer.
  assert.equal(store.hasRequest(), false)
  assert.equal(
    shouldShowModelSetupOverlay({ ...missingInventory, requested: store.hasRequest() }),
    false,
  )
})

test('the mic button latches immediately', () => {
  const store = createModelSetupRequestStore()

  store.request()

  assert.equal(store.hasRequest(), true)
  assert.equal(
    shouldShowModelSetupOverlay({ ...missingInventory, requested: store.hasRequest() }),
    true,
  )
})

test('switching the wake word off retracts the pending request', () => {
  let cancelled = 0
  const outcome = applyModelSetupWakewordChange(
    wakewordFlags(true, 'wake_word'),
    wakewordFlags(false, 'direct_send'),
    {
      request: () => {},
      cancel: () => { cancelled += 1 },
    },
  )

  assert.equal(outcome, 'cancel')
  assert.equal(cancelled, 1)
})

test('saving with the wake word newly on asks for setup and saving without it does not', () => {
  let requests = 0
  let cancels = 0
  const actions = {
    request: () => { requests += 1 },
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
  assert.equal(requests, 1)

  assert.equal(
    applyModelSetupWakewordChange(
      wakewordFlags(false, 'direct_send'),
      wakewordFlags(false, 'direct_send'),
      actions,
    ),
    'none',
  )
  assert.equal(requests, 1)
  assert.equal(cancels, 0)
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

test('the installer promises the one reminder in every locale', () => {
  const dictionaries = [
    [zhCNMessages, '先跳过也行 —— 下次想说话的时候我再提醒你一次。'],
    [zhTWMessages, '先跳過也行 —— 下次想說話的時候我再提醒你一次。'],
    [enMessages, 'Skip it for now — I will nudge you once next time you want to talk.'],
    [jaMessages, '今はスキップしても大丈夫 —— 次に話したくなったら一度だけ声をかけるね。'],
    [koMessages, '지금은 넘어가도 돼요 — 다음에 이야기하고 싶을 때 한 번만 알려드릴게요.'],
  ] as const

  for (const [dictionary, expected] of dictionaries) {
    assert.equal(dictionary['model_setup.dismiss_hint'], expected)
  }
})

test('the reminder and the missing-model lines point at Voice → Advanced', () => {
  const dictionaries = [
    [zhCNMessages, '语音还没装好，去「设置 → 语音 → 高级」里下载。', '语音组件没装好，重新安装一下应用就行。', '还差 {count} 个模型没装'],
    [zhTWMessages, '語音還沒裝好，去「設定 → 語音 → 進階」裡下載。', '語音元件沒裝好，重新安裝一下應用就行。', '還差 {count} 個模型沒裝'],
    [enMessages, 'Voice isn\'t ready yet. Download it in Settings → Voice → Advanced.', 'The voice piece isn\'t installed. Reinstall the app and it\'ll be ready.', '{count} model still isn\'t installed'],
    [jaMessages, '音声がまだ入ってないよ。「設定 → 音声 → 高度設定」でダウンロードしてね。', '音声の部品が入ってないみたい。アプリを入れ直してね。', 'まだ {count} 個のモデルが入っていないよ'],
    [koMessages, '음성이 아직 준비되지 않았어요. 「설정 → 음성 → 고급」에서 다운로드해 주세요.', '음성 부품이 설치되지 않았어요. 앱을 다시 설치하면 돼요.', '아직 모델 {count}개가 설치되지 않았어요'],
  ] as const

  for (const [dictionary, expected, nodeMissing, missingOne] of dictionaries) {
    assert.equal(dictionary['model_setup.deferred_reminder'], expected)
    assert.equal(dictionary['voice.provider.sensevoice.not_installed'], expected)
    assert.equal(dictionary['voice.provider.paraformer.model_missing'], expected)
    assert.equal(dictionary['voice.provider.sensevoice.node_missing'], nodeMissing)
    assert.equal(dictionary['settings.voice.status_models_missing_one'], missingOne)
    assert.ok(expected.includes(dictionary['settings.title']))
    assert.ok(expected.includes(dictionary['settings.simple.voice']))
    assert.ok(expected.includes(dictionary['settings.voice.advanced_title']))
    assert.doesNotMatch(nodeMissing, /npm|sherpa/i)
    if (dictionary === enMessages) {
      assert.equal(
        dictionary['settings.voice.status_models_missing_other'],
        '{count} models still aren\'t installed',
      )
    } else {
      assert.equal(dictionary['settings.voice.status_models_missing_other'], missingOne)
    }
  }
})
