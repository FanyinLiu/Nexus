import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  canonicalizeLoopbackUrl,
  buildSafeRedirectRequestOptions,
  isIpv6LoopbackHost,
  shouldLabelAsConnectionFailure,
} from '../electron/netHelpers.js'

test('canonicalizeLoopbackUrl rewrites localhost → 127.0.0.1', () => {
  assert.equal(
    canonicalizeLoopbackUrl('http://localhost:11434/v1/chat/completions'),
    'http://127.0.0.1:11434/v1/chat/completions',
  )
  assert.equal(
    canonicalizeLoopbackUrl('https://localhost:8080/'),
    'https://127.0.0.1:8080/',
  )
})

test('canonicalizeLoopbackUrl leaves non-localhost URLs untouched', () => {
  assert.equal(
    canonicalizeLoopbackUrl('http://127.0.0.1:11434/'),
    'http://127.0.0.1:11434/',
  )
  assert.equal(
    canonicalizeLoopbackUrl('https://api.openai.com/v1/chat'),
    'https://api.openai.com/v1/chat',
  )
  assert.equal(
    canonicalizeLoopbackUrl('https://localhost.example.com/'),
    'https://localhost.example.com/',
  )
})

test('canonicalizeLoopbackUrl returns input unchanged for invalid URLs', () => {
  assert.equal(canonicalizeLoopbackUrl('not a url'), 'not a url')
  assert.equal(canonicalizeLoopbackUrl(''), '')
})

test('safe redirects strip credentials across origins', () => {
  const result = buildSafeRedirectRequestOptions(
    'https://api.example.com/audio',
    'https://cdn.example.net/file',
    307,
    {
      method: 'POST',
      headers: { Authorization: 'Bearer secret', 'X-Api-Key': 'secret', Accept: 'audio/*' },
      body: 'payload',
    },
  )
  assert.deepEqual(result, {
    method: 'POST',
    headers: { Accept: 'audio/*' },
    body: 'payload',
  })
})

test('safe 302 POST redirects switch to GET and drop entity headers', () => {
  const result = buildSafeRedirectRequestOptions(
    'https://api.example.com/audio',
    'https://api.example.com/result',
    302,
    {
      method: 'POST',
      headers: { Authorization: 'Bearer secret', 'Content-Type': 'application/json', 'Content-Length': '7' },
      body: 'payload',
    },
  )
  assert.deepEqual(result, {
    method: 'GET',
    headers: { Authorization: 'Bearer secret' },
  })
})

test('isIpv6LoopbackHost detects ::1 forms', () => {
  assert.equal(isIpv6LoopbackHost('::1'), true)
  assert.equal(isIpv6LoopbackHost('[::1]'), true)
  assert.equal(isIpv6LoopbackHost('127.0.0.1'), false)
  assert.equal(isIpv6LoopbackHost('localhost'), false)
})

test('shouldLabelAsConnectionFailure recognises common network failure strings', () => {
  assert.equal(shouldLabelAsConnectionFailure('ECONNREFUSED 127.0.0.1:11434'), true)
  assert.equal(shouldLabelAsConnectionFailure('fetch failed'), true)
  assert.equal(shouldLabelAsConnectionFailure('net::ERR_CONNECTION_REFUSED'), true)
  assert.equal(shouldLabelAsConnectionFailure('socket hang up'), true)
  assert.equal(shouldLabelAsConnectionFailure('Proxy Authentication Required'), true)
  // HTTP-level errors are not connection failures
  assert.equal(shouldLabelAsConnectionFailure('HTTP 401 Unauthorized'), false)
  assert.equal(shouldLabelAsConnectionFailure('invalid api key'), false)
})
