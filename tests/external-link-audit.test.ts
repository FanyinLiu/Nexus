import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  summarizeExternalLinkRequest,
  summarizeExternalLinkResult,
} from '../electron/ipc/externalLinkAudit.js'

test('external link audit summaries exclude full urls hosts paths queries and fragments', () => {
  const request = summarizeExternalLinkRequest({
    url: 'https://private.example.com/secret/path?token=abc#fragment',
    policy: {
      enabled: true,
      requiresConfirmation: true,
    },
  })

  assert.deepEqual(request, {
    channel: 'tool:open-external',
    url: {
      inputLength: 58,
      parsed: true,
      protocol: 'https',
      hostnamePresent: true,
      hostnameLength: 19,
      pathnameLength: 12,
      searchPresent: true,
      searchLength: 10,
      hashPresent: true,
      hashLength: 9,
    },
    policy: {
      enabled: true,
      requiresConfirmation: true,
    },
  })

  const result = summarizeExternalLinkResult({
    ok: true,
    url: 'https://private.example.com/secret/path?token=abc#fragment',
    message: 'Opened private link',
  })

  assert.equal(result.ok, true)
  assert.equal(result.urlLength, 58)
  assert.equal(result.messageLength, 19)

  const serialized = JSON.stringify({ request, result })
  for (const privateValue of [
    'private.example.com',
    '/secret/path',
    'token=abc',
    'fragment',
    'Opened private link',
  ]) {
    assert.ok(!serialized.includes(privateValue), `${privateValue} should not be logged`)
  }
})

test('external link audit handles malformed urls without logging raw input', () => {
  const request = summarizeExternalLinkRequest({
    url: 'not a valid private url',
  })

  assert.deepEqual(request.url, {
    inputLength: 23,
    parsed: false,
  })
  assert.ok(!JSON.stringify(request).includes('not a valid private url'))
})

test('external link error summaries omit private error messages', () => {
  const summary = summarizeExternalLinkResult(
    {},
    new Error('rejected https://private.example.com/secret'),
  )

  assert.equal(summary.ok, false)
  assert.equal(summary.errorName, 'Error')
  assert.equal(summary.errorMessageLength, 43)
  assert.ok(!JSON.stringify(summary).includes('private.example.com'))
  assert.ok(!JSON.stringify(summary).includes('/secret'))
})
