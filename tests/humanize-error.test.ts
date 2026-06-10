import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
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
// humanizeError(caught, 'chat') for every user-facing surface. Two layers
// keep this honest: the source-pinning test below asserts the literals still
// exist in chatIpc.js (so rewording the backend copy fails HERE, not silently
// in front of the user), and the mapping tests assert each pinned string
// resolves to the right advice.
describe('humanizeError — real chat-send backend strings', () => {
  test('pinned backend strings still exist in chatIpc.js source', () => {
    // chatIpc.js imports 'electron' so it can't be imported under node:test —
    // pin the copy at the source-text level instead.
    const source = readFileSync(new URL('../electron/ipc/chatIpc.js', import.meta.url), 'utf8')
    const pinned = [
      '模型接口鉴权失败，请检查 API Key 是否有效。',
      '还没有填写 API Key，所以现在还不能对话。请先在设置里填入可用的 API Key。',
      '模型请求失败（状态码：',
      '模型接口连接失败，请检查 API Base URL、网络或代理设置。原始错误：',
      '模型响应超时，请检查网络、代理或当前模型服务状态。',
    ]
    for (const literal of pinned) {
      assert.ok(source.includes(literal), `chatIpc.js no longer contains pinned copy: ${literal}`)
    }
  })

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

  test('backend timeout copy maps to the dedicated timeout advice, not the generic fallback', () => {
    const out = humanizeError('模型响应超时，请检查网络、代理或当前模型服务状态。', 'chat')
    assert.match(out, /(too long|faster|try)/i)
    assert.doesNotMatch(out, /Something went wrong/)
  })

  test('backend connection-failure copy maps to reachability advice even without an ASCII errno', () => {
    const out = humanizeError('模型接口连接失败，请检查 API Base URL、网络或代理设置。原始错误：terminated', 'chat')
    assert.match(out, /(reach|connect|server)/i)
    assert.doesNotMatch(out, /Something went wrong/)
  })

  test('undici mid-stream drop ("other side closed") maps to connection-dropped advice', () => {
    const out = humanizeError(new Error('fetch failed: other side closed'), 'chat')
    assert.match(out, /(dropped|connection|try again)/i)
  })

  test('unmatched chat error redacts an API secret in the fallback', () => {
    const out = humanizeError(new Error('upstream blew up token sk-ABCDEF1234567890XYZ tail'), 'chat')
    assert.match(out, /Something went wrong/)
    assert.match(out, /sk-\*\*\*/)
    assert.doesNotMatch(out, /sk-ABCDEF1234567890XYZ/)
  })
})

describe('humanizeError — failover aggregate errors', () => {
  test('multi-candidate aggregate is classified by the FIRST line, not a later candidate', () => {
    // Primary failed with a rate limit; a secondary candidate's message
    // mentions "API Key". The advice must describe the primary failure —
    // before the fix this returned bad-key advice ("check your API key").
    const aggregate = 'openai: 模型请求失败（状态码：429）\ndeepseek: 还没有填写 API Key，所以现在还不能对话。'
    const out = humanizeError(new Error(aggregate), 'chat')
    assert.match(out, /(too many|wait|moment)/i)
    assert.doesNotMatch(out, /API key/i)
  })

  test('single-line errors are unaffected by the first-line rule', () => {
    const out = humanizeError('还没有填写 API Key，所以现在还不能对话。', 'chat')
    assert.match(out, /(API key|Settings)/i)
  })
})

describe('humanizeError — secret redaction in the fallback path', () => {
  const cases: Array<{ name: string; input: string; leaked: RegExp; redacted: RegExp }> = [
    {
      name: 'Google AIza key (Gemini)',
      input: 'bad upstream cfg AIzaSyD-9tSrke72PouQMnMX-a7eZSW0jkFMBWY end',
      leaked: /AIzaSyD-9tSrke72PouQMnMX/,
      redacted: /AIza\*\*\*/,
    },
    {
      name: 'JWT api key (MiniMax-style)',
      input: 'upstream rejected eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJrbGVpbiJ9.c2lnbmF0dXJlLXBhcnQ tail',
      leaked: /eyJhbGciOiJSUzI1NiIs/,
      redacted: /jwt\*\*\*/,
    },
    {
      name: 'xAI key',
      input: 'provider said: invalid credential xai-AbCd1234EfGh5678IjKl in request',
      leaked: /xai-AbCd1234EfGh5678IjKl/,
      redacted: /xai-\*\*\*/,
    },
    {
      name: 'api_key query parameter',
      input: 'request rejected for /v1/chat?api_key=9f8e7d6c5b4a3210 upstream',
      leaked: /9f8e7d6c5b4a3210/,
      redacted: /api_key=\*\*\*/,
    },
    {
      name: 'URL userinfo credentials',
      input: 'proxy refused https://klein:hunter2@my-proxy.example.com:8443 upstream',
      leaked: /hunter2/,
      redacted: /\*\*\*:\*\*\*@my-proxy\.example\.com/,
    },
  ]

  for (const { name, input, leaked, redacted } of cases) {
    test(`${name} never reaches the user verbatim`, () => {
      const out = humanizeError(new Error(input), 'chat')
      assert.doesNotMatch(out, leaked)
      assert.match(out, redacted)
    })
  }
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
