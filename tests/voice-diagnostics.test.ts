import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { promisify } from 'node:util'

import {
  buildVoiceDiagnosticsInputExport,
  buildPublicVoiceDiagnosticsReport,
  buildVoiceDiagnosticsReport,
  resolveVoiceDiagnosticsSummary,
} from '../src/features/voice/voiceDiagnostics.ts'
import type { VoiceTransitionRecord } from '../src/features/voice/voiceTransitionTypes.ts'
import type { VoicePipelineState, VoiceTraceEntry } from '../src/types/voice.ts'
import {
  parseVoiceDiagnosticsReportArgs,
} from '../scripts/voice-diagnostics-report.mjs'

const execFileAsync = promisify(execFile)

function makePipeline(overrides: Partial<VoicePipelineState> = {}): VoicePipelineState {
  return {
    detail: '',
    step: 'idle',
    transcript: '',
    updatedAt: '',
    ...overrides,
  }
}

function makeTrace(overrides: Partial<VoiceTraceEntry> = {}): VoiceTraceEntry {
  return {
    createdAt: '2026-06-16T10:00:00.000Z',
    detail: 'trace detail',
    id: 'trace-1',
    title: 'Trace',
    tone: 'info',
    ...overrides,
  }
}

function makeRecord(overrides: Partial<VoiceTransitionRecord>): VoiceTransitionRecord {
  return {
    eventType: 'session:started',
    latencyMs: null,
    meta: null,
    nextPhase: 'listening',
    prevPhase: 'idle',
    provider: null,
    reason: null,
    seq: 1,
    sessionId: 's1',
    ts: 1_000,
    ...overrides,
  }
}

test('voice diagnostics reports an empty idle pipeline without traces', () => {
  const summary = resolveVoiceDiagnosticsSummary({
    speechLevel: 0,
    transitionRecords: [],
    voicePipeline: makePipeline(),
    voiceState: 'idle',
    voiceTrace: [],
  })

  assert.equal(summary.status, 'empty')
  assert.equal(summary.speechLevelPercent, 0)
  assert.equal(summary.latestTrace, null)
  assert.equal(summary.latestTransition, null)
  assert.deepEqual(summary.latencies.map((entry) => entry.latencyMs), [null, null, null])
})

test('voice diagnostics prioritizes recent trace errors and clamps mic level', () => {
  const summary = resolveVoiceDiagnosticsSummary({
    speechLevel: 1.4,
    transitionRecords: [],
    voicePipeline: makePipeline({ step: 'reply_failed', detail: 'request failed' }),
    voiceState: 'idle',
    voiceTrace: [
      makeTrace({ id: 'err', title: 'TTS error', tone: 'error' }),
      makeTrace({ id: 'ok', title: 'OK', tone: 'success' }),
    ],
  })

  assert.equal(summary.status, 'error')
  assert.equal(summary.speechLevelPercent, 100)
  assert.equal(summary.traceCount, 2)
  assert.equal(summary.errorCount, 1)
  assert.equal(summary.latestTrace?.id, 'err')
  assert.equal(summary.latestError?.id, 'err')
})

test('voice diagnostics keeps historical trace errors visible without blocking current-ready status', () => {
  const summary = resolveVoiceDiagnosticsSummary({
    speechLevel: 0.2,
    transitionRecords: [],
    voicePipeline: makePipeline({ updatedAt: '2026-06-16T10:00:03.000Z' }),
    voiceState: 'idle',
    voiceTrace: [
      makeTrace({ id: 'ok', title: 'OK', tone: 'success', createdAt: '2026-06-16T10:00:03.000Z' }),
      makeTrace({ id: 'err', title: 'Old TTS error', tone: 'error', createdAt: '2026-06-16T09:59:00.000Z' }),
    ],
  })

  assert.equal(summary.status, 'ok')
  assert.equal(summary.errorCount, 1)
  assert.equal(summary.latestTrace?.id, 'ok')
  assert.equal(summary.latestError?.id, 'err')
})

test('voice diagnostics extracts latest latency slices from transition records', () => {
  const summary = resolveVoiceDiagnosticsSummary({
    speechOutput: {
      model: 'tts-1',
      providerId: 'local-tts',
      voice: 'zh-female',
    },
    speechLevel: 0.42,
    voicePipeline: makePipeline(),
    voiceState: 'idle',
    voiceTrace: [],
    transitionRecords: [
      makeRecord({ seq: 1, eventType: 'mic:acquired', latencyMs: 120 }),
      makeRecord({ seq: 2, eventType: 'stt:final', latencyMs: 340 }),
      makeRecord({ seq: 3, eventType: 'tts:first_audio', latencyMs: 560 }),
      makeRecord({ seq: 4, eventType: 'mic:acquired', latencyMs: 90 }),
    ],
  })

  assert.equal(summary.status, 'ok')
  assert.equal(summary.speechLevelPercent, 42)
  assert.equal(summary.latestTransition?.seq, 4)
  assert.equal(summary.tts?.providerId, 'local-tts')
  assert.equal(summary.tts?.deltaStreaming, true)
  assert.equal(summary.tts?.firstChunkMaxLength, 12)
  assert.equal(summary.tts?.firstAudioBudgetMs, 700)
  assert.equal(summary.tts?.firstAudioTimeoutMs, 3000)
  assert.equal(summary.tts?.firstAudioLatencyStatus, 'pass')
  assert.equal(summary.tts?.firstAudioAdviceId, 'keep_delta_streaming')
  assert.equal(summary.tts?.firstAudioAdviceSeverity, 'ok')
  assert.deepEqual(
    summary.latencies.map((entry) => [entry.id, entry.latencyMs, entry.eventSeq]),
    [
      ['wake_to_mic', 90, 4],
      ['speech_to_stt', 340, 2],
      ['stt_to_audio', 560, 3],
    ],
  )
})

test('voice diagnostics marks a reply failure without trace error as warning', () => {
  const summary = resolveVoiceDiagnosticsSummary({
    speechLevel: -1,
    transitionRecords: [],
    voicePipeline: makePipeline({ step: 'reply_failed', detail: 'request failed' }),
    voiceState: 'idle',
    voiceTrace: [],
  })

  assert.equal(summary.status, 'warning')
  assert.equal(summary.speechLevelPercent, 0)
})

test('voice diagnostics marks slow and unknown first-audio budget states', () => {
  const slow = resolveVoiceDiagnosticsSummary({
    speechOutput: { providerId: 'local-tts' },
    speechLevel: 0,
    transitionRecords: [
      makeRecord({ seq: 1, eventType: 'tts:first_audio', latencyMs: 900 }),
    ],
    voicePipeline: makePipeline(),
    voiceState: 'idle',
    voiceTrace: [],
  })

  assert.equal(slow.tts?.firstAudioBudgetMs, 700)
  assert.equal(slow.tts?.firstAudioLatencyStatus, 'slow')
  assert.equal(slow.tts?.firstAudioAdviceId, 'inspect_delta_streaming_engine')
  assert.equal(slow.tts?.firstAudioAdviceSeverity, 'warning')

  const unknown = resolveVoiceDiagnosticsSummary({
    speechOutput: { providerId: 'omnivoice-tts' },
    speechLevel: 0,
    transitionRecords: [],
    voicePipeline: makePipeline(),
    voiceState: 'idle',
    voiceTrace: [],
  })

  assert.equal(unknown.tts?.firstAudioBudgetMs, 1400)
  assert.equal(unknown.tts?.firstAudioTimeoutMs, 6000)
  assert.equal(unknown.tts?.firstAudioLatencyStatus, 'unknown')
  assert.equal(unknown.tts?.firstAudioAdviceId, 'collect_first_audio_sample')
  assert.equal(unknown.tts?.firstAudioAdviceSeverity, 'info')

  const slowRoundBuffer = resolveVoiceDiagnosticsSummary({
    speechOutput: { providerId: 'omnivoice-tts' },
    speechLevel: 0,
    transitionRecords: [
      makeRecord({ seq: 1, eventType: 'tts:first_audio', latencyMs: 1500 }),
    ],
    voicePipeline: makePipeline(),
    voiceState: 'idle',
    voiceTrace: [],
  })

  assert.equal(slowRoundBuffer.tts?.firstAudioLatencyStatus, 'slow')
  assert.equal(slowRoundBuffer.tts?.firstAudioAdviceId, 'switch_to_delta_streaming_provider')
  assert.equal(slowRoundBuffer.tts?.firstAudioAdviceSeverity, 'warning')
})

test('voice diagnostics report captures bounded evidence for export', () => {
  const report = buildVoiceDiagnosticsReport({
    speechOutput: {
      model: 'tts-1-hd',
      providerId: 'omnivoice-tts',
      voice: 'female-young-adult',
    },
    speechLevel: 0.5,
    transitionRecords: [
      makeRecord({ seq: 1, eventType: 'mic:acquired', latencyMs: 80 }),
      makeRecord({ seq: 2, eventType: 'stt:final', latencyMs: 220 }),
      makeRecord({ seq: 3, eventType: 'tts:first_audio', latencyMs: 430 }),
    ],
    voicePipeline: makePipeline({
      detail: 'ASR finished',
      step: 'recognized',
      transcript: 'voice transcript for diagnostics',
      updatedAt: '2026-06-16T10:00:03.000Z',
    }),
    voiceState: 'processing',
    voiceTrace: [
      makeTrace({ id: 'latest', title: 'Latest log', tone: 'info' }),
      makeTrace({ id: 'err', title: 'TTS error', tone: 'error', detail: 'provider timeout' }),
    ],
  }, {
    generatedAt: '2026-06-16T10:00:04.000Z',
    maxTraceEntries: 1,
    maxTransitionEntries: 2,
    maxTranscriptPreviewChars: 10,
  })

  assert.equal(report.schema, 'nexus.voice-diagnostics.v1')
  assert.equal(report.generatedAt, '2026-06-16T10:00:04.000Z')
  assert.equal(report.summary.status, 'active')
  assert.equal(report.summary.pipelineStep, 'recognized')
  assert.equal(report.pipeline.detail, 'ASR finished')
  assert.equal(report.pipeline.transcriptLength, 'voice transcript for diagnostics'.length)
  assert.equal(report.pipeline.transcriptPreview, 'voice t...')
  assert.equal(report.trace.latest?.id, 'latest')
  assert.equal(report.trace.latestError?.id, 'err')
  assert.deepEqual(report.trace.recent.map((entry) => entry.id), ['latest'])
  assert.equal(report.transitions.count, 3)
  assert.equal(report.transitions.latest?.seq, 3)
  assert.deepEqual(report.transitions.recent.map((entry) => entry.seq), [2, 3])
  assert.deepEqual(report.latencies.map((entry) => [entry.id, entry.latencyMs]), [
    ['wake_to_mic', 80],
    ['speech_to_stt', 220],
    ['stt_to_audio', 430],
  ])
  assert.equal(report.tts?.providerId, 'omnivoice-tts')
  assert.equal(report.tts?.model, 'tts-1-hd')
  assert.equal(report.tts?.voice, 'female-young-adult')
  assert.equal(report.tts?.localEngine, true)
  assert.equal(report.tts?.deltaStreaming, false)
  assert.equal(report.tts?.requestMode, 'round-buffer')
  assert.equal(report.tts?.maxRequestChars, 80)
  assert.equal(report.tts?.firstAudioBudgetMs, 1400)
  assert.equal(report.tts?.firstAudioTimeoutMs, 6000)
  assert.equal(report.tts?.firstAudioLatencyStatus, 'pass')
  assert.equal(report.tts?.firstAudioAdviceId, 'round_buffer_within_budget')
  assert.equal(report.tts?.firstAudioAdviceSeverity, 'info')
})

test('public voice diagnostics report omits private transcript, trace, transition and tts fields', () => {
  const report = buildPublicVoiceDiagnosticsReport({
    speechOutput: {
      model: 'private-tts-model',
      providerId: 'local-tts',
      voice: 'private-tts-voice',
    },
    speechLevel: 0.5,
    transitionRecords: [
      makeRecord({
        eventType: 'tts:first_audio',
        latencyMs: 430,
        meta: { detail: 'private transition meta' },
        provider: 'private-provider',
        reason: 'tts_provider_failover',
        seq: 3,
        sessionId: 'private-session',
      }),
    ],
    voicePipeline: makePipeline({
      detail: 'private pipeline detail',
      step: 'recognized',
      transcript: 'private voice transcript for diagnostics',
      updatedAt: '2026-06-16T10:00:03.000Z',
    }),
    voiceState: 'processing',
    voiceTrace: [
      makeTrace({
        detail: 'private trace detail',
        id: 'private-trace-id',
        title: 'Private trace title',
        tone: 'success',
      }),
    ],
  }, { generatedAt: '2026-06-16T10:00:04.000Z' })
  const json = JSON.stringify(report)

  assert.equal(report.ok, true)
  assert.equal(report.schema, 'nexus.voice-diagnostics.v1')
  assert.equal(report.pipeline.detailLength, 'private pipeline detail'.length)
  assert.equal(report.pipeline.transcriptLength, 'private voice transcript for diagnostics'.length)
  assert.equal(report.pipeline.transcriptPreviewLength, 'private voice transcript for diagnostics'.length)
  assert.equal(report.trace.latest?.titleLength, 'Private trace title'.length)
  assert.equal(report.trace.latest?.detailLength, 'private trace detail'.length)
  assert.equal(report.transitions.latest?.hasProvider, true)
  assert.equal(report.transitions.latest?.hasReason, true)
  assert.equal(report.transitions.latest?.hasMeta, true)
  assert.equal(report.tts?.modelConfigured, true)
  assert.equal(report.tts?.voiceConfigured, true)
  assert.ok(report.privacy.privateFieldsOmitted.includes('tts.model'))
  assert.equal(json.includes('private voice transcript'), false)
  assert.equal(json.includes('private pipeline detail'), false)
  assert.equal(json.includes('private-trace-id'), false)
  assert.equal(json.includes('Private trace title'), false)
  assert.equal(json.includes('private trace detail'), false)
  assert.equal(json.includes('private transition meta'), false)
  assert.equal(json.includes('private-provider'), false)
  assert.equal(json.includes('tts_provider_failover'), false)
  assert.equal(json.includes('private-session'), false)
  assert.equal(json.includes('private-tts-model'), false)
  assert.equal(json.includes('private-tts-voice'), false)
})

test('voice diagnostics input export preserves local runtime fields for report generation', () => {
  const inputExport = buildVoiceDiagnosticsInputExport({
    speechOutput: {
      model: 'private-tts-model',
      providerId: 'local-tts',
      voice: 'private-tts-voice',
    },
    speechLevel: 0.42,
    transitionRecords: [
      makeRecord({
        eventType: 'tts:first_audio',
        latencyMs: 430,
        meta: { detail: 'private transition meta' },
        provider: 'private-tts-provider',
        reason: 'tts_segment_started',
        sessionId: 'private-session',
      }),
    ],
    voicePipeline: makePipeline({
      detail: 'private pipeline detail',
      step: 'recognized',
      transcript: 'private voice transcript for diagnostics',
      updatedAt: '2026-06-16T18:00:03.000Z',
    }),
    voiceState: 'processing',
    voiceTrace: [
      makeTrace({
        detail: 'private trace detail',
        id: 'private-trace-id',
        title: 'Private trace title',
        tone: 'success',
      }),
    ],
  }, '2026-06-16T18:00:04Z')
  const json = JSON.stringify(inputExport)

  assert.equal(inputExport.schemaVersion, 1)
  assert.equal(inputExport.kind, 'nexus.voice-diagnostics-input-export')
  assert.equal(inputExport.generatedAt, '2026-06-16T18:00:04.000Z')
  assert.equal(inputExport.containsPrivateRuntimeFields, true)
  assert.equal(inputExport.usage.command.includes('voice:diagnostics:report'), true)
  assert.equal(json.includes('private voice transcript for diagnostics'), true)
  assert.equal(json.includes('private pipeline detail'), true)
  assert.equal(json.includes('private-trace-id'), true)
  assert.equal(json.includes('private transition meta'), true)
  assert.equal(json.includes('private-tts-model'), true)
  assert.equal(json.includes('private-tts-voice'), true)
})

test('voice diagnostics report args support input, output and readiness aliases', () => {
  assert.deepEqual(parseVoiceDiagnosticsReportArgs([
    '--input',
    'voice-diagnostics-input.json',
    '--generated-at',
    '2026-06-16T18:00:00Z',
    '--output',
    'artifacts/v0.3.4/voice-diagnostics.json',
    '--require-ready',
  ]), {
    generatedAt: '2026-06-16T18:00:00Z',
    help: false,
    inputPath: 'voice-diagnostics-input.json',
    outputPath: 'artifacts/v0.3.4/voice-diagnostics.json',
    requireReady: true,
  })
})

test('voice diagnostics report CLI accepts the runtime input export object', async () => {
  const outputRoot = await mkdtemp(path.join(os.tmpdir(), 'nexus-voice-diagnostics-export-'))
  const inputPath = path.join(outputRoot, 'voice-diagnostics-input.json')
  const outputPath = path.join(outputRoot, 'artifacts', 'v0.3.4', 'voice-diagnostics.json')
  try {
    await writeFile(inputPath, JSON.stringify(buildVoiceDiagnosticsInputExport({
      speechOutput: {
        model: 'private-tts-model',
        providerId: 'local-tts',
        voice: 'private-tts-voice',
      },
      speechLevel: 0.42,
      transitionRecords: [
        makeRecord({ seq: 1, eventType: 'mic:acquired', latencyMs: 80 }),
        makeRecord({ seq: 2, eventType: 'stt:final', latencyMs: 220 }),
        makeRecord({
          seq: 3,
          eventType: 'tts:first_audio',
          latencyMs: 430,
          meta: { detail: 'private tts meta' },
          provider: 'private-tts-provider',
          reason: 'tts_segment_started',
          sessionId: 'private-session',
        }),
      ],
      voicePipeline: makePipeline({
        detail: 'private pipeline detail',
        step: 'recognized',
        transcript: 'private voice transcript for diagnostics',
        updatedAt: '2026-06-16T18:00:03.000Z',
      }),
      voiceState: 'processing',
      voiceTrace: [
        makeTrace({
          detail: 'private trace detail',
          id: 'private-trace-id',
          title: 'Private trace title',
          tone: 'success',
        }),
      ],
    }, '2026-06-16T18:00:04Z')), 'utf8')

    const { stdout } = await execFileAsync(process.execPath, [
      '--experimental-strip-types',
      'scripts/voice-diagnostics-report.mjs',
      '--input',
      inputPath,
      '--generated-at',
      '2026-06-16T18:00:05.000Z',
      '--output',
      outputPath,
      '--require-ready',
    ], { cwd: process.cwd() })
    const stdoutReport = JSON.parse(stdout)
    const fileReport = JSON.parse(await readFile(outputPath, 'utf8'))
    const json = JSON.stringify(fileReport)

    assert.deepEqual(fileReport, stdoutReport)
    assert.equal(fileReport.ok, true)
    assert.equal(fileReport.schema, 'nexus.voice-diagnostics.v1')
    assert.equal(fileReport.generatedAt, '2026-06-16T18:00:05.000Z')
    assert.equal(fileReport.tts?.firstAudioLatencyStatus, 'pass')
    assert.equal(json.includes('private voice transcript'), false)
    assert.equal(json.includes('private pipeline detail'), false)
    assert.equal(json.includes('private-trace-id'), false)
    assert.equal(json.includes('private tts meta'), false)
    assert.equal(json.includes('private-tts-provider'), false)
    assert.equal(json.includes('private-session'), false)
    assert.equal(json.includes('private-tts-model'), false)
    assert.equal(json.includes('private-tts-voice'), false)
    assert.equal(json.includes(outputRoot), false)
  } finally {
    await rm(outputRoot, { recursive: true, force: true })
  }
})

test('voice diagnostics report CLI can persist private-safe evidence', async () => {
  const outputRoot = await mkdtemp(path.join(os.tmpdir(), 'nexus-voice-diagnostics-'))
  const inputPath = path.join(outputRoot, 'voice-diagnostics-input.json')
  const outputPath = path.join(outputRoot, 'artifacts', 'v0.3.4', 'voice-diagnostics.json')
  try {
    await writeFile(inputPath, JSON.stringify({
      speechLevel: 0.42,
      speechOutput: {
        model: 'private-tts-model',
        providerId: 'local-tts',
        voice: 'private-tts-voice',
      },
      transitionRecords: [
        {
          eventType: 'mic:acquired',
          latencyMs: 80,
          meta: { detail: 'private mic meta' },
          nextPhase: 'listening',
          prevPhase: 'idle',
          provider: 'private-mic-provider',
          reason: 'mic_acquired',
          seq: 1,
          sessionId: 'private-session',
          ts: 1_000,
        },
        {
          eventType: 'stt:final',
          latencyMs: 220,
          nextPhase: 'thinking',
          prevPhase: 'transcribing',
          provider: 'private-stt-provider',
          reason: 'stt_success',
          seq: 2,
          sessionId: 'private-session',
          ts: 1_200,
        },
        {
          eventType: 'tts:first_audio',
          latencyMs: 430,
          meta: { detail: 'private tts meta' },
          nextPhase: 'speaking',
          prevPhase: 'thinking',
          provider: 'private-tts-provider',
          reason: 'tts_segment_started',
          seq: 3,
          sessionId: 'private-session',
          ts: 1_600,
        },
      ],
      voicePipeline: {
        detail: 'private pipeline detail',
        step: 'recognized',
        transcript: 'private voice transcript for diagnostics',
        updatedAt: '2026-06-16T18:00:03.000Z',
      },
      voiceState: 'processing',
      voiceTrace: [
        {
          createdAt: '2026-06-16T18:00:02.000Z',
          detail: 'private trace detail',
          id: 'private-trace-id',
          title: 'Private trace title',
          tone: 'success',
        },
      ],
    }), 'utf8')

    const { stdout } = await execFileAsync(process.execPath, [
      '--experimental-strip-types',
      'scripts/voice-diagnostics-report.mjs',
      '--input',
      inputPath,
      '--generated-at',
      '2026-06-16T18:00:04.000Z',
      '--output',
      outputPath,
      '--require-ready',
    ], { cwd: process.cwd() })
    const stdoutReport = JSON.parse(stdout)
    const fileReport = JSON.parse(await readFile(outputPath, 'utf8'))
    const json = JSON.stringify(fileReport)

    assert.deepEqual(fileReport, stdoutReport)
    assert.equal(fileReport.ok, true)
    assert.equal(fileReport.summary.status, 'active')
    assert.equal(fileReport.latencies.find((entry) => entry.id === 'stt_to_audio')?.latencyMs, 430)
    assert.equal(fileReport.tts?.firstAudioLatencyStatus, 'pass')
    assert.equal(fileReport.tts?.modelConfigured, true)
    assert.equal(fileReport.tts?.voiceConfigured, true)
    assert.equal(json.includes('private voice transcript'), false)
    assert.equal(json.includes('private pipeline detail'), false)
    assert.equal(json.includes('private-trace-id'), false)
    assert.equal(json.includes('Private trace title'), false)
    assert.equal(json.includes('private trace detail'), false)
    assert.equal(json.includes('private mic meta'), false)
    assert.equal(json.includes('private tts meta'), false)
    assert.equal(json.includes('private-mic-provider'), false)
    assert.equal(json.includes('private-stt-provider'), false)
    assert.equal(json.includes('private-tts-provider'), false)
    assert.equal(json.includes('private-session'), false)
    assert.equal(json.includes('private-tts-model'), false)
    assert.equal(json.includes('private-tts-voice'), false)
    assert.equal(json.includes(outputRoot), false)
  } finally {
    await rm(outputRoot, { recursive: true, force: true })
  }
})

test('voice diagnostics report CLI fails readiness for error evidence', async () => {
  const outputRoot = await mkdtemp(path.join(os.tmpdir(), 'nexus-voice-diagnostics-bad-'))
  const inputPath = path.join(outputRoot, 'voice-diagnostics-input.json')
  try {
    await writeFile(inputPath, JSON.stringify({
      voicePipeline: {
        detail: 'private failed pipeline detail',
        step: 'reply_failed',
        transcript: 'private failed transcript',
        updatedAt: '2026-06-16T18:10:03.000Z',
      },
      voiceState: 'idle',
      voiceTrace: [
        {
          createdAt: '2026-06-16T18:10:02.000Z',
          detail: 'private provider error detail',
          id: 'private-error-id',
          title: 'Private provider error',
          tone: 'error',
        },
      ],
    }), 'utf8')

    await assert.rejects(
      execFileAsync(process.execPath, [
        '--experimental-strip-types',
        'scripts/voice-diagnostics-report.mjs',
        '--input',
        inputPath,
        '--require-ready',
      ], { cwd: process.cwd() }),
      (error: unknown) => {
        const err = error as { code?: number; stdout?: string }
        assert.equal(err.code, 1)
        const report = JSON.parse(err.stdout ?? '{}')
        const json = JSON.stringify(report)
        assert.equal(report.ok, false)
        assert.equal(report.summary.status, 'error')
        assert.equal(json.includes('private failed pipeline detail'), false)
        assert.equal(json.includes('private failed transcript'), false)
        assert.equal(json.includes('private provider error detail'), false)
        assert.equal(json.includes('private-error-id'), false)
        return true
      },
    )
  } finally {
    await rm(outputRoot, { recursive: true, force: true })
  }
})

test('voice diagnostics report wiring stays available in packaged builds', async () => {
  const pkg = JSON.parse(await readFile(path.join(process.cwd(), 'package.json'), 'utf8'))

  assert.equal(
    pkg.scripts?.['voice:diagnostics:report'],
    'node --experimental-strip-types scripts/voice-diagnostics-report.mjs',
  )
  assert.ok(pkg.build?.files?.includes('scripts/voice-diagnostics-report.mjs'))
  assert.ok(pkg.build?.asarUnpack?.includes('scripts/voice-diagnostics-report.mjs'))
})
