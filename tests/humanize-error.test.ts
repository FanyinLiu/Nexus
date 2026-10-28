import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { before, describe, test } from 'node:test'

import { humanizeError, humanizeMicPermissionError, lookupTranslation } from '../src/lib/humanizeError.ts'
import { voiceDownloadGuidance } from '../src/features/setup/voiceDownloadGuidance.ts'
import { ensureLocaleLoaded, setLocale, t } from '../src/i18n/runtime.ts'
import { enMessages } from '../src/i18n/locales/en/index.ts'
import { jaMessages } from '../src/i18n/locales/ja/index.ts'
import { koMessages } from '../src/i18n/locales/ko/index.ts'
import { zhCNMessages } from '../src/i18n/locales/zh-CN/index.ts'
import { zhTWMessages } from '../src/i18n/locales/zh-TW/index.ts'
import type { TranslationKey } from '../src/types/i18n.ts'

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

  test('voice mic permission copy follows the platform variant', () => {
    const denied = new Error('NotAllowedError: Permission denied')

    assert.equal(
      humanizeError(denied, 'voice', { platform: 'darwin' }),
      enMessages['humanize.voice.mic_permission_mac'],
    )
    assert.equal(
      humanizeError(denied, 'voice', { platform: 'win32' }),
      enMessages['humanize.voice.mic_permission_windows'],
    )
    assert.equal(
      humanizeError(denied, 'voice', { platform: 'linux' }),
      enMessages['humanize.voice.mic_permission'],
    )
    assert.equal(
      humanizeError(denied, 'voice', { platform: 'unknown' }),
      enMessages['humanize.voice.mic_permission'],
    )
  })

  test('voice context recognizes missing mic', () => {
    const out = humanizeError(new Error('Requested device not found'), 'voice')
    assert.match(out, /(microphone|plugged|input)/i)
  })

  test('stt context catches missing local model', () => {
    const out = humanizeError(new Error('Wake-word model is not installed'), 'stt')
    assert.match(out, /(model|install|download|Settings)/i)
  })

  test('stt model-missing copy matches the rendered SenseVoice not-installed sentence', () => {
    const out = humanizeError(new Error('Wake-word model is not installed'), 'stt')
    const expected = voiceDownloadGuidance(
      (key, params) => t(key, params),
      'voice.provider.sensevoice.not_installed',
    )
    assert.equal(out, expected)
    assert.doesNotMatch(out, /[{}]/)
  })

  test('model context recognizes disk-full', () => {
    const out = humanizeError(new Error('ENOSPC: no space left on device'), 'model')
    assert.match(out, /(disk|space|free)/i)
  })
})

// getUserMedia denials arrive as DOMExceptions whose message is the bare
// English "Permission denied". The helper must classify on `name` as well as
// `message` and always return the platform sentence, never the raw text.
describe('humanizeMicPermissionError', () => {
  const platformCases = [
    { platform: 'darwin', key: 'humanize.voice.mic_permission_mac' },
    { platform: 'win32', key: 'humanize.voice.mic_permission_windows' },
    { platform: 'linux', key: 'humanize.voice.mic_permission' },
    { platform: 'unknown', key: 'humanize.voice.mic_permission' },
  ] as const

  const deniedErrors = [
    {
      name: 'plain Error with the Chromium message',
      error: new Error('Permission denied'),
    },
    {
      name: 'DOMException with NotAllowedError name',
      error: new DOMException('Permission denied', 'NotAllowedError'),
    },
    {
      name: 'NotAllowedError name with an unrelated message',
      error: Object.assign(new Error('The request is not allowed by the user agent'), {
        name: 'NotAllowedError',
      }),
    },
    {
      name: 'PermissionDeniedError name with an unrelated message',
      error: Object.assign(new Error('User denied access'), { name: 'PermissionDeniedError' }),
    },
  ]

  for (const { name, error } of deniedErrors) {
    test(`${name} maps to the per-platform sentence and never the raw text`, () => {
      for (const { platform, key } of platformCases) {
        const out = humanizeMicPermissionError(error, { platform })
        assert.equal(out, enMessages[key], `${name} / ${platform}`)
        assert.doesNotMatch(out ?? '', /Permission denied/)
      }
    })
  }

  test('non-permission errors return null', () => {
    assert.equal(humanizeMicPermissionError(new Error('Requested device not found')), null)
    assert.equal(humanizeMicPermissionError(new Error('Could not start audio source')), null)
    assert.equal(humanizeMicPermissionError(new Error('Some unrelated failure')), null)
    assert.equal(humanizeMicPermissionError('plain string error'), null)
    assert.equal(humanizeMicPermissionError(null), null)
    assert.equal(humanizeMicPermissionError(undefined), null)
    assert.equal(humanizeMicPermissionError({ message: 'Permission denied' }), null)
  })
})

// Product decision: the dictation-model error reuses the SenseVoice
// "not installed" sentence verbatim, so every surface gives the user the
// same instruction for a missing local speech model. ja is the exception:
// plain "音声" leaves it unclear whether the recogniser or the voice is
// missing, so that sentence names 音声認識モデル instead.
describe('humanizeError — stt model_missing matches SenseVoice not_installed', () => {
  const locales = [
    { name: 'zh-CN', messages: zhCNMessages },
    { name: 'zh-TW', messages: zhTWMessages },
    { name: 'en', messages: enMessages },
    { name: 'ko', messages: koMessages },
  ]

  for (const { name, messages } of locales) {
    test(`${name}: humanize.stt.model_missing equals voice.provider.sensevoice.not_installed`, () => {
      assert.equal(
        messages['humanize.stt.model_missing'],
        messages['voice.provider.sensevoice.not_installed'],
      )
    })
  }

  test('ja: names the speech recognition model and keeps the download path', () => {
    const message = jaMessages['humanize.stt.model_missing']
    assert.match(message, /音声認識モデル/)
    for (const placeholder of ['{settings}', '{voice}', '{advanced}']) {
      assert.ok(message.includes(placeholder), `ja stt.model_missing lost ${placeholder}`)
    }
  })

  test('English fallback equals the en SenseVoice sentence', () => {
    // The fallback table is module-private, so pin its literal from source.
    const source = readFileSync(new URL('../src/lib/humanizeError.ts', import.meta.url), 'utf8')
    const fallback = source.match(/'humanize\.stt\.model_missing':\s*'((?:[^'\\]|\\.)*)'/)
    assert.ok(fallback, 'humanizeError.ts no longer declares the stt.model_missing fallback')
    assert.equal(fallback[1].replace(/\\'/g, "'"), enMessages['voice.provider.sensevoice.not_installed'])
  })

  for (const { name, locale } of [
    { name: 'en', locale: 'en-US' },
    { name: 'zh-CN', locale: 'zh-CN' },
  ]) {
    test(`${name}: rendered model_missing equals the rendered not_installed sentence`, async () => {
      await ensureLocaleLoaded(locale)
      setLocale(locale)
      try {
        const expected = voiceDownloadGuidance(
          (key, params) => t(key, params),
          'voice.provider.sensevoice.not_installed',
        )
        const out = humanizeError(new Error('Wake-word model is not installed'), 'stt')
        assert.equal(out, expected)
        assert.doesNotMatch(out, /[{}]/)
      } finally {
        setLocale('en-US')
      }
    })
  }
})

// Product decision: every microphone-permission surface reuses the canonical
// `voice.mic.permission_denied*` sentences so the user reads the same
// instruction no matter which layer reported the denial.
describe('microphone permission sentences are identical across surfaces', () => {
  const locales = [
    { name: 'zh-CN', messages: zhCNMessages },
    { name: 'zh-TW', messages: zhTWMessages },
    { name: 'en', messages: enMessages },
    { name: 'ja', messages: jaMessages },
    { name: 'ko', messages: koMessages },
  ]
  const surfaces = [
    'humanize.voice.mic_permission',
    'voice.provider.api.permission_denied',
    'voice.stt.error.permission_denied',
  ] as const
  const variants = ['', '_mac', '_windows'] as const

  for (const { name, messages } of locales) {
    test(`${name}: every mic permission surface reuses voice.mic.permission_denied*`, () => {
      for (const surface of surfaces) {
        for (const variant of variants) {
          assert.equal(
            messages[`${surface}${variant}`],
            messages[`voice.mic.permission_denied${variant}`],
            `${surface}${variant}`,
          )
        }
      }
    })
  }

  test('English fallbacks carry all three platform sentences', () => {
    // The fallback table is module-private, so pin its literals from source.
    const source = readFileSync(new URL('../src/lib/humanizeError.ts', import.meta.url), 'utf8')
    for (const variant of variants) {
      const key = `humanize.voice.mic_permission${variant}`
      const pattern = new RegExp(`'${key.replace(/\./g, '\\.')}':\\s*'((?:[^'\\\\]|\\\\.)*)'`)
      const fallback = source.match(pattern)
      assert.ok(fallback, `humanizeError.ts no longer declares the ${key} fallback`)
      assert.equal(fallback[1].replace(/\\'/g, "'"), enMessages[key])
    }
  })
})

// electron/ipc/chatIpc.js throws stable NEXUS_ERR_CHAT_* codes embedded in
// the error message (Electron IPC serialization drops custom properties, so
// the token rides in the message — see shared/chatErrorCodes.js).
// assistantReply.ts routes the caught error through humanizeError(caught,
// 'chat') for every user-facing surface. Two layers keep this honest: the
// source-pinning test below asserts chatIpc.js still throws the codes, and
// the mapping tests assert each code resolves to the same advice the old
// Chinese copy mapped to.
describe('humanizeError — chat IPC error codes', () => {
  test('pinned backend error codes still exist in chatIpc.js source', () => {
    // chatIpc.js imports 'electron' so it can't be imported under node:test —
    // pin the codes at the source-text level instead.
    const source = readFileSync(new URL('../electron/ipc/chatIpc.js', import.meta.url), 'utf8')
    const pinned = [
      'CHAT_IPC_ERROR_CODES.AUTH_FAILED',
      'CHAT_IPC_ERROR_CODES.MISSING_API_KEY',
      'CHAT_IPC_ERROR_CODES.TIMEOUT',
      'CHAT_IPC_ERROR_CODES.EMPTY_CONTENT',
      'classifyChatTransportFailure',
    ]
    for (const literal of pinned) {
      assert.ok(source.includes(literal), `chatIpc.js no longer throws pinned code: ${literal}`)
    }
  })

  test('401 auth code → bad-key advice', () => {
    const out = humanizeError(new Error('NEXUS_ERR_CHAT_AUTH_FAILED: provider returned HTTP 401'), 'chat')
    assert.match(out, /(API key|Settings)/i)
  })

  test('missing-key code also maps to bad-key advice', () => {
    const out = humanizeError(new Error('NEXUS_ERR_CHAT_MISSING_API_KEY: provider returned HTTP 401'), 'chat')
    assert.match(out, /(API key|Settings)/i)
  })

  test('header-unsafe key code also maps to bad-key advice', () => {
    const out = humanizeError('NEXUS_ERR_CHAT_API_KEY_HEADER_UNSAFE: settings.chat_connection.api_key_header_unsafe', 'chat')
    assert.match(out, /(API key|Settings)/i)
  })

  test('404 status code → "check URL / model" advice', () => {
    const out = humanizeError('NEXUS_ERR_CHAT_NOT_FOUND: provider returned HTTP 404 without an error body', 'chat')
    assert.match(out, /(URL|model|address)/i)
  })

  test('429 status code → rate-limit advice', () => {
    const out = humanizeError('NEXUS_ERR_CHAT_RATE_LIMITED: provider returned HTTP 429 without an error body', 'chat')
    assert.match(out, /(too many|wait|moment)/i)
  })

  test('5xx status code → server-side advice', () => {
    const out = humanizeError('NEXUS_ERR_CHAT_PROVIDER_SERVER_ERROR: provider returned HTTP 502 without an error body', 'chat')
    assert.match(out, /(provider|trouble|usually)/i)
  })

  test('unbucketed status code → generic fallback keeping the status detail', () => {
    const out = humanizeError('NEXUS_ERR_CHAT_PROVIDER_STATUS: provider returned HTTP 302 without an error body', 'chat')
    assert.match(out, /Something went wrong/)
    assert.match(out, /302/)
  })

  test('unreachable code → reachability advice, raw host dropped', () => {
    const out = humanizeError('NEXUS_ERR_CHAT_UNREACHABLE: chat request failed: ECONNREFUSED 127.0.0.1:11434', 'chat')
    assert.match(out, /(reach|connect|server)/i)
    assert.doesNotMatch(out, /ECONNREFUSED/)
  })

  test('timeout code maps to the dedicated timeout advice, not the generic fallback', () => {
    const out = humanizeError('NEXUS_ERR_CHAT_TIMEOUT: chat request failed: request timed out', 'chat')
    assert.match(out, /(too long|faster|try)/i)
    assert.doesNotMatch(out, /Something went wrong/)
  })

  test('codes survive Electron "Error invoking remote method" wrapping', () => {
    // ipcMain.handle serializes thrown errors as
    // `Error invoking remote method '<channel>': Error: <message>` — the code
    // token inside the message is the only part that must keep classifying.
    const out = humanizeError(
      new Error("Error invoking remote method 'chat:complete': Error: NEXUS_ERR_CHAT_TIMEOUT: chat request failed: request timed out"),
      'chat',
    )
    assert.match(out, /(too long|faster)/i)
    assert.doesNotMatch(out, /reach the server/i)
  })

  test('same-process errors classify on the code property', () => {
    const out = humanizeError(Object.assign(new Error('safe'), { code: 'NEXUS_ERR_CHAT_AUTH_FAILED' }), 'chat')
    assert.match(out, /(API key|Settings)/i)
  })

  test('unknown NEXUS codes fall through to the generic fallback', () => {
    const out = humanizeError('NEXUS_ERR_CHAT_FUTURE_CODE: something new happened', 'chat')
    assert.match(out, /Something went wrong/)
    assert.match(out, /something new happened/)
  })

  test('empty-content code → compatibility advice', () => {
    const out = humanizeError('NEXUS_ERR_CHAT_EMPTY_CONTENT: model returned empty content (finishReason=stop)', 'chat')
    assert.match(out, /(empty|compatible|different model)/i)
    assert.doesNotMatch(out, /Something went wrong/)
  })

  test('unsafe-base-url code keeps the redacted detail in the fallback', () => {
    const out = humanizeError('NEXUS_ERR_CHAT_UNSAFE_BASE_URL: API base URL rejected (private-network)', 'chat')
    assert.match(out, /Something went wrong/)
    assert.match(out, /private-network/)
  })

  test('a provider body merely containing "terminated" is not misread as a dropped connection', () => {
    const out = humanizeError(new Error('Your account has been terminated for violating our usage policies.'), 'chat')
    assert.doesNotMatch(out, /dropped/i)
    // The real (redacted) reason stays visible via the fallback.
    assert.match(out, /terminated for violating/)
  })

  test('unreachable code maps to reachability advice even without an ASCII errno', () => {
    const out = humanizeError('NEXUS_ERR_CHAT_UNREACHABLE: chat stream request failed: terminated', 'chat')
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

  test('chat path does not classify leftover Chinese timeout copy as the contract', () => {
    const out = humanizeError('模型回复太慢了，看看网络和服务有没有问题？', 'chat')
    assert.doesNotMatch(out, /(too long|faster)/i)
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

// Built at runtime so the test source never contains a contiguous
// Google-key-shaped literal — GitHub secret scanning (and the AIza rule in
// scripts/prerelease-check.mjs) pattern-match the joined 39-char form.
const FAKE_GOOGLE_KEY = ['AIza', 'Sy' + 'Fake'.repeat(8) + '0'].join('')

describe('humanizeError — secret redaction in the fallback path', () => {
  const cases: Array<{ name: string; input: string; leaked: RegExp; redacted: RegExp }> = [
    {
      name: 'Google AIza key (Gemini)',
      input: `bad upstream cfg ${FAKE_GOOGLE_KEY} end`,
      leaked: /Fake/,
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
    {
      // \b fails after '_', so snake_case OAuth param names need the
      // suffix-based rule — these two leaked before it.
      name: 'client_secret parameter',
      input: 'oauth exchange rejected: client_secret=sup3rs3cr3tvalue at provider',
      leaked: /sup3rs3cr3tvalue/,
      redacted: /client_secret=\*\*\*/,
    },
    {
      name: 'refresh_token parameter',
      input: 'grant rejected upstream refresh_token=1Gx9wq8Zr2 here',
      leaked: /1Gx9wq8Zr2/,
      redacted: /refresh_token=\*\*\*/,
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
  test('missing key never returns the raw error detail', () => {
    const out = lookupTranslation(
      'humanize.__missing_key__' as TranslationKey,
      'ECONNREFUSED 127.0.0.1:11434',
    )
    assert.equal(out, 'Something went wrong. Please try again.')
    assert.doesNotMatch(out, /ECONNREFUSED|127\.0\.0\.1/)
  })

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

// Every locale must produce its own platform-specific privacy-pane sentence
// for a denied mic — the wakeword runtime feeds its denial through this
// helper, and a locale missing one of the three variants would surface
// either the zh-CN fallback or the raw Chromium text.
describe('humanizeMicPermissionError — all locales x platforms', () => {
  const locales = [
    { name: 'zh-CN', code: 'zh-CN', messages: zhCNMessages },
    { name: 'zh-TW', code: 'zh-TW', messages: zhTWMessages },
    { name: 'en', code: 'en-US', messages: enMessages },
    { name: 'ja', code: 'ja', messages: jaMessages },
    { name: 'ko', code: 'ko', messages: koMessages },
  ] as const
  const platforms = [
    { platform: 'darwin', suffix: '_mac' },
    { platform: 'win32', suffix: '_windows' },
    { platform: 'linux', suffix: '' },
  ] as const
  const deniedError = Object.assign(new Error('Permission denied'), { name: 'NotAllowedError' })

  for (const { name, code, messages } of locales) {
    test(`${name}: denied mic maps to that locale's platform-specific sentence`, async () => {
      await ensureLocaleLoaded(code)
      setLocale(code)
      try {
        for (const { platform, suffix } of platforms) {
          const key = `humanize.voice.mic_permission${suffix}` as TranslationKey
          const out = humanizeMicPermissionError(deniedError, { platform })
          assert.equal(out, messages[key], `${name} / ${platform}`)
          assert.doesNotMatch(out ?? '', /Permission denied/)
        }
      } finally {
        setLocale('en-US')
      }
    })
  }

  test('non-permission errors return null in every locale', async () => {
    const nonPermission = [
      new Error('Requested device not found'),
      new Error('Could not start audio source'),
      new Error('Microphone track ended unexpectedly — triggering recovery.'),
      'fetch failed',
      null,
      undefined,
    ]
    for (const { code } of locales) {
      await ensureLocaleLoaded(code)
      setLocale(code)
      try {
        for (const error of nonPermission) {
          assert.equal(humanizeMicPermissionError(error, { platform: 'darwin' }), null)
        }
      } finally {
        setLocale('en-US')
      }
    }
  })
})
