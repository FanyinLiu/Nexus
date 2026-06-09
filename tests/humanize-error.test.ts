import assert from 'node:assert/strict'
import { before, describe, test } from 'node:test'

import { humanizeError } from '../src/lib/humanizeError.ts'
import { ensureLocaleLoaded, setLocale } from '../src/i18n/runtime.ts'

// Force English so the regex assertions below are deterministic. The
// production code path picks the user's actual locale; this test just
// verifies the dispatcher logic + fallbacks regardless of language.
before(async () => {
  await ensureLocaleLoaded('en-US')
  setLocale('en-US')
})

describe('humanizeError — common patterns', () => {
  test('401 errors become friendly auth-failed message', () => {
    const out = humanizeError('Request failed: 401 Unauthorized')
    assert.match(out, /API key/i)
    assert.doesNotMatch(out, /401|Unauthorized/i)
  })

  test('ECONNREFUSED becomes friendly server-down message', () => {
    const out = humanizeError(new Error('ECONNREFUSED 127.0.0.1:11434'))
    assert.match(out, /(reach|connect|server)/i)
    assert.doesNotMatch(out, /ECONNREFUSED/)
  })

  test('ETIMEDOUT becomes friendly timeout message', () => {
    const out = humanizeError(new Error('Request timed out after 30s'))
    assert.match(out, /(too long|response|try)/i)
  })

  test('rate limit errors mention waiting', () => {
    const out = humanizeError('429 Too Many Requests')
    assert.match(out, /(too many|wait|moment)/i)
  })

  test('5xx errors get friendly server-side wrapper', () => {
    const out = humanizeError('502 Bad Gateway')
    assert.match(out, /(provider|trouble|usually)/i)
  })

  test('aborted errors recognize cancellation', () => {
    const out = humanizeError(new Error('AbortError: The operation was aborted'))
    assert.match(out, /(stopped|abort|cancel)/i)
  })
})

describe('humanizeError — context-specific', () => {
  test('chat context recognizes "model not found"', () => {
    const out = humanizeError('The model `foo-bar` does not exist', 'chat')
    assert.match(out, /(model|Settings)/i)
  })

  test('voice context recognizes mic permission', () => {
    const out = humanizeError(new Error('NotAllowedError: Permission denied'), 'voice')
    assert.match(out, /(microphone|mic|permission|access)/i)
  })

  test('voice context recognizes missing mic', () => {
    const out = humanizeError(new Error('Requested device not found'), 'voice')
    assert.match(out, /(microphone|plugged|input)/i)
  })

  test('stt context catches missing local model', () => {
    const out = humanizeError(new Error('Wake-word model is not installed'), 'stt')
    assert.match(out, /(model|install|download|Settings)/i)
  })

  test('model context recognizes disk-full', () => {
    const out = humanizeError(new Error('ENOSPC: no space left on device'), 'model')
    assert.match(out, /(disk|space|free)/i)
  })
})

// These are the EXACT strings electron/ipc/chatIpc.js throws on a failed chat
// send. assistantReply.ts now routes the caught error through
// humanizeError(caught, 'chat') for every user-facing surface, so this block
// is the contract: if the backend copy changes in a way that stops matching,
// the user goes back to seeing raw provider text and these tests catch it.
describe('humanizeError — real chat-send backend strings', () => {
  test('401 auth message (contains "API Key") → bad-key advice, key text dropped', () => {
    const out = humanizeError('模型接口鉴权失败，请检查 API Key 是否有效。', 'chat')
    assert.match(out, /(API key|Settings)/i)
    assert.doesNotMatch(out, /鉴权失败/)
  })

  test('missing-key 401 message also maps to bad-key advice', () => {
    const out = humanizeError('还没有填写 API Key，所以现在还不能对话。请先在设置里填入可用的 API Key。', 'chat')
    assert.match(out, /(API key|Settings)/i)
  })

  test('404 status-code fallback → "check URL / model" advice', () => {
    const out = humanizeError('模型请求失败（状态码：404）', 'chat')
    assert.match(out, /(URL|model|address)/i)
    assert.doesNotMatch(out, /状态码/)
  })

  test('429 status-code fallback → rate-limit advice', () => {
    const out = humanizeError('模型请求失败（状态码：429）', 'chat')
    assert.match(out, /(too many|wait|moment)/i)
  })

  test('connection-failure wrapper → reachability advice, raw host dropped', () => {
    const out = humanizeError('模型接口连接失败，请检查 API Base URL、网络或代理设置。原始错误：ECONNREFUSED 127.0.0.1:11434', 'chat')
    assert.match(out, /(reach|connect|server)/i)
    assert.doesNotMatch(out, /ECONNREFUSED/)
  })

  test('unmatched chat error redacts an API secret in the fallback', () => {
    const out = humanizeError(new Error('upstream blew up token sk-ABCDEF1234567890XYZ tail'), 'chat')
    assert.match(out, /Something went wrong/)
    assert.match(out, /sk-\*\*\*/)
    assert.doesNotMatch(out, /sk-ABCDEF1234567890XYZ/)
  })
})

describe('humanizeError — fallbacks', () => {
  test('unknown error wrapped friendly with raw text in parens', () => {
    const out = humanizeError(new Error('Some weird internal thing happened'))
    assert.match(out, /Something went wrong/)
    assert.match(out, /Some weird internal thing happened/)
  })

  test('non-Error values handled', () => {
    assert.match(humanizeError('plain string error'), /plain string error/)
    assert.match(humanizeError({ obj: 'thing' } as unknown), /Something went wrong/)
    assert.match(humanizeError(null), /Something went wrong/)
    assert.match(humanizeError(undefined), /Something went wrong/)
  })

  test('empty error message gets a placeholder, not a blank screen', () => {
    const out = humanizeError(new Error(''))
    assert.ok(out.length > 0)
    assert.match(out, /Something went wrong/)
  })

  test('context-specific patterns take priority over common patterns', () => {
    // "model not found" in chat context should hit chat.model_unavailable,
    // not the generic 404 / not_found pattern.
    const out = humanizeError('Error: model gpt-9 not found', 'chat')
    assert.match(out, /Settings.*Model/i)
  })
})
