import assert from 'node:assert/strict'
import test from 'node:test'

import {
  BACKCHANNEL_GAIN,
  BACKCHANNEL_MIN_GAP_MS,
  BACKCHANNEL_MIN_SPOKEN_MS,
  BACKCHANNEL_PAUSE_MAX_MS,
  BACKCHANNEL_PAUSE_MIN_MS,
  BACKCHANNEL_TOKENS,
  decideBackchannel,
  normalizeBackchannelLanguage,
  selectBackchannelToken,
  type BackchannelInput,
} from '../src/features/voice/backchannelPolicy.ts'
import type { InterruptMicPolicyInput } from '../src/features/voice/autoRestartPolicy.ts'

const VOICE_MIC: InterruptMicPolicyInput = {
  source: 'voice',
  continuousActive: false,
  wakewordLive: false,
}

const TYPED_MIC: InterruptMicPolicyInput = {
  source: 'text',
  continuousActive: false,
  wakewordLive: false,
}

function input(overrides: Partial<BackchannelInput> = {}): BackchannelInput {
  return {
    enabled: true,
    micPolicy: VOICE_MIC,
    spokenMs: 3_000,
    pauseMs: 300,
    turnEndAction: 'wait',
    msSinceLastBackchannel: null,
    backchannelsInLast10s: 0,
    partialTranscript: '我今天想跟你说一件事',
    locale: 'zh-CN',
    modelProbability: null,
    ...overrides,
  }
}

test('backchannel is off by default', () => {
  const decision = decideBackchannel(input({ enabled: false }))
  assert.deepEqual(decision, { fire: false, reason: 'disabled' })
})

test('a typed turn never earns a backchannel', () => {
  const decision = decideBackchannel(input({ micPolicy: TYPED_MIC }))
  assert.deepEqual(decision, { fire: false, reason: 'mic-not-voice' })
})

test('the user must have been speaking for at least 2.5 s', () => {
  assert.deepEqual(
    decideBackchannel(input({ spokenMs: BACKCHANNEL_MIN_SPOKEN_MS - 1 })),
    { fire: false, reason: 'too-short-speech' },
  )

  const decision = decideBackchannel(input({ spokenMs: BACKCHANNEL_MIN_SPOKEN_MS }))
  assert.equal(decision.fire, true)
})

test('only a 250-450 ms pause counts; real speech and a finished turn do not', () => {
  for (const pauseMs of [BACKCHANNEL_PAUSE_MIN_MS - 1, BACKCHANNEL_PAUSE_MAX_MS + 1]) {
    assert.deepEqual(
      decideBackchannel(input({ pauseMs })),
      { fire: false, reason: 'not-a-pause' },
      String(pauseMs),
    )
  }

  for (const pauseMs of [BACKCHANNEL_PAUSE_MIN_MS, BACKCHANNEL_PAUSE_MAX_MS]) {
    assert.equal(decideBackchannel(input({ pauseMs })).fire, true, String(pauseMs))
  }

  assert.deepEqual(
    decideBackchannel(input({ turnEndAction: 'end' })),
    { fire: false, reason: 'turn-ended' },
  )
})

test('at most one backchannel per ten seconds, and never sooner than six seconds', () => {
  assert.deepEqual(
    decideBackchannel(input({ msSinceLastBackchannel: BACKCHANNEL_MIN_GAP_MS - 1 })),
    { fire: false, reason: 'rate-limited' },
  )
  assert.equal(
    decideBackchannel(input({ msSinceLastBackchannel: BACKCHANNEL_MIN_GAP_MS })).fire,
    true,
  )
  assert.deepEqual(
    decideBackchannel(input({ backchannelsInLast10s: 1 })),
    { fire: false, reason: 'rate-limited' },
  )
})

test('a fired decision carries a short token and a quiet gain, never the transcript', () => {
  const secret = '我的银行卡密码是 1234'
  const decision = decideBackchannel(input({ partialTranscript: secret }))

  assert.equal(decision.fire, true)
  if (!decision.fire) return
  assert.equal(decision.kind, 'narrative')
  assert.equal(decision.token, BACKCHANNEL_TOKENS['zh-CN'].narrative)
  assert.equal(decision.gain, BACKCHANNEL_GAIN)
  assert.equal(JSON.stringify(decision).includes(secret), false)
})

test('token choice follows question, agreement, and narrative partials per locale', () => {
  const cases = [
    { locale: 'zh-CN', question: '你明天有空吗', agree: '对，就是这样', narrative: '我今天去公园散步了' },
    { locale: 'zh-TW', question: '你明天有空嗎', agree: '對，就是這樣', narrative: '我今天去公園散步了' },
    { locale: 'en-US', question: 'Do you want tea', agree: 'right, exactly', narrative: 'I went for a walk today' },
    { locale: 'ja-JP', question: '明日は空いていますか', agree: 'はい、そうです', narrative: '今日は公園を散歩しました' },
    { locale: 'ko-KR', question: '내일 뭐 해요', agree: '네, 맞아요', narrative: '오늘 공원을 산책했어요' },
  ] as const

  for (const item of cases) {
    const language = normalizeBackchannelLanguage(item.locale)
    const tokens = BACKCHANNEL_TOKENS[language]

    assert.deepEqual(
      selectBackchannelToken(item.question, item.locale),
      { token: tokens.question, kind: 'question' },
      `${language} question`,
    )
    assert.deepEqual(
      selectBackchannelToken(item.agree, item.locale),
      { token: tokens.agree, kind: 'agree' },
      `${language} agreement`,
    )
    assert.deepEqual(
      selectBackchannelToken(item.narrative, item.locale),
      { token: tokens.narrative, kind: 'narrative' },
      `${language} narrative`,
    )
    assert.deepEqual(
      selectBackchannelToken('', item.locale),
      { token: tokens.narrative, kind: 'narrative' },
      `${language} empty`,
    )
  }
})

test('the audio model gates the backchannel for providers without partials', () => {
  // SenseVoice has no partial text: p < 0.5 is the only "still talking" cue.
  const unfinished = decideBackchannel(input({ partialTranscript: '', modelProbability: 0.2 }))
  assert.equal(unfinished.fire, true)

  const finished = decideBackchannel(input({ partialTranscript: '', modelProbability: 0.9 }))
  assert.deepEqual(finished, { fire: false, reason: 'turn-ended' })

  // A model that is still loading (null) must not suppress the old behavior.
  const unavailable = decideBackchannel(input({ partialTranscript: '', modelProbability: null }))
  assert.equal(unavailable.fire, true)

  // ...but an in-flight probe suppresses the acknowledgement until p is known.
  const pending = decideBackchannel(input({
    partialTranscript: '',
    modelProbability: null,
    modelPending: true,
  }))
  assert.deepEqual(pending, { fire: false, reason: 'model-pending' })
})

test('locale tags normalize to the five maintained token sets', () => {
  assert.equal(normalizeBackchannelLanguage('zh-TW'), 'zh-TW')
  assert.equal(normalizeBackchannelLanguage('zh-Hant'), 'zh-TW')
  assert.equal(normalizeBackchannelLanguage('zh-CN'), 'zh-CN')
  assert.equal(normalizeBackchannelLanguage('en-GB'), 'en')
  assert.equal(normalizeBackchannelLanguage('ja-JP'), 'ja')
  assert.equal(normalizeBackchannelLanguage('ko-KR'), 'ko')
  assert.equal(normalizeBackchannelLanguage('fr-FR'), 'en')
})
