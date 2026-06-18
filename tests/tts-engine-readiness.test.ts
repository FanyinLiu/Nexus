import assert from 'node:assert/strict'
import { test } from 'node:test'

import { buildTtsEngineReadinessReport } from '../src/features/voice/ttsEngineReadiness.ts'
import { resolveTtsLatencyPolicy } from '../src/features/voice/ttsLatencyPolicy.ts'
import type { VoiceTtsDiagnostics } from '../src/features/voice/voiceDiagnostics.ts'

function makeTtsDiagnostics(
  providerId: string,
  overrides: Partial<VoiceTtsDiagnostics> = {},
): VoiceTtsDiagnostics {
  return {
    ...resolveTtsLatencyPolicy(providerId),
    firstAudioAdviceId: 'keep_delta_streaming',
    firstAudioAdviceSeverity: 'ok',
    firstAudioLatencyStatus: 'pass',
    model: 'private-model-id',
    voice: 'private-voice-id',
    ...overrides,
  }
}

test('tts engine readiness reports legacy local low-latency status without private model or voice ids', () => {
  const report = buildTtsEngineReadinessReport({
    speechOutputProviderId: 'local-tts',
    tts: makeTtsDiagnostics('local-tts'),
  }, { generatedAt: '2026-06-17T12:00:00Z' })
  const json = JSON.stringify(report)

  assert.equal(report.gate, 'tts-engine-upgrade-readiness')
  assert.equal(report.generatedAt, '2026-06-17T12:00:00.000Z')
  assert.equal(report.activeProvider.providerId, 'local-tts')
  assert.equal(report.activeProvider.catalogRegistered, true)
  assert.equal(report.activeProvider.localEngine, true)
  assert.equal(report.activeProvider.legacyLocalEngine, true)
  assert.equal(report.activeProvider.targetLocalEngine, false)
  assert.equal(report.activeProvider.deltaStreaming, true)
  assert.equal(report.activeProvider.firstAudioLatencyStatus, 'pass')
  assert.equal(report.activeProvider.modelConfigured, true)
  assert.equal(report.activeProvider.voiceConfigured, true)
  assert.deepEqual(report.targetEngines.registeredProviderIds, ['voxtral-local', 'kyutai-local'])
  assert.equal(report.targetEngines.registeredCount, 2)
  assert.equal(report.checks.find((check) => check.id === 'has-target-engine-provider')?.pass, true)
  assert.equal(report.checks.find((check) => check.id === 'active-target-engine-selected')?.pass, false)
  assert.equal(json.includes('private-model-id'), false)
  assert.equal(json.includes('private-voice-id'), false)
})

test('tts engine readiness passes when a target local engine has a first-audio sample', () => {
  const report = buildTtsEngineReadinessReport({
    speechOutputProviderId: 'voxtral-local',
    tts: makeTtsDiagnostics('voxtral-local'),
  }, { generatedAt: '2026-06-17T12:00:00Z' })

  assert.equal(report.activeProvider.providerId, 'voxtral-local')
  assert.equal(report.activeProvider.catalogRegistered, true)
  assert.equal(report.activeProvider.localEngine, true)
  assert.equal(report.activeProvider.legacyLocalEngine, false)
  assert.equal(report.activeProvider.targetLocalEngine, true)
  assert.equal(report.activeProvider.deltaStreaming, true)
  assert.equal(report.targetEngines.activeTargetEngineId, 'voxtral-local')
  assert.equal(report.targetEngines.missingProviderIds.length, 0)
  assert.equal(report.checks.every((check) => check.pass), true)
  assert.equal(report.qualityIssueCount, 0)
})

test('tts engine readiness keeps remote and sample gaps explicit', () => {
  const report = buildTtsEngineReadinessReport({
    speechOutputProviderId: 'minimax-tts',
    tts: makeTtsDiagnostics('minimax-tts', {
      firstAudioAdviceId: 'collect_first_audio_sample',
      firstAudioAdviceSeverity: 'info',
      firstAudioLatencyStatus: 'unknown',
    }),
  }, { generatedAt: 'bad-date' })

  assert.equal(Number.isFinite(Date.parse(report.generatedAt)), true)
  assert.equal(report.activeProvider.kind, 'remote')
  assert.equal(report.activeProvider.localEngine, false)
  assert.equal(report.activeProvider.deltaStreaming, false)
  assert.equal(report.activeProvider.firstAudioLatencyStatus, 'unknown')
  assert.equal(report.checks.find((check) => check.id === 'has-local-engine')?.pass, false)
  assert.equal(report.checks.find((check) => check.id === 'has-delta-streaming')?.pass, false)
  assert.equal(report.checks.find((check) => check.id === 'has-first-audio-sample')?.pass, false)
  assert.equal(report.qualityIssues.some((issue) => issue.id === 'active-provider-not-local'), true)
  assert.equal(report.qualityIssues.some((issue) => issue.id === 'missing-first-audio-sample'), true)
})
