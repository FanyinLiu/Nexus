import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildConnectionTestFingerprint,
  connectionEvidenceMeetsCapability,
  createConnectionVerificationRecord,
  DEFAULT_CONNECTION_RESULT_TTL_MS,
  getConnectionResultFreshness,
  getConnectionTestResultPresentation,
  getNextConnectionResultExpiryMs,
  MAX_CONNECTION_EXPIRY_DELAY_MS,
  isConnectionVerificationCurrent,
  shouldAcceptConnectionTestResult,
  withConnectionCheckedAt,
} from '../src/features/models/connectionTestFreshness.ts'
import type { AppSettings } from '../src/types/index.ts'

const baseSettings = {
  apiProviderId: 'ollama',
  apiBaseUrl: 'http://127.0.0.1:11434/v1',
  apiKey: '',
  model: 'qwen3:8b',
  speechInputProviderId: 'sensevoice',
  speechInputApiBaseUrl: '',
  speechInputApiKey: '',
  speechInputModel: 'sensevoice-small',
  speechOutputProviderId: 'edge-tts',
  speechOutputEnabled: true,
  speechOutputApiBaseUrl: '',
  speechOutputApiKey: '',
  speechOutputModel: '',
  speechOutputVoice: 'zh-CN-XiaoxiaoNeural',
  companionName: '星绘',
} as AppSettings

const evidence = { kind: 'model-response' as const }

test('connection fingerprints change only with request-relevant settings', () => {
  const textFingerprint = buildConnectionTestFingerprint('text', baseSettings)
  const renamed = { ...baseSettings, companionName: 'Mao' }
  const changedModel = { ...baseSettings, model: 'qwen3:14b' }

  assert.equal(buildConnectionTestFingerprint('text', renamed), textFingerprint)
  assert.notEqual(buildConnectionTestFingerprint('text', changedModel), textFingerprint)
  assert.notEqual(
    buildConnectionTestFingerprint('speech-output', {
      ...baseSettings,
      speechOutputVoice: 'zh-CN-YunxiNeural',
    }),
    buildConnectionTestFingerprint('speech-output', baseSettings),
  )
  assert.notEqual(
    buildConnectionTestFingerprint('speech-output', {
      ...baseSettings,
      speechOutputEnabled: false,
    }),
    buildConnectionTestFingerprint('speech-output', baseSettings),
  )
})

test('connection freshness expires verified evidence and rejects legacy green results', () => {
  const checkedAt = '2026-07-11T12:00:00.000Z'

  assert.equal(
    getConnectionResultFreshness({ checkedAt, evidence }, true, new Date('2026-07-11T12:09:59.999Z')),
    'current',
  )
  assert.equal(
    getConnectionResultFreshness({ checkedAt, evidence }, true, new Date('2026-07-11T12:10:00.000Z')),
    'time-stale',
  )
  assert.equal(getConnectionResultFreshness({ checkedAt }, true), 'unverified')
  assert.equal(getConnectionResultFreshness({ checkedAt, evidence }, false), 'config-stale')
  assert.equal(
    getConnectionResultFreshness(
      { checkedAt: '2026-07-11T12:01:00.001Z', evidence },
      true,
      new Date('2026-07-11T12:00:30.000Z'),
    ),
    'unverified',
  )
})

test('connection evidence must prove the requested capability', () => {
  assert.equal(connectionEvidenceMeetsCapability('text', { kind: 'model-list' }), false)
  assert.equal(connectionEvidenceMeetsCapability('text', { kind: 'model-response' }), true)
  assert.equal(connectionEvidenceMeetsCapability('speech-input', { kind: 'audio-response' }), true)
  assert.equal(connectionEvidenceMeetsCapability('speech-input', { kind: 'preflight' }), false)
  assert.equal(connectionEvidenceMeetsCapability('speech-output', { kind: 'playback' }), true)
  assert.equal(connectionEvidenceMeetsCapability('speech-output', { kind: 'endpoint' }), false)
})

test('connection checkedAt preserves server time and fills missing time', () => {
  const serverTime = '2026-07-11T12:00:00.000Z'
  const fallbackTime = new Date('2026-07-11T13:00:00.000Z')

  assert.equal(withConnectionCheckedAt({ checkedAt: serverTime }).checkedAt, serverTime)
  assert.equal(withConnectionCheckedAt({}, fallbackTime).checkedAt, fallbackTime.toISOString())
})

test('staggered capability expiries reschedule to the next future expiry', () => {
  const earlier = '2026-07-11T12:00:00.000Z'
  const later = '2026-07-11T12:05:00.000Z'
  const results = [
    { ok: true, checkedAt: earlier },
    { ok: true, checkedAt: later },
  ]

  const firstExpiry = getNextConnectionResultExpiryMs(
    results,
    Date.parse('2026-07-11T12:00:00.000Z'),
  )
  assert.equal(firstExpiry, Date.parse(earlier) + DEFAULT_CONNECTION_RESULT_TTL_MS)

  // After the first timer fires, the next schedule must pick the later result.
  const secondExpiry = getNextConnectionResultExpiryMs(
    results,
    Date.parse(earlier) + DEFAULT_CONNECTION_RESULT_TTL_MS,
  )
  assert.equal(secondExpiry, Date.parse(later) + DEFAULT_CONNECTION_RESULT_TTL_MS)

  const afterAll = getNextConnectionResultExpiryMs(
    results,
    Date.parse(later) + DEFAULT_CONNECTION_RESULT_TTL_MS,
  )
  assert.equal(afterAll, null)
})

test('expiry scheduler ignores future-dated results and clamps oversized delays', () => {
  const now = Date.parse('2026-07-11T12:00:00.000Z')
  assert.equal(getNextConnectionResultExpiryMs([
    { ok: true, checkedAt: '2099-01-01T00:00:00.000Z' },
  ], now), null)

  const nearNow = new Date(now + 1_000).toISOString()
  assert.equal(
    getNextConnectionResultExpiryMs([{ ok: true, checkedAt: nearNow }], now, Number.MAX_SAFE_INTEGER),
    now + MAX_CONNECTION_EXPIRY_DELAY_MS,
  )
})

test('presentation never uses success styling for unverified, future, expired, or endpoint-only results', () => {
  const now = new Date('2026-07-11T12:10:00.000Z')

  const endpointOnly = getConnectionTestResultPresentation({
    result: {
      ok: true,
      checkedAt: '2026-07-11T12:05:00.000Z',
      evidence: { kind: 'endpoint' },
    },
    fingerprintMatches: true,
    capability: 'text',
  }, now)
  assert.equal(endpointOnly.tone, 'partial')
  assert.equal(endpointOnly.className, 'settings-test-result is-partial')
  assert.equal(endpointOnly.verified, false)

  const evidenceFree = getConnectionTestResultPresentation({
    result: {
      ok: true,
      checkedAt: '2026-07-11T12:05:00.000Z',
    },
    fingerprintMatches: true,
    capability: 'text',
  }, now)
  assert.equal(evidenceFree.tone, 'stale')
  assert.equal(evidenceFree.freshness, 'unverified')
  assert.equal(evidenceFree.className, 'settings-test-result is-stale')
  assert.equal(evidenceFree.verified, false)

  const expired = getConnectionTestResultPresentation({
    result: {
      ok: true,
      checkedAt: '2026-07-11T11:59:00.000Z',
      evidence,
    },
    fingerprintMatches: true,
    capability: 'text',
  }, now)
  assert.equal(expired.tone, 'stale')
  assert.equal(expired.freshness, 'time-stale')
  assert.equal(expired.className, 'settings-test-result is-stale')
  assert.equal(expired.verified, false)

  const futureDated = getConnectionTestResultPresentation({
    result: {
      ok: true,
      checkedAt: '2026-07-11T12:11:00.001Z',
      evidence,
    },
    fingerprintMatches: true,
    capability: 'text',
  }, now)
  assert.equal(futureDated.tone, 'stale')
  assert.equal(futureDated.freshness, 'unverified')
  assert.equal(futureDated.className, 'settings-test-result is-stale')
  assert.equal(futureDated.verified, false)

  const verified = getConnectionTestResultPresentation({
    result: {
      ok: true,
      checkedAt: '2026-07-11T12:05:00.000Z',
      evidence,
    },
    fingerprintMatches: true,
    capability: 'text',
  }, now)
  assert.equal(verified.tone, 'success')
  assert.equal(verified.className, 'settings-test-result is-success')
  assert.equal(verified.verified, true)
})

test('config invalidation marks verification non-current immediately', () => {
  const now = new Date('2026-07-11T12:05:00.000Z')
  const record = createConnectionVerificationRecord(
    'text',
    baseSettings,
    {
      ok: true,
      checkedAt: '2026-07-11T12:00:00.000Z',
      evidence,
    },
    now,
  )

  assert.equal(isConnectionVerificationCurrent(record, 'text', baseSettings, now), true)

  const editedModel = { ...baseSettings, model: 'qwen3:14b' }
  assert.equal(isConnectionVerificationCurrent(record, 'text', editedModel, now), false)

  const editedBase = { ...baseSettings, apiBaseUrl: 'http://127.0.0.1:11435/v1' }
  assert.equal(isConnectionVerificationCurrent(record, 'text', editedBase, now), false)

  const editedKey = { ...baseSettings, apiKey: 'sk-new' }
  assert.equal(isConnectionVerificationCurrent(record, 'text', editedKey, now), false)

  const editedProvider = { ...baseSettings, apiProviderId: 'openai' }
  assert.equal(isConnectionVerificationCurrent(record, 'text', editedProvider, now), false)

  const presentation = getConnectionTestResultPresentation({
    result: { ok: true, checkedAt: record.checkedAt, evidence: record.evidence },
    fingerprintMatches: false,
    capability: 'text',
  }, now)
  assert.equal(presentation.tone, 'stale')
  assert.equal(presentation.freshness, 'config-stale')
  assert.equal(presentation.verified, false)
})

test('parent verification record is not sticky after the 10-minute TTL', () => {
  const checkedAt = '2026-07-11T12:00:00.000Z'
  const record = createConnectionVerificationRecord(
    'text',
    baseSettings,
    { ok: true, checkedAt, evidence },
  )

  assert.equal(
    isConnectionVerificationCurrent(
      record,
      'text',
      baseSettings,
      new Date('2026-07-11T12:09:59.999Z'),
    ),
    true,
  )
  assert.equal(
    isConnectionVerificationCurrent(
      record,
      'text',
      baseSettings,
      new Date('2026-07-11T12:10:00.000Z'),
    ),
    false,
  )

  // Endpoint-only / evidence-free successes never count as parent-ready.
  const endpointRecord = createConnectionVerificationRecord(
    'text',
    baseSettings,
    {
      ok: true,
      checkedAt,
      evidence: { kind: 'endpoint' },
    },
  )
  assert.equal(
    isConnectionVerificationCurrent(
      endpointRecord,
      'text',
      baseSettings,
      new Date('2026-07-11T12:01:00.000Z'),
    ),
    false,
  )
})

test('failure results with checkedAt become stale after config change or TTL', () => {
  const now = new Date('2026-07-11T12:10:00.000Z')
  const failed = {
    ok: false as const,
    checkedAt: '2026-07-11T12:05:00.000Z',
    message: 'auth failed',
  }

  const currentFailure = getConnectionTestResultPresentation({
    result: failed,
    fingerprintMatches: true,
    capability: 'text',
  }, now)
  assert.equal(currentFailure.tone, 'error')
  assert.equal(currentFailure.verified, false)

  const configStaleFailure = getConnectionTestResultPresentation({
    result: failed,
    fingerprintMatches: false,
    capability: 'text',
  }, now)
  assert.equal(configStaleFailure.tone, 'stale')
  assert.equal(configStaleFailure.freshness, 'config-stale')
  assert.equal(configStaleFailure.className, 'settings-test-result is-stale')

  const expiredFailure = getConnectionTestResultPresentation({
    result: {
      ok: false,
      checkedAt: '2026-07-11T11:59:00.000Z',
      message: 'old failure',
    },
    fingerprintMatches: true,
    capability: 'text',
  }, now)
  assert.equal(expiredFailure.tone, 'stale')
  assert.equal(expiredFailure.freshness, 'time-stale')
  assert.equal(expiredFailure.verified, false)
})

test('expiry scheduler covers both success and failure checkedAt timers', () => {
  const failureCheckedAt = '2026-07-11T12:00:00.000Z'
  const successCheckedAt = '2026-07-11T12:05:00.000Z'
  const next = getNextConnectionResultExpiryMs(
    [
      { ok: false, checkedAt: failureCheckedAt },
      { ok: true, checkedAt: successCheckedAt },
    ],
    Date.parse('2026-07-11T12:00:00.000Z'),
  )
  assert.equal(next, Date.parse(failureCheckedAt) + DEFAULT_CONNECTION_RESULT_TTL_MS)
})

test('late connection results after generation/epoch/unmount must be ignored', () => {
  assert.equal(
    shouldAcceptConnectionTestResult({
      requestGeneration: 1,
      activeGeneration: 1,
    }),
    true,
  )
  assert.equal(
    shouldAcceptConnectionTestResult({
      requestGeneration: 1,
      activeGeneration: 2,
    }),
    false,
  )
  assert.equal(
    shouldAcceptConnectionTestResult({
      requestGeneration: 3,
      activeGeneration: 3,
      requestEpoch: 0,
      activeEpoch: 1,
    }),
    false,
  )
  assert.equal(
    shouldAcceptConnectionTestResult({
      requestGeneration: 3,
      activeGeneration: 3,
      requestEpoch: 1,
      activeEpoch: 1,
    }),
    true,
  )
})
