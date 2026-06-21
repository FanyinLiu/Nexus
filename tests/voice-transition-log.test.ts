import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { VoiceBusEvent } from '../src/features/voice/busEvents.ts'
import type { VoicePhase } from '../src/features/voice/session/voiceSessionTypes.ts'
import { VoiceReasonCodes } from '../src/features/voice/voiceReasonCodes.ts'
import { VoiceTransitionLog } from '../src/features/voice/voiceTransitionLog.ts'

// ── Test helpers ───────────────────────────────────────────────────────────
// A deterministic clock keeps the latency math checkable; each advance() call
// bumps the clock by the given delta and returns the new time, so record()
// sites read a predictable ts.
function createClock(start = 1_000_000) {
  let now = start
  return {
    now: () => now,
    advance(delta: number) {
      now += delta
      return now
    },
    set(value: number) {
      now = value
      return now
    },
  }
}

type RecordArgs = {
  event: VoiceBusEvent
  prevPhase?: VoicePhase
  nextPhase?: VoicePhase
}

// Thin wrapper over log.record so tests read as event streams rather than
// phase bookkeeping. Phase defaults don't matter for the log's classification
// logic — it only persists them — so we default to idle/idle unless the test
// cares about the transition.
function record(
  log: VoiceTransitionLog,
  { event, prevPhase = 'idle', nextPhase = 'idle' }: RecordArgs,
) {
  return log.record({ event, prevPhase, nextPhase })
}

// ── Happy path ─────────────────────────────────────────────────────────────

test('happy path: wake → speech → stt → tts records all three latency slices', () => {
  const clock = createClock()
  const log = new VoiceTransitionLog({ now: clock.now })
  const sessionId = 'voice-happy-1'

  // t=0: wake word fires
  record(log, {
    event: {
      type: 'wake:detected',
      wakeWord: '小助手',
      keyword: '小助手',
      sessionId,
      reason: VoiceReasonCodes.WAKE_MATCH,
    },
    prevPhase: 'idle',
    nextPhase: 'listening',
  })

  // t=+120ms: mic acquired → derives wake_to_mic
  clock.advance(120)
  const micRec = record(log, {
    event: {
      type: 'mic:acquired',
      purpose: 'voice_input',
      sessionId,
      reason: VoiceReasonCodes.MIC_ACQUIRED,
    },
    prevPhase: 'listening',
    nextPhase: 'listening',
  })

  // t=+80ms: user starts speaking
  clock.advance(80)
  record(log, {
    event: {
      type: 'vad:speech_start',
      sessionId,
      reason: VoiceReasonCodes.VAD_SPEECH_START,
    },
  })

  // t=+1500ms: user stops
  clock.advance(1500)
  record(log, {
    event: {
      type: 'vad:speech_end',
      sessionId,
      reason: VoiceReasonCodes.VAD_SPEECH_END,
    },
  })

  // t=+600ms: stt final arrives → derives speech_end_to_stt_final
  clock.advance(600)
  const sttRec = record(log, {
    event: {
      type: 'stt:final',
      text: '帮我查天气',
      sessionId,
      reason: VoiceReasonCodes.STT_SUCCESS,
    },
    prevPhase: 'transcribing',
    nextPhase: 'transcribing',
  })

  // t=+900ms: first PCM chunk arrives → derives stt_final_to_first_audio
  clock.advance(900)
  const ttsRec = record(log, {
    event: {
      type: 'tts:first_audio',
      speechGeneration: 1,
      sessionId,
      reason: VoiceReasonCodes.TTS_SEGMENT_STARTED,
    },
    prevPhase: 'transcribing',
    nextPhase: 'speaking',
  })

  // t=+2000ms: session wraps up
  clock.advance(2000)
  record(log, {
    event: {
      type: 'session:completed',
      sessionId,
      reason: VoiceReasonCodes.SESSION_COMPLETED,
    },
    prevPhase: 'speaking',
    nextPhase: 'idle',
  })

  // Each derived latency shows up on the record that closes the slice.
  assert.equal(micRec.latencyMs, 120, 'wake→mic latency attached to mic:acquired record')
  assert.equal(sttRec.latencyMs, 600, 'speech_end→stt_final latency attached to stt:final record')
  assert.equal(ttsRec.latencyMs, 900, 'stt_final→first_audio latency attached to tts:first_audio record')

  // Full breakdown cannot be queried after session:completed (the timeline is
  // purged so future sessions reusing the id get clean stamps), but the per-
  // record latencies above already prove every slice was computed correctly.
  assert.equal(log.getTimeline(sessionId), null, 'timeline is cleared on session:completed')

  // The whole sequence is visible as append-only entries with monotonic seq.
  const entries = log.getEntries()
  assert.equal(entries.length, 7)
  assert.deepEqual(
    entries.map((e) => e.eventType),
    [
      'wake:detected',
      'mic:acquired',
      'vad:speech_start',
      'vad:speech_end',
      'stt:final',
      'tts:first_audio',
      'session:completed',
    ],
  )
  for (let i = 1; i < entries.length; i++) {
    assert.equal(entries[i]!.seq, entries[i - 1]!.seq + 1, 'seq is strictly monotonic')
  }
})

// ── No-speech path ─────────────────────────────────────────────────────────

test('no-speech path: VAD timeout is recorded with its reason code and meta', () => {
  const clock = createClock()
  const log = new VoiceTransitionLog({ now: clock.now })
  const sessionId = 'voice-nospeech-1'

  record(log, {
    event: {
      type: 'wake:detected',
      wakeWord: '小助手',
      keyword: '小助手',
      sessionId,
      reason: VoiceReasonCodes.WAKE_MATCH,
    },
    prevPhase: 'idle',
    nextPhase: 'listening',
  })

  clock.advance(8000)
  const timeoutRec = record(log, {
    event: {
      type: 'vad:no_speech_timeout',
      waitedMs: 8000,
      sessionId,
      reason: VoiceReasonCodes.VAD_NO_SPEECH_TIMEOUT,
      meta: { source: 'browser_vad' },
    },
    prevPhase: 'listening',
    nextPhase: 'idle',
  })

  assert.equal(timeoutRec.reason, VoiceReasonCodes.VAD_NO_SPEECH_TIMEOUT)
  assert.equal(timeoutRec.latencyMs, null, 'no-speech path produces no derived latency')
  assert.deepEqual(timeoutRec.meta, { source: 'browser_vad' })

  // wake_to_mic never closes because mic:acquired never fires.
  const breakdown = log.getLatencyBreakdown(sessionId)
  assert.equal(breakdown.wakeToMicMs, null)
  assert.equal(breakdown.speechEndToSttFinalMs, null)
  assert.equal(breakdown.sttFinalToFirstAudioMs, null)
})

// ── Multi-segment TTS lifecycle ────────────────────────────────────────────

test('multi-segment TTS produces one queued/started/finished per segment plus one first_audio', () => {
  const clock = createClock()
  const log = new VoiceTransitionLog({ now: clock.now })
  const sessionId = 'voice-multiseg-1'

  // Three queued segments (e.g. a long reply split at sentence boundaries).
  for (let segmentIndex = 0; segmentIndex < 3; segmentIndex++) {
    record(log, {
      event: {
        type: 'tts:segment_queued',
        segmentIndex,
        speechGeneration: 1,
        sessionId,
        reason: VoiceReasonCodes.TTS_SEGMENT_QUEUED,
      },
    })
    clock.advance(10)
  }

  // Main-process session accepts each segment in order → started events arrive.
  for (let segmentIndex = 0; segmentIndex < 3; segmentIndex++) {
    record(log, {
      event: {
        type: 'tts:segment_started',
        segmentIndex,
        speechGeneration: 1,
        sessionId,
        reason: VoiceReasonCodes.TTS_SEGMENT_STARTED,
      },
    })
    clock.advance(5)
  }

  // First audio chunk arrives for the first segment — request-level marker.
  record(log, {
    event: {
      type: 'tts:first_audio',
      speechGeneration: 1,
      sessionId,
    },
  })
  clock.advance(10)

  // Each push_text resolution → segment_finished fires.
  for (let segmentIndex = 0; segmentIndex < 3; segmentIndex++) {
    record(log, {
      event: {
        type: 'tts:segment_finished',
        segmentIndex,
        speechGeneration: 1,
        sessionId,
        reason: VoiceReasonCodes.TTS_SEGMENT_FINISHED,
      },
    })
    clock.advance(5)
  }

  const entries = log.getEntries()
  const byType = (type: string) => entries.filter((entry) => entry.eventType === type)

  assert.equal(byType('tts:segment_queued').length, 3)
  assert.equal(byType('tts:segment_started').length, 3)
  assert.equal(byType('tts:segment_finished').length, 3)
  assert.equal(byType('tts:first_audio').length, 1, 'first_audio is a single request-level marker')

  // A multi-segment reply still derives stt_final→first_audio latency from
  // the single tts:first_audio marker — no timeline pollution from segments.
  // (We never recorded stt:final here so the breakdown stays null; the assert
  //  confirms the happy-path test's latency rules aren't coupled to segments.)
  assert.equal(log.getLatencyBreakdown(sessionId).sttFinalToFirstAudioMs, null)
})

// ── TTS network error ──────────────────────────────────────────────────────

test('tts segment network error is captured with reason + message meta', () => {
  const clock = createClock()
  const log = new VoiceTransitionLog({ now: clock.now })
  const sessionId = 'voice-tts-fail-1'

  // Prime the timeline up to stt:final so we could in principle derive
  // stt_final_to_first_audio — but the failure case should NOT emit a latency
  // since no audio was played.
  record(log, {
    event: {
      type: 'vad:speech_end',
      sessionId,
      reason: VoiceReasonCodes.VAD_SPEECH_END,
    },
  })
  clock.advance(500)
  record(log, {
    event: {
      type: 'stt:final',
      text: '今天天气如何',
      sessionId,
      reason: VoiceReasonCodes.STT_SUCCESS,
    },
  })

  clock.advance(400)
  const errRec = record(log, {
    event: {
      type: 'tts:segment_error',
      segmentIndex: 0,
      speechGeneration: 1,
      message: 'fetch failed: ECONNRESET',
      sessionId,
      provider: 'tencent-tts',
      reason: VoiceReasonCodes.TTS_SEGMENT_NETWORK_ERROR,
      meta: { attempt: 1, errorCode: 'ECONNRESET' },
    },
    prevPhase: 'speaking',
    nextPhase: 'idle',
  })

  assert.equal(errRec.reason, VoiceReasonCodes.TTS_SEGMENT_NETWORK_ERROR)
  assert.equal(errRec.provider, 'tencent-tts')
  assert.equal(errRec.eventType, 'tts:segment_error')
  assert.deepEqual(errRec.meta, { attempt: 1, errorCode: 'ECONNRESET' })

  // segment_error is NOT one of the timeline-advancing events, so its own
  // latencyMs stays null. The slice stt_final → first_audio never closes.
  assert.equal(errRec.latencyMs, null)
  const breakdown = log.getLatencyBreakdown(sessionId)
  assert.equal(breakdown.sttFinalToFirstAudioMs, null)
})

// ── Ring buffer overflow ───────────────────────────────────────────────────

test('ring buffer drops oldest entries once maxEntries is exceeded, seq stays monotonic', () => {
  const clock = createClock()
  const log = new VoiceTransitionLog({ now: clock.now, maxEntries: 3 })

  for (let i = 0; i < 5; i++) {
    record(log, {
      event: {
        type: 'chat:busy_changed',
        busy: i % 2 === 0,
      },
    })
    clock.advance(1)
  }

  const entries = log.getEntries()
  assert.equal(entries.length, 3, 'ring buffer length is capped at maxEntries')

  // The three survivors are the last three pushes, with seq counter preserved
  // across the drop — it does not reset when entries fall off the front.
  assert.deepEqual(
    entries.map((e) => e.seq),
    [3, 4, 5],
  )
})

test('maxTimelines bound evicts oldest session timeline when exceeded', () => {
  const clock = createClock()
  const log = new VoiceTransitionLog({ now: clock.now, maxTimelines: 2 })

  // Session A gets a wake hit, establishing its timeline.
  record(log, {
    event: {
      type: 'wake:detected',
      wakeWord: '小助手',
      keyword: '小助手',
      sessionId: 'A',
      reason: VoiceReasonCodes.WAKE_MATCH,
    },
  })
  clock.advance(10)
  record(log, {
    event: {
      type: 'wake:detected',
      wakeWord: '小助手',
      keyword: '小助手',
      sessionId: 'B',
      reason: VoiceReasonCodes.WAKE_MATCH,
    },
  })
  clock.advance(10)
  // C pushes the oldest timeline (A) out.
  record(log, {
    event: {
      type: 'wake:detected',
      wakeWord: '小助手',
      keyword: '小助手',
      sessionId: 'C',
      reason: VoiceReasonCodes.WAKE_MATCH,
    },
  })

  assert.equal(log.getTimeline('A'), null, 'oldest session timeline is evicted')
  assert.notEqual(log.getTimeline('B'), null)
  assert.notEqual(log.getTimeline('C'), null)
})

// ── Export shapes ──────────────────────────────────────────────────────────

test('exportJson and exportNdjson round-trip the stored entries', () => {
  const clock = createClock()
  const log = new VoiceTransitionLog({ now: clock.now })

  record(log, {
    event: {
      type: 'wake:armed',
      wakeWord: '小助手',
      reason: VoiceReasonCodes.WAKE_ARMED,
    },
    prevPhase: 'idle',
    nextPhase: 'listening',
  })
  clock.advance(1)
  record(log, {
    event: {
      type: 'wake:detected',
      wakeWord: '小助手',
      keyword: '小助手',
      sessionId: 'export-1',
      reason: VoiceReasonCodes.WAKE_MATCH,
    },
  })

  const parsed = JSON.parse(log.exportJson()) as Array<{ eventType: string }>
  assert.equal(parsed.length, 2)
  assert.equal(parsed[0]!.eventType, 'wake:armed')

  const ndjsonLines = log.exportNdjson().split('\n')
  assert.equal(ndjsonLines.length, 2)
  assert.equal(
    (JSON.parse(ndjsonLines[1]!) as { eventType: string }).eventType,
    'wake:detected',
  )
})
