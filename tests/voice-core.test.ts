import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  choosePreferredVoiceTranscript,
  looksLikeRepetitionCollapse,
  normalizeRecognizedVoiceTranscript,
  resolveVoiceTranscriptDecision,
  shouldAttemptLocalWhisperRescore,
} from '../src/features/hearing/core.ts'
import { applyVoiceHotwordCorrections } from '../src/features/hearing/hotwordCorrection.ts'
import { segmentTextForSpeech, StreamingTtsChunker } from '../src/features/voice/streamingTts.ts'
import { normalizeVoiceDedupText, prepareTextForTts } from '../src/features/voice/text.ts'
import {
  getMaxRequestCharsForProvider,
  splitLongTextAtSentences,
} from '../src/hooks/voice/speechTextSegmentation.ts'

const WAKE_WORD = '\u661f\u7ed8'
const WAKE_WORD_ALIAS = '\u661f\u4f1a'
const WAKE_WORD_LIST = '\u5c0f\u767d,\u661f\u5e05'

test('returns manual confirmation decision when manual_confirm mode is enabled', () => {
  const transcript = '\u660e\u5929\u63d0\u9192\u6211\u5f00\u4f1a'
  const decision = resolveVoiceTranscriptDecision({
    transcript,
    triggerMode: 'manual_confirm',
    wakeWord: WAKE_WORD,
  })

  assert.deepEqual(decision, {
    kind: 'manual_confirm',
    transcript,
  })
})

test('returns direct send decision outside wake-word mode', () => {
  const transcript = '\u5e2e\u6211\u67e5\u4e00\u4e0b\u4e0a\u6d77\u5929\u6c14'
  const decision = resolveVoiceTranscriptDecision({
    transcript,
    triggerMode: 'direct_send',
    wakeWord: WAKE_WORD,
  })

  assert.deepEqual(decision, {
    kind: 'send',
    transcript,
    content: transcript,
    mode: 'direct_send',
  })
})

test('holds incomplete duration-only transcript instead of sending it', () => {
  const transcript = '\u80fd\u4e94\u5206\u949f\u4e4b\u540e'
  const decision = resolveVoiceTranscriptDecision({
    transcript,
    triggerMode: 'direct_send',
    wakeWord: WAKE_WORD,
  })

  assert.deepEqual(decision, {
    kind: 'hold_incomplete',
    transcript,
    content: transcript,
    mode: 'direct_send',
  })
})

test('holds incomplete command-only transcript instead of sending it', () => {
  const transcript = '\u63d0\u9192\u6211'
  const decision = resolveVoiceTranscriptDecision({
    transcript,
    triggerMode: 'direct_send',
    wakeWord: WAKE_WORD,
  })

  assert.deepEqual(decision, {
    kind: 'hold_incomplete',
    transcript,
    content: transcript,
    mode: 'direct_send',
  })
})

test('blocks wake-word mode when wake word is empty', () => {
  const transcript = '\u5e2e\u6211\u8bb0\u4e00\u4e0b\u5f85\u529e'
  const decision = resolveVoiceTranscriptDecision({
    transcript,
    triggerMode: 'wake_word',
    wakeWord: '   ',
  })

  assert.deepEqual(decision, {
    kind: 'blocked_missing_wake_word',
    transcript,
  })
})

test('blocks transcript when wake word is not matched', () => {
  const transcript = '\u5e2e\u6211\u8bb0\u4e00\u4e0b\u5f85\u529e'
  const decision = resolveVoiceTranscriptDecision({
    transcript,
    triggerMode: 'wake_word',
    wakeWord: WAKE_WORD,
  })

  assert.deepEqual(decision, {
    kind: 'blocked_unmatched_wake_word',
    transcript,
    wakeWord: WAKE_WORD,
  })
})

test('returns wake-word-only decision when nothing remains after stripping wake word', () => {
  const decision = resolveVoiceTranscriptDecision({
    transcript: WAKE_WORD,
    triggerMode: 'wake_word',
    wakeWord: WAKE_WORD,
  })

  assert.deepEqual(decision, {
    kind: 'wake_word_only',
    transcript: WAKE_WORD,
    wakeWord: WAKE_WORD,
  })
})

test('strips wake word aliases before sending content', () => {
  const transcript = `${WAKE_WORD_ALIAS} \u5e2e\u6211\u6253\u5f00\u5b98\u7f51`
  const decision = resolveVoiceTranscriptDecision({
    transcript,
    triggerMode: 'wake_word',
    wakeWord: WAKE_WORD,
  })

  assert.deepEqual(decision, {
    kind: 'send',
    transcript,
    content: '\u5e2e\u6211\u6253\u5f00\u5b98\u7f51',
    mode: 'wake_word',
  })
})

test('supports comma-separated custom wake words', () => {
  const transcript = '\u5c0f\u767d \u5e2e\u6211\u67e5\u4e00\u4e0b\u5f53\u4eca\u5929\u5929\u6c14'
  const decision = resolveVoiceTranscriptDecision({
    transcript,
    triggerMode: 'wake_word',
    wakeWord: WAKE_WORD_LIST,
  })

  assert.deepEqual(decision, {
    kind: 'send',
    transcript,
    content: '\u5e2e\u6211\u67e5\u4e00\u4e0b\u5f53\u4eca\u5929\u5929\u6c14',
    mode: 'wake_word',
  })
})

test('sends transcript directly after KWS already triggered even without wake word in text', () => {
  const transcript = '\u5e2e\u6211\u67e5\u4e00\u4e0b\u4eca\u5929\u5929\u6c14'
  const decision = resolveVoiceTranscriptDecision({
    transcript,
    triggerMode: 'wake_word',
    wakeWord: WAKE_WORD,
    wakeWordAlreadyTriggered: true,
  })

  assert.deepEqual(decision, {
    kind: 'send',
    transcript,
    content: transcript,
    mode: 'wake_word',
  })
})

test('still strips the wake word when a KWS-triggered transcript contains it', () => {
  const transcript = `${WAKE_WORD} \u5e2e\u6211\u6253\u5f00\u5b98\u7f51`
  const decision = resolveVoiceTranscriptDecision({
    transcript,
    triggerMode: 'wake_word',
    wakeWord: WAKE_WORD,
    wakeWordAlreadyTriggered: true,
  })

  assert.deepEqual(decision, {
    kind: 'send',
    transcript,
    content: '\u5e2e\u6211\u6253\u5f00\u5b98\u7f51',
    mode: 'wake_word',
  })
})

test('looksLikeRepetitionCollapse flags attention-stall hallucinations', () => {
  // "出出出出出出出出出出" — single-char collapse, what the user saw in the TTS
  // side reported earlier. Same shape shows up in STT decoders.
  assert.equal(looksLikeRepetitionCollapse('\u51fa'.repeat(20)), true)
  // Consecutive run trigger (ratio alone would not flag this).
  assert.equal(looksLikeRepetitionCollapse('\u4f60\u597d' + '\u5440'.repeat(10)), true)
  // Natural short utterances stay healthy.
  assert.equal(looksLikeRepetitionCollapse('\u597d'), false)
  assert.equal(looksLikeRepetitionCollapse('\u55ef\u55ef'), false)
  // Emphatic doubling ("说说这个话题") should pass.
  assert.equal(looksLikeRepetitionCollapse('\u8bf4\u8bf4\u8fd9\u4e2a\u8bdd\u9898'), false)
  // A proper sentence with one repeated char under the 70% cap passes.
  assert.equal(looksLikeRepetitionCollapse('\u4eca\u5929\u5929\u6c14\u771f\u597d'), false)
})

test('normalizeRecognizedVoiceTranscript drops repetition collapses', () => {
  assert.equal(
    normalizeRecognizedVoiceTranscript('\u51fa'.repeat(30)),
    '',
  )
})

test('normalizes leading filler words before routing voice transcripts', () => {
  assert.equal(
    normalizeRecognizedVoiceTranscript('\u90a3\u4e2a \u90a3\u4e2a \u5e2e\u6211\u67e5\u4e00\u4e0b\u6df1\u5733\u5929\u6c14'),
    '\u5e2e\u6211\u67e5\u4e00\u4e0b\u6df1\u5733\u5929\u6c14',
  )
})

test('marks short command-like sherpa transcripts for whisper rescoring', () => {
  assert.equal(
    shouldAttemptLocalWhisperRescore('\u63d0\u9192\u6211\u559d\u6c34', {
      partialCount: 1,
      endpointCount: 1,
    }),
    true,
  )
})

test('does not rescore a longer stable conversational transcript by default', () => {
  assert.equal(
    shouldAttemptLocalWhisperRescore('\u4eca\u5929\u6211\u60f3\u8ddf\u4f60\u5206\u4eab\u4e00\u4e0b\u6211\u4e0a\u5348\u505a\u4e86\u4ec0\u4e48', {
      partialCount: 4,
      endpointCount: 1,
    }),
    false,
  )
})

test('prefers the more complete whisper-corrected transcript when it scores better', () => {
  assert.equal(
    choosePreferredVoiceTranscript('\u6700\u540e\u63d0\u9192\u6211\u559d\u6c34', '\u4e94\u5206\u949f\u4e4b\u540e\u63d0\u9192\u6211\u559d\u6c34'),
    '\u4e94\u5206\u949f\u4e4b\u540e\u63d0\u9192\u6211\u559d\u6c34',
  )
})

test('applies built-in hotword correction for reminder time phrases', () => {
  const correction = applyVoiceHotwordCorrections('\u6700\u540e\u63d0\u9192\u6211\u559d\u6c34')

  assert.equal(correction.text, '\u4e94\u5206\u949f\u540e\u63d0\u9192\u6211\u559d\u6c34')
  assert.equal(correction.changed, true)
})

test('applies built-in hotword correction for weather city aliases', () => {
  const correction = applyVoiceHotwordCorrections('\u5e2e\u6211\u770b\u4e00\u4e0b\u6df1\u8bc1\u5929\u5668')

  assert.equal(correction.text, '\u5e2e\u6211\u770b\u4e00\u4e0b\u6df1\u5733\u5929\u6c14')
})

test('applies built-in hotword correction for lyric search aliases', () => {
  const correction = applyVoiceHotwordCorrections('\u5e2e\u6211\u641c\u6240\u5468\u4f20\u718a\u9ec4\u5a5a\u6b4c\u6b21')

  assert.equal(correction.text, '\u5e2e\u6211\u641c\u7d22\u5468\u4f20\u96c4\u9ec4\u660f\u6b4c\u8bcd')
})

test('prepareTextForTts strips links, urls and stage directions', () => {
  assert.equal(
    prepareTextForTts('查看[黄昏](https://example.com)歌词 https://foo.bar [掌声]'),
    '查看黄昏歌词',
  )
})

test('prepareTextForTts collapses duplicate weather labels and separators', () => {
  assert.equal(
    prepareTextForTts('今天：今天，小阵雨 | 24 / 28'),
    '今天，小阵雨，24，28',
  )
})

test('prepareTextForTts strips markdown emphasis and inline code', () => {
  // Observed in the wild — LLM replies are full of **bold** markers, and
  // the TTS providers used to read them as "星星" or choke on the stars.
  assert.equal(
    prepareTextForTts('开车大约需要**2小时**，建议自驾过去'),
    '开车大约需要2小时，建议自驾过去',
  )
  assert.equal(
    prepareTextForTts('__重要提示__：路况可能会变化'),
    '重要提示：路况可能会变化',
  )
  assert.equal(
    prepareTextForTts('跑 `npm run build` 就行'),
    '跑 npm run build 就行',
  )
})

test('normalizeVoiceDedupText normalizes whitespace and case', () => {
  assert.equal(
    normalizeVoiceDedupText('  Hello   WORLD  '),
    'hello world',
  )
})

test('segmentTextForSpeech prioritizes an early comma split for the first chunk', () => {
  assert.deepEqual(
    segmentTextForSpeech('\u597d\u7684\uff0c\u4e3b\u4eba\u3002\u6211\u53bb\u641c\u7d22\u4e00\u4e0b\u3002', {
      absoluteMinChunkLength: 2,
      maxChunkLength: 88,
      minForcedChunkLength: 26,
      preferredEarlySplitLength: 20,
      firstChunkMaxLength: 6,
      firstChunkMinForcedChunkLength: 2,
      firstChunkPreferredEarlySplitLength: 2,
    }),
    [
      '\u597d\u7684\uff0c',
      '\u4e3b\u4eba\u3002',
      '\u6211\u53bb\u641c\u7d22\u4e00\u4e0b\u3002',
    ],
  )
})

test('segmentTextForSpeech allows a very short first chunk for local qwen lead-in', () => {
  assert.deepEqual(
    segmentTextForSpeech('\u4f60\u597d\uff0c\u4e3b\u4eba\u3002', {
      absoluteMinChunkLength: 2,
      maxChunkLength: 88,
      minForcedChunkLength: 26,
      preferredEarlySplitLength: 20,
      firstChunkMaxLength: 6,
      firstChunkMinForcedChunkLength: 2,
      firstChunkPreferredEarlySplitLength: 2,
    }),
    [
      '\u4f60\u597d\uff0c',
      '\u4e3b\u4eba\u3002',
    ],
  )
})

test('StreamingTtsChunker emits short intermediate sentences during pushText', () => {
  // Default options: preferredEarlySplitLength=18, but a short sentence
  // should still split mid-stream because sentence boundaries respect
  // only absoluteMinChunkLength.
  const chunker = new StreamingTtsChunker({
    firstChunkMaxLength: 36,
    firstChunkMinForcedChunkLength: 2,
    firstChunkPreferredEarlySplitLength: 2,
  })

  // First delta: "\u597d\u7684\uff0c" (好的，) — first comma triggers immediately.
  const firstChunks = chunker.pushText('\u597d\u7684\uff0c')
  assert.deepEqual(firstChunks, ['\u597d\u7684\uff0c'])

  // Second delta: "\u6211\u8d70\u4e86\u3002" (我走了。) — sentence boundary
  // at index 3 (period); 4 chars total, well below preferredEarlySplitLength=18,
  // but should still emit because absoluteMinChunkLength=2 is satisfied.
  const secondChunks = chunker.pushText('\u6211\u8d70\u4e86\u3002')
  assert.deepEqual(secondChunks, ['\u6211\u8d70\u4e86\u3002'])

  // Third delta: a longer fragment with a comma followed by a sentence end —
  // commas in non-first chunks still wait for the length threshold, so the
  // whole "\u4f60\u4e5f\u8d70\u5427\u3002" (你也走吧。) should emit as one.
  const thirdChunks = chunker.pushText('\u4f60\u4e5f\u8d70\u5427\u3002')
  assert.deepEqual(thirdChunks, ['\u4f60\u4e5f\u8d70\u5427\u3002'])
})

test('StreamingTtsChunker first chunk splits at first comma even when delivered char-by-char', () => {
  // Simulate provider streaming one token at a time.
  const chunker = new StreamingTtsChunker({
    firstChunkMaxLength: 36,
    firstChunkMinForcedChunkLength: 2,
    firstChunkPreferredEarlySplitLength: 2,
  })

  // "\u597d" "\u7684" — no boundary yet, nothing should emit.
  assert.deepEqual(chunker.pushText('\u597d'), [])
  assert.deepEqual(chunker.pushText('\u7684'), [])

  // "\uff0c" — comma arrives, should emit "好的，" right away.
  assert.deepEqual(chunker.pushText('\uff0c'), ['\u597d\u7684\uff0c'])

  // Subsequent token "\u4e3b\u4eba" — no boundary yet.
  assert.deepEqual(chunker.pushText('\u4e3b\u4eba'), [])

  // "\u3002" (period) — should emit because sentence boundary respects only
  // absoluteMinChunkLength.
  assert.deepEqual(chunker.pushText('\u3002'), ['\u4e3b\u4eba\u3002'])
})

test('getMaxRequestCharsForProvider caps OmniVoice at 80 chars so the diffusion model does not silently truncate', () => {
  // k2-fsa/OmniVoice has a fixed audio-context window (~30s of audio per
  // generation). Long text inputs don't error — the Python wrapper returns
  // `audios[0]` truncated to whatever fit, so the pet speaks the first few
  // sentences and goes silent for the rest. 80 chars ≈ 15–20s of speech
  // leaves comfortable headroom.
  assert.equal(getMaxRequestCharsForProvider('omnivoice-tts'), 80)
})

test('getMaxRequestCharsForProvider caps Volcengine at 300 chars so the 1024-byte text limit is never hit', () => {
  assert.equal(getMaxRequestCharsForProvider('volcengine-tts'), 300)
})

test('getMaxRequestCharsForProvider defaults to 3000 chars for unconstrained providers', () => {
  assert.equal(getMaxRequestCharsForProvider('openai-tts'), 3000)
  assert.equal(getMaxRequestCharsForProvider('elevenlabs-tts'), 3000)
  assert.equal(getMaxRequestCharsForProvider('edge-tts'), 3000)
})

test('splitLongTextAtSentences returns the whole text as one segment when under cap', () => {
  const text = '\u4f60\u597d\uff0c\u6211\u662f\u5c0f\u7c73\u3002'
  assert.deepEqual(splitLongTextAtSentences(text, 80), [text])
})

test('splitLongTextAtSentences splits a 5-sentence reply for OmniVoice at sentence boundaries', () => {
  // Five ~22-char sentences = ~110 chars total, exceeds the 80-char OmniVoice
  // cap. Expect the splitter to cut between sentences (after 。) rather than
  // hacking the text mid-character.
  const s1 = '\u597d\u7684\u4e3b\u4eba\uff0c\u4eca\u5929\u4e0a\u6d77\u7684\u5929\u6c14\u662f\u6674\u8f6c\u591a\u4e91\u3002' // 18 chars
  const s2 = '\u6700\u9ad8\u6e29\u5ea6\u56de\u5347\u5230\u4e8c\u5341\u4e03\u5ea6\uff0c\u5b9c\u4eba\u51fa\u95e8\u6563\u6b65\u3002' // 21 chars
  const s3 = '\u665a\u95f4\u4f1a\u8f6c\u4e3a\u9634\u5929\uff0c\u5e26\u6709\u96f6\u661f\u5c0f\u96e8\u98d8\u843d\u3002' // 18 chars
  const s4 = '\u660e\u540e\u5929\u6709\u5bd2\u6f6e\u5357\u4e0b\uff0c\u8bb0\u5f97\u52a0\u4e00\u4ef6\u5916\u5957\u3002' // 18 chars
  const s5 = '\u5468\u672b\u5929\u6c14\u56de\u6696\uff0c\u9002\u5408\u4e00\u8d77\u53bb\u516c\u56ed\u8d70\u8d70\u3002' // 19 chars
  const text = s1 + s2 + s3 + s4 + s5

  const segments = splitLongTextAtSentences(text, 80)

  // Should produce at least 2 segments, and joining them must preserve the
  // original text byte-for-byte (no characters dropped during the split).
  assert.ok(segments.length >= 2, `expected >= 2 segments, got ${segments.length}`)
  assert.equal(segments.join(''), text)

  // Every segment must end at a sentence boundary (。！？!?；;\n) except
  // possibly the tail. This is the property that guarantees OmniVoice gets
  // clean prosody per chunk instead of being asked to generate mid-clause.
  for (let i = 0; i < segments.length - 1; i += 1) {
    const segment = segments[i]!
    const lastChar = segment[segment.length - 1]!
    assert.match(
      lastChar,
      /[\u3002\uff01\uff1f!?\uff1b;\n]/u,
      `segment ${i} ends with non-boundary char: ${JSON.stringify(lastChar)}`,
    )
  }
})
