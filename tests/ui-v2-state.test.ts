import assert from 'node:assert/strict'
import test from 'node:test'
import {
  resolveCompanionSurfaceBasePhase,
  resolveCompanionSurfaceCaption,
  type CompanionSurfaceCaptionInput,
} from '../src/features/uiV2/state.ts'
import { getCaptionReadingDurationMs } from '../src/features/uiV2/caption.ts'
import { enMessages } from '../src/i18n/locales/en.ts'
import { jaMessages } from '../src/i18n/locales/ja.ts'
import { koMessages } from '../src/i18n/locales/ko.ts'
import { zhCNMessages } from '../src/i18n/locales/zh-CN.ts'
import { zhTWMessages } from '../src/i18n/locales/zh-TW.ts'

test('V2 companion phase follows real voice capture and playback', () => {
  assert.equal(resolveCompanionSurfaceBasePhase({ voiceState: 'idle' }), 'idle')
  assert.equal(resolveCompanionSurfaceBasePhase({ voiceState: 'listening' }), 'listening')
  assert.equal(resolveCompanionSurfaceBasePhase({ voiceState: 'processing' }), 'thinking')
  assert.equal(resolveCompanionSurfaceBasePhase({ voiceState: 'speaking' }), 'speaking')
})

test('assistant labels cannot impersonate microphone capture', () => {
  assert.equal(resolveCompanionSurfaceBasePhase({
    voiceState: 'idle',
    assistantActivity: 'listening',
  }), 'idle')
})

test('offline and error override lower-priority activity', () => {
  assert.equal(resolveCompanionSurfaceBasePhase({
    voiceState: 'speaking',
    presencePhase: 'offline',
  }), 'offline')
  assert.equal(resolveCompanionSurfaceBasePhase({
    voiceState: 'listening',
    chatError: 'connection failed',
  }), 'error')
})

test('busy assistant activity maps to thinking without fake character motion', () => {
  assert.equal(resolveCompanionSurfaceBasePhase({
    voiceState: 'idle',
    assistantActivity: 'searching',
  }), 'thinking')
})

test('V2 captions preserve classified errors and use neutral recovery fallbacks', async (t) => {
  const defaults = {
    phase: 'error',
    errorRecovery: 'Something went wrong.',
    offlineRecovery: 'Connection failed.',
  } satisfies CompanionSurfaceCaptionInput
  const cases: Array<{
    name: string
    input: Partial<CompanionSurfaceCaptionInput>
    expected: string
  }> = [
    {
      name: 'no-speech detail',
      input: { chatError: '  No speech detected. Try again.  ' },
      expected: 'No speech detected. Try again.',
    },
    {
      name: 'model unavailable detail',
      input: { chatError: 'The selected model is unavailable.' },
      expected: 'The selected model is unavailable.',
    },
    {
      name: 'network failure detail',
      input: { chatError: 'Network request failed.' },
      expected: 'Network request failed.',
    },
    {
      name: 'wake-word detail after blank chat error',
      input: { chatError: '   ', wakewordError: '  Wake-word service stopped.  ' },
      expected: 'Wake-word service stopped.',
    },
    {
      name: 'generic error fallback',
      input: { chatError: ' ', wakewordError: '\n' },
      expected: 'Something went wrong.',
    },
    {
      name: 'offline fallback ignores unrelated error details',
      input: {
        phase: 'offline',
        assistantReply: 'Your previous answer.',
        chatError: 'Network request failed.',
        wakewordError: 'Wake-word service stopped.',
      },
      expected: 'Connection failed.',
    },
    {
      name: 'existing assistant reply cannot overwrite a current error',
      input: { assistantReply: 'Your previous answer.', chatError: 'The selected model is unavailable.' },
      expected: 'The selected model is unavailable.',
    },
  ]

  for (const testCase of cases) {
    await t.test(testCase.name, () => {
      assert.equal(resolveCompanionSurfaceCaption({ ...defaults, ...testCase.input }), testCase.expected)
    })
  }
})

test('V2 recovery, connection-test, and authentication copy stays accurately scoped in every locale', () => {
  const locales = [enMessages, zhCNMessages, zhTWMessages, jaMessages, koMessages]
  const expected = [
    {
      error: 'Something went wrong. Check settings, then try again.',
      offline: 'Connection failed. Check settings, then try again.',
      testConnection: 'Connection test failed. Review the settings and try again.',
      auth: 'Authentication failed. Check whether the API key is correct and still valid.',
    },
    {
      error: '刚才出了点问题，可以检查设置后再试。',
      offline: '连接失败，可以检查设置后再试。',
      testConnection: '连接测试失败，请检查当前设置后重试。',
      auth: '身份验证失败，请检查 API Key 是否正确且仍然有效。',
    },
    {
      error: '剛才出了點問題，可以檢查設定後再試。',
      offline: '連線失敗，可以檢查設定後再試。',
      testConnection: '連線測試失敗，請檢查目前設定後再試。',
      auth: '身分驗證失敗，請檢查 API Key 是否正確且仍然有效。',
    },
    {
      error: '問題が発生しました。設定を確認して、もう一度お試しください。',
      offline: '接続に失敗しました。設定を確認して、もう一度お試しください。',
      testConnection: '接続テストに失敗しました。現在の設定を確認して、もう一度お試しください。',
      auth: '認証に失敗しました。APIキーが正しく、有効であることを確認してください。',
    },
    {
      error: '문제가 발생했어요. 설정을 확인한 뒤 다시 시도해 주세요.',
      offline: '연결에 실패했어요. 설정을 확인한 뒤 다시 시도해 주세요.',
      testConnection: '연결 테스트에 실패했어요. 현재 설정을 확인한 뒤 다시 시도해 주세요.',
      auth: '인증에 실패했어요. API 키가 올바르고 유효한지 확인해 주세요.',
    },
  ]

  locales.forEach((messages, index) => {
    assert.equal(messages['ui_v2.error_recovery'], expected[index].error)
    assert.equal(messages['ui_v2.offline_recovery'], expected[index].offline)
    assert.equal(messages['settings.test_connection.failed'], expected[index].testConnection)
    assert.equal(messages['humanize.auth_failed'], expected[index].auth)
    assert.notEqual(messages['ui_v2.error_recovery'], messages['voice.status.retry_unheard'])
    assert.notEqual(messages['ui_v2.error_recovery'], messages['voice.stt.error.no_speech'])
  })
})

test('V2 voice actions have accurate localized names in every locale', () => {
  const locales = [enMessages, zhCNMessages, zhTWMessages, jaMessages, koMessages]
  const expected = [
    ['Stop listening', 'Cancel reply', 'Interrupt response'],
    ['停止倾听', '取消回答', '打断回应'],
    ['停止聆聽', '取消回覆', '打斷回應'],
    ['聴くのを停止', '返信をキャンセル', '返答を中断'],
    ['듣기 중지', '답변 취소', '응답 중단'],
  ]

  locales.forEach((messages, index) => {
    assert.equal(messages['panel.voice.stop_listening'], expected[index][0])
    assert.equal(messages['panel.voice.cancel_reply'], expected[index][1])
    assert.equal(messages['panel.voice.interrupt_response'], expected[index][2])
  })
})

test('caption reading time is independent from the short done transition', () => {
  assert.equal(getCaptionReadingDurationMs('好的。'), 3000)
  assert.ok(getCaptionReadingDurationMs('这是一段更长的回复，需要给用户足够时间慢慢读完。') > 3000)
  assert.equal(getCaptionReadingDurationMs('很长'.repeat(200)), 12000)
})
