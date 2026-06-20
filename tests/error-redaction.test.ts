import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  getRedactedErrorMessage,
  redactSensitiveErrorText,
} from '../electron/services/errorRedaction.js'

test('main-process error redaction strips common API secrets', () => {
  const raw = [
    'Authorization: Bearer sk-ABCDEF1234567890XYZ',
    'api_key=AIza012345678901234567890123456789012',
    'client_secret=sup3rs3cr3tvalue',
    'refresh_token=eyJabcdefghi.abcdefghi.abcd',
    'proxy=https://user:pass@my-proxy.example.com',
    'home=/Users/klein/.config/private.json',
  ].join(' ')

  const redacted = redactSensitiveErrorText(raw)

  assert.match(redacted, /Bearer \*\*\*/)
  assert.match(redacted, /api_key=\*\*\*/)
  assert.match(redacted, /client_secret=\*\*\*/)
  assert.match(redacted, /refresh_token=\*\*\*/)
  assert.match(redacted, /\*\*\*:\*\*\*@my-proxy\.example\.com/)
  assert.match(redacted, /home=~\/\.config\/private\.json/)

  assert.doesNotMatch(redacted, /sk-ABCDEF1234567890XYZ/)
  assert.doesNotMatch(redacted, /AIza012345678901234567890123456789012/)
  assert.doesNotMatch(redacted, /sup3rs3cr3tvalue/)
  assert.doesNotMatch(redacted, /eyJabcdefghi\.abcdefghi\.abcd/)
  assert.doesNotMatch(redacted, /user:pass/)
  assert.doesNotMatch(redacted, /\/Users\/klein/)
})

test('main-process error redaction handles Error objects', () => {
  const redacted = getRedactedErrorMessage(new Error('upstream echoed token=xai-abcdefghijklmnop'))

  assert.equal(redacted, 'upstream echoed token=***')
  assert.doesNotMatch(redacted, /xai-abcdefghijklmnop/)
})
