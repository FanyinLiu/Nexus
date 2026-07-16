import assert from 'node:assert/strict'
import test from 'node:test'

import {
  SPEECH_CONNECTION_MESSAGE,
  VOLCENGINE_STT_STATUS,
  buildSpeechConnectionEvidence,
  buildSpeechConnectionResult,
  classifyEvidenceIdentity,
  classifyOpenAiCompatibleSpeechInputProbe,
  classifySpeechOutputProbe,
  classifyVolcengineSpeechInputProbe,
  classifyVolcengineSpeechInputStatus,
  detectAudioSignature,
  extractSpeechInputText,
  hasSpeechInputResponseShape,
  hasSpeechOutputAudio,
  inspectSpeechOutputAudio,
  isAcceptedNoSpeechResponse,
  redactSpeechConnectionText,
} from '../electron/services/speechConnectionProof.js'
import {
  connectionEvidenceMeetsCapability,
  getConnectionTestResultPresentation,
} from '../src/features/models/connectionTestFreshness.ts'

function wavBuffer(payloadLength = 4) {
  const buffer = Buffer.alloc(12 + payloadLength)
  buffer.write('RIFF', 0, 'ascii')
  buffer.writeUInt32LE(36 + payloadLength, 4)
  buffer.write('WAVE', 8, 'ascii')
  return buffer
}

// ── Speech input envelopes ──────────────────────────────────────────────

test('speech input: table-driven empty/malformed envelopes are never ready', () => {
  const cases = [
    { name: 'empty object', data: {}, expect: false },
    { name: 'null', data: null, expect: false },
    { name: 'array', data: [], expect: false },
    { name: 'error envelope', data: { error: { message: 'invalid key' } }, expect: false },
    { name: 'detail error', data: { detail: { error: 'bad' } }, expect: false },
    { name: 'message only', data: { message: 'model not found' }, expect: false },
    { name: '2xx no fields', data: { status: 'ok' }, expect: false },
    { name: 'empty text field', data: { text: '' }, expect: true },
    { name: 'transcript field', data: { transcript: 'hello' }, expect: true },
    { name: 'nested result text', data: { result: { text: '' } }, expect: true },
    { name: 'error wins over text', data: { text: 'x', error: { code: 'bad' } }, expect: false },
  ] as const

  for (const entry of cases) {
    assert.equal(
      hasSpeechInputResponseShape(entry.data),
      entry.expect,
      entry.name,
    )
  }
})

test('speech input: broad no-speech free text is not success; known codes are', () => {
  const cases = [
    { status: 400, data: { error: { code: 'no_speech' } }, expect: true },
    { status: 422, data: { code: 'audio_too_short' }, expect: true },
    { status: 400, data: { error: { code: 'no_speech_detected' } }, expect: true },
    // Broad free-text false positives must fail.
    { status: 400, data: { message: 'no speech detected in audio' }, expect: false },
    { status: 400, data: { error: { message: 'silence' } }, expect: false },
    { status: 422, data: { message: '未检测到语音' }, expect: false },
    { status: 400, data: { message: '没有听到' }, expect: false },
    { status: 500, data: { error: { code: 'no_speech' } }, expect: false },
    { status: 401, data: { error: { code: 'no_speech' } }, expect: false },
    { status: 429, data: { error: { code: 'no_speech_detected' } }, expect: false },
    { status: 200, data: { error: { code: 'no_speech' } }, expect: false },
  ] as const

  for (const entry of cases) {
    assert.equal(
      isAcceptedNoSpeechResponse(entry.status, entry.data),
      entry.expect,
      `status=${entry.status} data=${JSON.stringify(entry.data)}`,
    )
  }
})

test('speech input: real-path text extraction stays correlated with probe shapes', () => {
  assert.equal(extractSpeechInputText({ text: 'hello' }), 'hello')
  assert.equal(extractSpeechInputText({ transcript: 'world' }), 'world')
  assert.equal(extractSpeechInputText({ result: { text: 'nested' } }), 'nested')
  assert.equal(extractSpeechInputText({ message: 'not a transcript' }), '')
  assert.equal(extractSpeechInputText(null), '')
})

test('speech input: OpenAI-compatible classifier rejects empty 2xx and accepts shapes', () => {
  const cases = [
    {
      name: 'empty 2xx',
      status: 200,
      data: {},
      ok: false,
      code: 'invalid_probe_response',
    },
    {
      name: 'malformed envelope',
      status: 200,
      data: { message: 'ok' },
      ok: false,
      code: 'invalid_probe_response',
    },
    {
      name: 'text result',
      status: 200,
      data: { text: 'hello' },
      ok: true,
      messageKey: SPEECH_CONNECTION_MESSAGE.INPUT_READY,
    },
    {
      name: 'empty text result (silent wav)',
      status: 200,
      data: { text: '' },
      ok: true,
      messageKey: SPEECH_CONNECTION_MESSAGE.INPUT_READY_SILENT,
    },
    {
      name: 'accepted no-speech code',
      status: 400,
      data: { error: { code: 'no_speech' } },
      ok: true,
      messageKey: SPEECH_CONNECTION_MESSAGE.INPUT_READY_SILENT,
    },
    {
      name: 'broad no-speech false positive',
      status: 400,
      data: { message: 'no speech in the request' },
      ok: false,
      code: 'provider_error',
    },
  ] as const

  for (const entry of cases) {
    const result = classifyOpenAiCompatibleSpeechInputProbe({
      status: entry.status,
      data: entry.data,
    })
    assert.equal(result.ok, entry.ok, entry.name)
    if ('code' in entry && entry.code) {
      assert.equal(result.code, entry.code, entry.name)
    }
    if ('messageKey' in entry && entry.messageKey) {
      assert.equal(result.messageKey, entry.messageKey, entry.name)
    }
  }
})

// ── Volcengine STT status table ─────────────────────────────────────────

test('Volcengine STT: table-driven success and failure status codes', () => {
  const cases = [
    { code: VOLCENGINE_STT_STATUS.SUCCESS, ok: true, kind: 'success' },
    { code: VOLCENGINE_STT_STATUS.SILENT_OR_NO_SPEECH, ok: true, kind: 'no_speech' },
    { code: '20000000', ok: true, kind: 'success' },
    { code: '20000003', ok: true, kind: 'no_speech' },
    { code: '', ok: false, kind: 'missing_status' },
    { code: undefined, ok: false, kind: 'missing_status' },
    { code: '45000001', ok: false, kind: 'provider_error' },
    { code: '55000000', ok: false, kind: 'provider_error' },
    { code: 'ok', ok: false, kind: 'provider_error' },
  ] as const

  for (const entry of cases) {
    const classified = classifyVolcengineSpeechInputStatus(entry.code)
    assert.equal(classified.ok, entry.ok, `code=${entry.code}`)
    assert.equal(classified.kind, entry.kind, `code=${entry.code}`)

    const probe = classifyVolcengineSpeechInputProbe({ statusCode: entry.code })
    assert.equal(probe.ok, entry.ok, `probe code=${entry.code}`)
    if (!entry.ok) {
      assert.ok(
        probe.code === 'invalid_probe_response' || probe.code === 'provider_error',
        `probe failure code for ${entry.code}`,
      )
    }
  }
})

// ── Speech output audio proof ───────────────────────────────────────────

test('speech output: empty/malformed/non-audio bytes fail; valid signatures pass', () => {
  const cases = [
    { name: 'missing', result: {}, ok: false },
    { name: 'empty pcm', result: { pcmBuffer: Buffer.alloc(0) }, ok: false },
    { name: 'one-byte pcm', result: { pcmBuffer: Buffer.from([0]) }, ok: false },
    { name: 'valid pcm int16', result: { pcmBuffer: Buffer.from([0, 1]) }, ok: true },
    { name: 'odd pcm length', result: { pcmBuffer: Buffer.from([0, 1, 2]) }, ok: false },
    {
      name: 'empty base64',
      result: { audioBase64: '' },
      ok: false,
    },
    {
      name: 'one-byte base64 without signature',
      result: { audioBase64: Buffer.from([0]).toString('base64') },
      ok: false,
    },
    {
      name: 'json disguised as audio',
      result: {
        audioBase64: Buffer.from('{"error":"nope"}', 'utf8').toString('base64'),
        mimeType: 'audio/mpeg',
      },
      ok: false,
    },
    {
      name: 'text content-type',
      result: {
        audioBase64: wavBuffer().toString('base64'),
        mimeType: 'application/json',
      },
      ok: false,
    },
    {
      name: 'wav signature',
      result: {
        audioBase64: wavBuffer().toString('base64'),
        mimeType: 'audio/wav',
      },
      ok: true,
      signature: 'wav',
    },
    {
      name: 'ogg signature',
      result: {
        audioBase64: Buffer.from('OggS........').toString('base64'),
        mimeType: 'audio/ogg',
      },
      ok: true,
      signature: 'ogg',
    },
    {
      name: 'mp3 id3',
      result: {
        audioBase64: Buffer.from('ID3.........').toString('base64'),
        mimeType: 'audio/mpeg',
      },
      ok: true,
      signature: 'mp3-id3',
    },
    {
      name: 'declared pcm via sample rate',
      result: {
        audioBase64: Buffer.from([0, 1, 2, 3]).toString('base64'),
        pcmSampleRate: 24000,
      },
      ok: true,
      signature: 'pcm',
    },
    {
      name: 'raw bytes without mime or signature',
      result: {
        audioBase64: Buffer.from([0x10, 0x20, 0x30, 0x40]).toString('base64'),
      },
      ok: false,
    },
    {
      name: 'stream without bytes',
      result: { pcmStream: { destroy() {} } },
      ok: false,
    },
  ] as const

  for (const entry of cases) {
    const inspection = inspectSpeechOutputAudio(entry.result)
    assert.equal(inspection.ok, entry.ok, entry.name)
    assert.equal(hasSpeechOutputAudio(entry.result), entry.ok, entry.name)
    if (entry.ok && 'signature' in entry) {
      assert.equal(inspection.signature, entry.signature, entry.name)
      assert.equal(inspection.evidenceKind, 'audio-response', entry.name)
    }
  }

  assert.equal(detectAudioSignature(wavBuffer()), 'wav')
})

test('speech output: synthesis evidence is not playback proof', () => {
  const audio = {
    pcmBuffer: Buffer.from([0, 1, 2, 3]),
  }
  const result = classifySpeechOutputProbe(audio, {
    providerId: 'openai-tts',
    modelId: 'tts-1',
    voiceId: 'alloy',
  })

  assert.equal(result.ok, true)
  assert.equal(result.messageKey, SPEECH_CONNECTION_MESSAGE.OUTPUT_SYNTHESIS_READY)
  assert.equal(result.evidence?.kind, 'audio-response')
  assert.equal(result.evidence?.partial, true)
  assert.notEqual(result.evidence?.kind, 'playback')
  // Connection capability accepts synthesis; presentation must not claim speakers.
  assert.equal(
    connectionEvidenceMeetsCapability('speech-output', result.evidence),
    true,
  )
  assert.match(String(result.message), /尚未验证本机扬声器播放|合成音频/)
})

// ── Evidence identity ───────────────────────────────────────────────────

test('evidence identity: mismatch and fallback surface partial not target-ready', () => {
  const matched = classifyEvidenceIdentity({
    requestedProviderId: 'volcengine-tts',
    requestedModelId: 'volcano_tts',
    requestedVoiceId: 'BV001_streaming',
    observedProviderId: 'volcengine-tts',
    observedModelId: 'volcano_tts',
    observedVoiceId: 'BV001_streaming',
  })
  assert.equal(matched.state, 'matched')
  assert.equal(matched.identityMismatch, false)

  const mismatch = classifyEvidenceIdentity({
    requestedProviderId: 'volcengine-tts',
    requestedModelId: 'volcano_tts',
    requestedVoiceId: 'BV001_streaming',
    observedVoiceId: 'BV002_streaming',
  })
  assert.equal(mismatch.state, 'mismatch')
  assert.equal(mismatch.identityMismatch, true)

  const fallback = classifyEvidenceIdentity({
    requestedProviderId: 'volcengine-tts',
    requestedVoiceId: 'custom-voice',
    observedVoiceId: 'BV001_streaming',
    usedFallback: true,
  })
  assert.equal(fallback.state, 'fallback')
  assert.equal(fallback.identityMismatch, true)
  assert.equal(fallback.usedFallback, true)

  const evidence = buildSpeechConnectionEvidence({
    kind: 'audio-response',
    providerId: 'volcengine-tts',
    modelId: 'volcano_tts',
    voiceId: 'custom-voice',
    observedVoiceId: 'BV001_streaming',
    usedFallback: true,
    synthesisOnly: true,
  })
  assert.equal(evidence.identityMismatch, true)
  assert.equal(evidence.usedFallback, true)
  assert.equal(evidence.partial, true)
  assert.equal(connectionEvidenceMeetsCapability('speech-output', evidence), false)

  const now = new Date('2026-07-11T12:05:00.000Z')
  const presentation = getConnectionTestResultPresentation({
    result: {
      ok: true,
      checkedAt: '2026-07-11T12:00:00.000Z',
      evidence,
    },
    fingerprintMatches: true,
    capability: 'speech-output',
  }, now)
  assert.equal(presentation.tone, 'partial')
  assert.equal(presentation.verified, false)

  const probe = classifySpeechOutputProbe({
    audioBase64: wavBuffer().toString('base64'),
    mimeType: 'audio/wav',
    resolvedVoice: 'BV001_streaming',
    resolvedCluster: 'volcano_tts',
    usedFallback: true,
  }, {
    providerId: 'volcengine-tts',
    modelId: 'volcano_tts',
    voiceId: 'custom-voice',
  })
  assert.equal(probe.ok, true)
  assert.equal(probe.messageKey, SPEECH_CONNECTION_MESSAGE.OUTPUT_SYNTHESIS_FALLBACK)
  assert.equal(probe.evidence?.identityMismatch, true)
})

test('preflight and endpoint evidence never meet speech-input readiness', () => {
  assert.equal(
    connectionEvidenceMeetsCapability('speech-input', { kind: 'preflight', providerId: 'sensevoice' }),
    false,
  )
  assert.equal(
    connectionEvidenceMeetsCapability('speech-input', { kind: 'endpoint', providerId: 'openai-stt' }),
    false,
  )
  assert.equal(
    connectionEvidenceMeetsCapability('speech-input', {
      kind: 'audio-response',
      providerId: 'openai-stt',
      modelId: 'whisper-1',
    }),
    true,
  )
})

// ── Structured localization + redaction ─────────────────────────────────

test('structured results use stable codes and never embed transcripts or secrets', () => {
  const withSecret = buildSpeechConnectionResult({
    ok: false,
    messageKey: SPEECH_CONNECTION_MESSAGE.INPUT_PROVIDER_ERROR,
    code: 'provider_error',
    messageParams: {
      statusCode: '45000001',
      hint: 'Bearer sk-abcdefghijklmnopqrstuvwxyz012345 Authorization: secret',
    },
    diagnosticDetail: 'raw provider body with sk-abcdefghijklmnopqrstuvwxyz012345 and user said hello world',
  })

  assert.equal(withSecret.messageKey, SPEECH_CONNECTION_MESSAGE.INPUT_PROVIDER_ERROR)
  assert.equal(withSecret.code, 'provider_error')
  assert.ok(withSecret.messageParams?.hint)
  assert.doesNotMatch(String(withSecret.messageParams?.hint), /sk-[A-Za-z0-9]{10,}/)
  assert.doesNotMatch(String(withSecret.message), /hello world/)
  assert.doesNotMatch(JSON.stringify(withSecret), /sk-abcdefghijklmnopqrstuvwxyz012345/)
  // Primary message is the safe fallback, never the raw diagnostic body.
  assert.equal(
    withSecret.message,
    '语音识别服务返回了异常状态，请检查接口和凭据。',
  )

  const redacted = redactSpeechConnectionText(
    'token=secret-value Bearer sk-abcdefghijklmnopqrstuvwxyz012345 path=/Users/alice/secret.wav',
  )
  assert.doesNotMatch(redacted, /sk-abcdefghijklmnopqrstuvwxyz012345/)
  assert.doesNotMatch(redacted, /\/Users\/alice/)
  assert.match(redacted, /Bearer \*\*\*/)
})

test('playback evidence is distinct from synthesis-only audio-response', () => {
  const synthesis = buildSpeechConnectionEvidence({
    kind: 'audio-response',
    providerId: 'edge-tts',
    voiceId: 'zh-CN-XiaoxiaoNeural',
    synthesisOnly: true,
  })
  const playback = buildSpeechConnectionEvidence({
    kind: 'playback',
    providerId: 'edge-tts',
    voiceId: 'zh-CN-XiaoxiaoNeural',
  })

  assert.equal(synthesis.kind, 'audio-response')
  assert.equal(synthesis.partial, true)
  assert.equal(playback.kind, 'playback')
  assert.equal(playback.partial, undefined)
  assert.equal(connectionEvidenceMeetsCapability('speech-output', synthesis), true)
  assert.equal(connectionEvidenceMeetsCapability('speech-output', playback), true)

  const now = new Date('2026-07-11T12:05:00.000Z')
  const synthesisPresentation = getConnectionTestResultPresentation({
    result: {
      ok: true,
      checkedAt: '2026-07-11T12:00:00.000Z',
      evidence: synthesis,
    },
    fingerprintMatches: true,
    capability: 'speech-output',
  }, now)
  assert.equal(synthesisPresentation.tone, 'success')
  assert.equal(synthesisPresentation.verified, true)
})
