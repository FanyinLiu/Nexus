import assert from 'node:assert/strict'
import test from 'node:test'

import { formatTencentHotwordList } from '../src/features/hearing/tencentHotwords.ts'
import {
  buildLocalModelRows,
  localModelCanResume,
  localModelDiskBlocksDownload,
  localModelDownloadAction,
} from '../src/features/setup/localModelRepair.ts'
import { resolveSherpaStreamIdleTimeoutMs } from '../src/features/voice/sherpaIdleTimeout.ts'
import {
  buildSpeechRecognitionProbe,
  classifyRecognitionProbe,
  planSpeechInputConnectionTest,
  SPEECH_PROBE_DURATION_MS,
  SPEECH_PROBE_SAMPLE_RATE,
} from '../src/features/voice/speechInputProbe.ts'
import { visibleSpeechAdjustments } from '../src/features/voice/ttsAdjustments.ts'

const model = {
  id: 'kws-en',
  label: 'English wake word',
  sizeLabel: '~15 MB',
  required: true,
  present: false,
}

test('local model rows follow install, failure, and download progress', () => {
  const rows = buildLocalModelRows(
    [model, { ...model, id: 'vad', present: true }, { ...model, id: 'sensevoice', required: false }],
    {
      'kws-en': { phase: 'downloading', downloaded: 50, total: 100 },
      sensevoice: { phase: 'error', downloaded: 10, total: 100, message: 'failed' },
    },
  )
  assert.deepEqual(rows.map((row) => [row.id, row.status, row.percent]), [
    ['kws-en', 'downloading', 50],
    ['vad', 'installed', null],
    ['sensevoice', 'failed', 10],
  ])
})

test('download action resumes a partial, retries a failure, and stops when nothing is missing', () => {
  assert.equal(localModelDownloadAction({ missingCount: 2, resumable: true, hadFailure: true }), 'resume')
  assert.equal(localModelDownloadAction({ missingCount: 2, resumable: false, hadFailure: true }), 'retry')
  assert.equal(localModelDownloadAction({ missingCount: 2, resumable: false, hadFailure: false }), 'download')
  assert.equal(localModelDownloadAction({ missingCount: 0, resumable: true, hadFailure: false }), 'resume')
  assert.equal(localModelDownloadAction({ missingCount: 0, resumable: false, hadFailure: true }), 'none')
  assert.equal(localModelDiskBlocksDownload({ ok: false }), true)
  assert.equal(localModelDiskBlocksDownload({ ok: true }), false)
  assert.equal(localModelDiskBlocksDownload(undefined), false)
  assert.equal(localModelCanResume({
    models: [{ ...model, resumable: true }],
    ready: false,
    missingRequired: ['kws-en'],
  }), true)
})

test('sherpa idle timeout uses the stored setting inside 3 to 120 seconds', () => {
  assert.equal(resolveSherpaStreamIdleTimeoutMs(10_000), 10_000)
  assert.equal(resolveSherpaStreamIdleTimeoutMs(1_000), 3_000)
  assert.equal(resolveSherpaStreamIdleTimeoutMs(999_999), 120_000)
  assert.equal(resolveSherpaStreamIdleTimeoutMs(10_000.4), 10_000)
  assert.equal(resolveSherpaStreamIdleTimeoutMs(undefined), 9_000)
  assert.equal(resolveSherpaStreamIdleTimeoutMs(Number.NaN), 9_000)
})

test('speech input test runs local recognition and leaves Tencent unavailable', () => {
  assert.deepEqual(planSpeechInputConnectionTest('local-sensevoice'), { mode: 'sensevoice-recognition' })
  assert.deepEqual(planSpeechInputConnectionTest('local-paraformer'), { mode: 'paraformer-recognition' })
  assert.deepEqual(planSpeechInputConnectionTest('tencent-asr'), {
    mode: 'unavailable',
    reasonKey: 'settings.speech_input.test_unavailable_tencent',
  })
  assert.deepEqual(planSpeechInputConnectionTest('zhipu-stt'), { mode: 'remote' })
})

test('recognition probe is a short tone and empty text counts as silence', () => {
  const samples = buildSpeechRecognitionProbe()
  assert.equal(samples.length, (SPEECH_PROBE_SAMPLE_RATE * SPEECH_PROBE_DURATION_MS) / 1000)
  assert.ok(samples.some((sample) => Math.abs(sample) > 0.01))
  assert.equal(classifyRecognitionProbe({ text: '你好' }), 'transcript')
  assert.equal(classifyRecognitionProbe({ text: '   ' }), 'silent')
  assert.equal(classifyRecognitionProbe({ text: 1 }), 'invalid')
  assert.equal(classifyRecognitionProbe(null), 'invalid')
})

test('Tencent hotwords become word|weight pairs', () => {
  assert.equal(formatTencentHotwordList(''), '')
  assert.equal(formatTencentHotwordList(' 星绘|11， Nexus , 星绘|4 '), '星绘|11,Nexus|10')
  assert.equal(formatTencentHotwordList('word|0'), 'word|10')
  assert.equal(formatTencentHotwordList('word|100'), 'word|100')
  assert.equal(formatTencentHotwordList(`${'很长的词'.repeat(20)}|5`).split('|')[0].length, 30)
})

test('speech tuning sliders appear only for controls the provider sends', () => {
  assert.deepEqual(visibleSpeechAdjustments({ rate: true, pitch: true, volume: true }), {
    rate: true,
    pitch: true,
    volume: true,
    any: true,
  })
  assert.deepEqual(visibleSpeechAdjustments({ rate: true, pitch: false, volume: false }), {
    rate: true,
    pitch: false,
    volume: false,
    any: true,
  })
  assert.deepEqual(visibleSpeechAdjustments({ rate: false, pitch: false, volume: false }), {
    rate: false,
    pitch: false,
    volume: false,
    any: false,
  })
})
