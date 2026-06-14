import assert from 'node:assert/strict'
import { test } from 'node:test'
import { runConnectionPreflight } from '../src/features/models/connectionPreflight.ts'

const base = {
  providerId: 'openai',
  apiKey: 'sk-test1234',
  apiBaseUrl: 'https://api.openai.com',
  model: 'gpt-4o',
  uiLanguage: 'en-US' as const,
}

test('returns null when all fields are valid', () => {
  assert.equal(runConnectionPreflight(base), null)
})

test('catches empty API key for provider that requires one', () => {
  const result = runConnectionPreflight({ ...base, apiKey: '' })
  assert.equal(result?.ok, false)
  assert.equal(result?.status, 'needs_key')
})

test('skips API key check for provider that does not require one', () => {
  const result = runConnectionPreflight({ ...base, providerId: 'ollama', apiKey: '' })
  assert.equal(result, null)
})

test('catches CJK characters in API key', () => {
  const result = runConnectionPreflight({ ...base, apiKey: 'sk-test模型key' })
  assert.equal(result?.ok, false)
  assert.equal(result?.status, 'misconfigured')
})

test('catches whitespace in API key', () => {
  const result = runConnectionPreflight({ ...base, apiKey: 'sk-test key' })
  assert.equal(result?.ok, false)
  assert.equal(result?.status, 'misconfigured')
})

test('catches empty base URL', () => {
  const result = runConnectionPreflight({ ...base, apiBaseUrl: '  ' })
  assert.equal(result?.ok, false)
  assert.equal(result?.status, 'misconfigured')
})

test('catches empty model', () => {
  const result = runConnectionPreflight({ ...base, model: '' })
  assert.equal(result?.ok, false)
  assert.equal(result?.status, 'misconfigured')
})

test('skips vault-ref API keys without character validation', () => {
  const result = runConnectionPreflight({ ...base, apiKey: 'vault:my-openai-key' })
  assert.equal(result, null)
})
