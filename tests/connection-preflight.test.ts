import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  runConnectionPreflight,
  runTextConnectionTestPreflight,
} from '../src/features/models/connectionPreflight.ts'

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

test('DeepSeek missing API key includes the first-run repair path', () => {
  const result = runConnectionPreflight({
    ...base,
    providerId: 'deepseek',
    apiKey: '',
    apiBaseUrl: 'https://api.deepseek.com',
    model: 'deepseek-v4-flash',
  })

  assert.equal(result?.ok, false)
  assert.equal(result?.status, 'needs_key')
  assert.match(result?.recommendation ?? '', /https:\/\/api\.deepseek\.com/)
  assert.match(result?.recommendation ?? '', /deepseek-v4-flash/)
})

test('skips API key check for provider that does not require one', () => {
  const result = runConnectionPreflight({
    ...base,
    providerId: 'ollama',
    apiKey: '',
    apiBaseUrl: 'http://127.0.0.1:11434/v1',
    model: 'qwen3:8b',
  })
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

test('Ollama missing base URL recommends the local OpenAI-compatible endpoint', () => {
  const result = runConnectionPreflight({
    ...base,
    providerId: 'ollama',
    apiKey: '',
    apiBaseUrl: '  ',
    model: 'qwen3:8b',
  })

  assert.equal(result?.ok, false)
  assert.equal(result?.status, 'misconfigured')
  assert.match(result?.message ?? '', /Ollama/)
  assert.match(result?.recommendation ?? '', /http:\/\/127\.0\.0\.1:11434\/v1/)
  assert.deepEqual(result?.repair, {
    apiBaseUrl: 'http://127.0.0.1:11434/v1',
  })
})

test('DeepSeek missing base URL recommends the supported default endpoint', () => {
  const result = runConnectionPreflight({
    ...base,
    providerId: 'deepseek',
    apiBaseUrl: '',
    model: 'deepseek-v4-flash',
  })

  assert.equal(result?.ok, false)
  assert.equal(result?.status, 'misconfigured')
  assert.match(result?.message ?? '', /DeepSeek/)
  assert.match(result?.recommendation ?? '', /https:\/\/api\.deepseek\.com/)
  assert.deepEqual(result?.repair, {
    apiBaseUrl: 'https://api.deepseek.com',
  })
})

test('DeepSeek preflight can keep checking endpoint/model while missing API key is non-blocking', () => {
  const result = runConnectionPreflight({
    ...base,
    providerId: 'deepseek',
    apiKey: '',
    apiBaseUrl: '',
    model: '',
    skipMissingApiKey: true,
  })

  assert.equal(result?.ok, false)
  assert.equal(result?.status, 'misconfigured')
  assert.match(result?.recommendation ?? '', /https:\/\/api\.deepseek\.com/)
  assert.deepEqual(result?.repair, {
    apiBaseUrl: 'https://api.deepseek.com',
    model: 'deepseek-v4-flash',
  })
})

test('text connection test preflight reports endpoint/model before missing API key', () => {
  const result = runTextConnectionTestPreflight({
    ...base,
    providerId: 'deepseek',
    apiKey: '',
    apiBaseUrl: '',
    model: '',
  })

  assert.equal(result?.ok, false)
  assert.equal(result?.status, 'misconfigured')
  assert.deepEqual(result?.repair, {
    apiBaseUrl: 'https://api.deepseek.com',
    model: 'deepseek-v4-flash',
  })
})

test('text connection test preflight still reports missing key after structural checks pass', () => {
  const result = runTextConnectionTestPreflight({
    ...base,
    providerId: 'deepseek',
    apiKey: '',
    apiBaseUrl: 'https://api.deepseek.com',
    model: 'deepseek-v4-flash',
  })

  assert.equal(result?.ok, false)
  assert.equal(result?.status, 'needs_key')
})

test('custom missing base URL explains the OpenAI-compatible URL shape', () => {
  const result = runConnectionPreflight({
    ...base,
    providerId: 'custom',
    apiKey: '',
    apiBaseUrl: '',
    model: 'local-model',
  })

  assert.equal(result?.ok, false)
  assert.equal(result?.status, 'misconfigured')
  assert.match(result?.message ?? '', /Custom|OpenAI-compatible/i)
  assert.match(result?.recommendation ?? '', /\/v1/)
  assert.equal(result?.repair, undefined)
})

test('catches URL missing protocol', () => {
  const result = runConnectionPreflight({ ...base, apiBaseUrl: 'api.openai.com' })
  assert.equal(result?.ok, false)
  assert.equal(result?.status, 'misconfigured')
})

test('Ollama URL without protocol points back to the exact local endpoint', () => {
  const result = runConnectionPreflight({
    ...base,
    providerId: 'ollama',
    apiKey: '',
    apiBaseUrl: '127.0.0.1:11434/v1',
    model: 'qwen3:8b',
  })

  assert.equal(result?.ok, false)
  assert.equal(result?.status, 'misconfigured')
  assert.match(result?.recommendation ?? '', /http:\/\/127\.0\.0\.1:11434\/v1/)
  assert.deepEqual(result?.repair, {
    apiBaseUrl: 'http://127.0.0.1:11434/v1',
  })
})

test('Ollama URL without /v1 is caught before making a request', () => {
  const result = runConnectionPreflight({
    ...base,
    providerId: 'ollama',
    apiKey: '',
    apiBaseUrl: 'http://127.0.0.1:11434',
    model: 'qwen3:8b',
  })

  assert.equal(result?.ok, false)
  assert.equal(result?.status, 'misconfigured')
  assert.match(result?.message ?? '', /\/v1/)
  assert.match(result?.recommendation ?? '', /http:\/\/127\.0\.0\.1:11434\/v1/)
  assert.deepEqual(result?.repair, {
    apiBaseUrl: 'http://127.0.0.1:11434/v1',
  })
})

test('catches empty model', () => {
  const result = runConnectionPreflight({ ...base, model: '' })
  assert.equal(result?.ok, false)
  assert.equal(result?.status, 'misconfigured')
})

test('Ollama missing model recommends the default pull command', () => {
  const result = runConnectionPreflight({
    ...base,
    providerId: 'ollama',
    apiKey: '',
    apiBaseUrl: 'http://127.0.0.1:11434/v1',
    model: '',
  })

  assert.equal(result?.ok, false)
  assert.equal(result?.status, 'misconfigured')
  assert.match(result?.recommendation ?? '', /qwen3:8b/)
  assert.match(result?.recommendation ?? '', /ollama pull qwen3:8b/)
  assert.deepEqual(result?.repair, {
    model: 'qwen3:8b',
  })
})

test('DeepSeek missing model recommends the first-success default', () => {
  const result = runConnectionPreflight({
    ...base,
    providerId: 'deepseek',
    apiBaseUrl: 'https://api.deepseek.com',
    model: '',
  })

  assert.equal(result?.ok, false)
  assert.equal(result?.status, 'misconfigured')
  assert.match(result?.recommendation ?? '', /deepseek-v4-flash/)
  assert.deepEqual(result?.repair, {
    model: 'deepseek-v4-flash',
  })
})

test('custom missing model asks for the gateway model id', () => {
  const result = runConnectionPreflight({
    ...base,
    providerId: 'custom',
    apiKey: '',
    apiBaseUrl: 'http://127.0.0.1:1234/v1',
    model: '',
  })

  assert.equal(result?.ok, false)
  assert.equal(result?.status, 'misconfigured')
  assert.match(result?.recommendation ?? '', /ID/i)
})

test('skips vault-ref API keys without character validation', () => {
  const result = runConnectionPreflight({ ...base, apiKey: 'vault:my-openai-key' })
  assert.equal(result, null)
})
