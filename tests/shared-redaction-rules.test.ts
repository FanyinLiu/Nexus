import assert from 'node:assert/strict'
import { test } from 'node:test'

import { redactSensitiveText } from '../shared/redaction.js'

// Every value below is synthetic. These cases pin the rules touched by the
// word-start lookbehind so a future "optimization" cannot silently stop
// redacting a prefixed / suffix-key field.

test('redacts api_key parameter echoes', () => {
  assert.equal(redactSensitiveText('api_key=SYNTHETICAPIVALUE'), 'api_key=***')
})

test('redacts client_secret parameter echoes', () => {
  assert.equal(redactSensitiveText('client_secret=SYNTHETICCLIENTVALUE'), 'client_secret=***')
})

test('redacts quoted JSON token fields', () => {
  assert.equal(redactSensitiveText('"token": "SYNTHETICTOKENVALUE"'), '"token": "***"')
})

test('redacts refresh_token parameter echoes', () => {
  assert.equal(redactSensitiveText('refresh_token=SYNTHETICREFRESHVALUE'), 'refresh_token=***')
})

test('redacts key=value with spaces around the separator', () => {
  assert.equal(redactSensitiveText('key = SYNTHETICKEYVALUE'), 'key = ***')
})

test('redacts a prefixed api_key field', () => {
  assert.equal(redactSensitiveText('my_api_key=SYNTHETICAPIPREFIXVALUE'), 'my_api_key=***')
})

test('redacts a prefixed header-style key field', () => {
  assert.equal(redactSensitiveText('X-Api-Key: SYNTHETICHEADERVALUE'), 'X-Api-Key: ***')
})

test('keeps the token-shape and userinfo rules intact', () => {
  const raw = [
    'Authorization: Bearer SYNTHETICBEARERTOKEN16CHARS',
    'sk-SYNTHETICDEADBEEF12345',
    'xai-SYNTHETICDEADBEEF12345',
    'AIzaSYNTHETICDEADBEEF123456789012345',
    'eyJabcdefghi.abcdefghi.abcd',
    'https://user:SYNTHETICPASSWORD@host/path',
  ].join(' ')

  const redacted = redactSensitiveText(raw)

  assert.match(redacted, /Bearer \*\*\*/)
  assert.match(redacted, /sk-\*\*\*/)
  assert.match(redacted, /xai-\*\*\*/)
  assert.match(redacted, /AIza\*\*\*/)
  assert.match(redacted, /jwt\*\*\*/)
  assert.match(redacted, /https:\/\/\*\*\*:\*\*\*@host\/path/)
  assert.doesNotMatch(redacted, /SYNTHETIC/)
  assert.doesNotMatch(redacted, /abcdefghi/)
})
