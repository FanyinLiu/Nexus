import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  ExpressionOverrideStreamFilter,
  PerformanceTagStreamFilter,
  StageDirectionStreamFilter,
  extractExpressionOverrides,
  extractPerformanceTags,
  parseAssistantPerformanceContent,
  segmentStageDirections,
} from '../src/features/pet/performance.ts'

test('keeps stage directions in display but strips them from spoken content', () => {
  const parsed = parseAssistantPerformanceContent(
    '（开心地整理资料）已经生成《StackChan组装要点.txt》放在桌面啦～（操作音效）',
  )

  assert.equal(parsed.displayContent, '（开心地整理资料）已经生成《StackChan组装要点.txt》放在桌面啦～（操作音效）')
  assert.equal(parsed.spokenContent, '已经生成《StackChan组装要点.txt》放在桌面啦～')
  assert.deepEqual(parsed.stageDirections, ['开心地整理资料', '操作音效'])
  assert.equal(parsed.cues.length, 1)
  assert.equal(parsed.cues[0]?.accentStyle, 'organize')
  assert.equal(parsed.cues[0]?.expressionSlot, 'happy')
  assert.equal(parsed.cues[0]?.motionSlot, 'touchBody')
})

test('keeps multiple recognized performance cues in reply order', () => {
  const parsed = parseAssistantPerformanceContent('（查找资料）（轻轻点头）我找到了。')

  assert.equal(parsed.displayContent, '（查找资料）（轻轻点头）我找到了。')
  assert.equal(parsed.spokenContent, '我找到了。')
  assert.equal(parsed.cues.length, 2)
  assert.equal(parsed.cues[0]?.accentStyle, 'search')
  assert.equal(parsed.cues[0]?.expressionSlot, 'thinking')
  assert.equal(parsed.cues[1]?.accentStyle, 'confirm')
  assert.equal(parsed.cues[1]?.expressionSlot, 'happy')
  assert.deepEqual(
    parsed.cues.map((cue) => cue.stageDirection),
    ['查找资料', '轻轻点头'],
  )
})

test('treats writing and delivery as distinct sequential task cues', () => {
  const parsed = parseAssistantPerformanceContent('（记录重点）（发到桌面）已经放好了。')

  assert.equal(parsed.cues.length, 2)
  assert.equal(parsed.cues[0]?.accentStyle, 'write')
  assert.equal(parsed.cues[0]?.motionSlot, 'touchBody')
  assert.equal(parsed.cues[1]?.accentStyle, 'deliver')
  assert.equal(parsed.cues[1]?.motionSlot, 'touchBody')
})

test('keeps an unrecognized aside visible but never speaks it', () => {
  // An aside the vocabulary does not know — no cue to drive — must still read as
  // an intentional aside (kept in display) and must never be spoken aloud. This
  // is what stops novel stage directions from leaking on users we never see.
  const parsed = parseAssistantPerformanceContent('（突然蹦出一只企鹅）你好呀')

  assert.equal(parsed.displayContent, '（突然蹦出一只企鹅）你好呀')
  assert.equal(parsed.spokenContent, '你好呀')
  assert.equal(parsed.cues.length, 0)
  assert.equal(parsed.cue, null)
  assert.deepEqual(parsed.stageDirections, ['突然蹦出一只企鹅'])
})

test('a bright-eyes aside stays visible, drives a happy face, and is not spoken', () => {
  const parsed = parseAssistantPerformanceContent('（眼睛亮了）这算不算变相表白呀？')

  assert.equal(parsed.displayContent, '（眼睛亮了）这算不算变相表白呀？')
  assert.equal(parsed.spokenContent, '这算不算变相表白呀？')
  assert.deepEqual(parsed.stageDirections, ['眼睛亮了'])
  assert.equal(parsed.cues.length, 1)
  assert.equal(parsed.cues[0]?.expressionSlot, 'happy')
})

test('a labeled bracket with a colon is content, not a stage direction', () => {
  const parsed = parseAssistantPerformanceContent('明天放假（注：周一照常）记得哦')

  assert.equal(parsed.displayContent, '明天放假（注：周一照常）记得哦')
  assert.equal(parsed.spokenContent, '明天放假（注：周一照常）记得哦')
  assert.deepEqual(parsed.stageDirections, [])
})

test('allows silent-only stage directions without forcing spoken fallback text', () => {
  const parsed = parseAssistantPerformanceContent('（操作音效）')

  assert.equal(parsed.displayContent, '（操作音效）')
  assert.equal(parsed.spokenContent, '')
  assert.equal(parsed.cue, null)
  assert.deepEqual(parsed.stageDirections, ['操作音效'])
})

test('segmentStageDirections marks asides for styling and leaves notes as text', () => {
  const segments = segmentStageDirections('（眼睛亮了）你好呀（注：稍后）')

  assert.deepEqual(segments, [
    { stage: true, text: '（眼睛亮了）' },
    { stage: false, text: '你好呀（注：稍后）' },
  ])
})

test('StageDirectionStreamFilter strips complete asides from the speech stream', () => {
  const filter = new StageDirectionStreamFilter()
  const spoken = filter.push('（眼睛亮了）你好') + filter.push('呀') + filter.flush()

  assert.equal(spoken, '你好呀')
})

test('StageDirectionStreamFilter holds a partial aside back until it closes', () => {
  const filter = new StageDirectionStreamFilter()

  // The half-open "（眼睛" must not reach TTS as raw text mid-stream.
  assert.equal(filter.push('好的（眼睛'), '好的')
  assert.equal(filter.push('亮了）继续'), '继续')
  assert.equal(filter.flush(), '')
})

test('extractExpressionOverrides strips [expr:name] tags and emits matching cues', () => {
  const result = extractExpressionOverrides('我来了[expr:happy]！发现了点东西[expr:surprised]。')

  assert.equal(result.content, '我来了！发现了点东西。')
  assert.equal(result.cues.length, 2)
  assert.equal(result.cues[0]?.expressionSlot, 'happy')
  assert.equal(result.cues[1]?.expressionSlot, 'surprised')
})

test('extractExpressionOverrides drops unknown slot names but still strips the tag', () => {
  const result = extractExpressionOverrides('等一下[expr:bogus]好了。')

  assert.equal(result.content, '等一下好了。')
  assert.equal(result.cues.length, 0)
})

test('extractExpressionOverrides is a no-op when no tags are present', () => {
  const result = extractExpressionOverrides('普通的一句话。')

  assert.equal(result.content, '普通的一句话。')
  assert.equal(result.cues.length, 0)
})

test('ExpressionOverrideStreamFilter strips a tag delivered in one chunk', () => {
  const filter = new ExpressionOverrideStreamFilter()
  const out = filter.push('你好[expr:happy]啊') + filter.flush()
  assert.equal(out, '你好啊')
})

test('ExpressionOverrideStreamFilter holds back a partial tag across deltas', () => {
  const filter = new ExpressionOverrideStreamFilter()
  // Simulate the LLM streaming the tag one small slice at a time — the
  // filter must not emit `[`, `[e`, `[ex` ... until the tag completes.
  const pieces = ['你好', '[', 'expr', ':hap', 'py]', '啊']
  let streamed = ''
  for (const piece of pieces) {
    streamed += filter.push(piece)
  }
  streamed += filter.flush()
  assert.equal(streamed, '你好啊')
})

test('ExpressionOverrideStreamFilter releases text around a non-tag bracket', () => {
  const filter = new ExpressionOverrideStreamFilter()
  const out = filter.push('请看[TODO] 说明') + filter.flush()
  assert.equal(out, '请看[TODO] 说明')
})

test('ExpressionOverrideStreamFilter releases long-lived unmatched brackets', () => {
  const filter = new ExpressionOverrideStreamFilter()
  // Buffer starts with `[` but never closes. Filter must give up after
  // the lookahead cap so the bubble doesn't hang.
  const longTail = 'x'.repeat(80)
  const out = filter.push('开头[') + filter.push(longTail) + filter.flush()
  assert.equal(out, `开头[${longTail}`)
})

test('ExpressionOverrideStreamFilter handles multiple tags in one stream', () => {
  const filter = new ExpressionOverrideStreamFilter()
  const out = filter.push('A[expr:happy]B') + filter.push('[expr:surprised]C') + filter.flush()
  assert.equal(out, 'ABC')
})

test('extractPerformanceTags routes expr/motion/tts into separate cue lists', () => {
  const result = extractPerformanceTags('开始[motion:wave]工作[expr:happy]结果出来了[tts:excited]。')

  assert.equal(result.content, '开始工作结果出来了。')
  assert.equal(result.exprCues.length, 1)
  assert.equal(result.exprCues[0]?.expressionSlot, 'happy')
  assert.equal(result.motionCues.length, 1)
  assert.equal(result.motionCues[0]?.gestureName, 'wave')
  assert.equal(result.ttsCues.length, 1)
  assert.equal(result.ttsCues[0]?.mode, 'excited')
})

test('extractPerformanceTags keeps unknown motion/tts values — validation happens at apply time', () => {
  const result = extractPerformanceTags('试试[motion:mystery_dance]和[tts:nosuch]。')

  assert.equal(result.content, '试试和。')
  assert.equal(result.motionCues.length, 1)
  assert.equal(result.motionCues[0]?.gestureName, 'mystery_dance')
  assert.equal(result.ttsCues.length, 1)
  assert.equal(result.ttsCues[0]?.mode, 'nosuch')
})

test('extractPerformanceTags still drops unknown expr slots silently', () => {
  const result = extractPerformanceTags('嗯[expr:bogus]好。')

  assert.equal(result.content, '嗯好。')
  assert.equal(result.exprCues.length, 0)
})

test('PerformanceTagStreamFilter holds back partial [motion: prefix across deltas', () => {
  const filter = new PerformanceTagStreamFilter()
  const pieces = ['嗨', '[', 'mo', 'tion', ':wav', 'e]', '！']
  let streamed = ''
  for (const piece of pieces) {
    streamed += filter.push(piece)
  }
  streamed += filter.flush()
  assert.equal(streamed, '嗨！')
})

test('PerformanceTagStreamFilter holds back partial [tts: prefix across deltas', () => {
  const filter = new PerformanceTagStreamFilter()
  const pieces = ['哼', '[t', 'ts:whi', 'sper', ']', '嘘']
  let streamed = ''
  for (const piece of pieces) {
    streamed += filter.push(piece)
  }
  streamed += filter.flush()
  assert.equal(streamed, '哼嘘')
})

test('PerformanceTagStreamFilter releases a non-performance bracket like [NOTE]', () => {
  const filter = new PerformanceTagStreamFilter()
  const out = filter.push('查看[NOTE] 细节') + filter.flush()
  assert.equal(out, '查看[NOTE] 细节')
})

test('motion cues can be shaped into PetPerformancePlan with gestureName for the queue', () => {
  const result = extractPerformanceTags('看这里[motion:point]！')
  assert.equal(result.motionCues.length, 1)
  const plan = {
    gestureName: result.motionCues[0].gestureName,
    durationMs: 1_600,
    stageDirection: result.motionCues[0].stageDirection,
  }
  assert.equal(plan.gestureName, 'point')
  assert.equal(plan.stageDirection, '(motion:point)')
  // expressionSlot absent on pure motion cues — mood engine keeps the face.
  assert.equal('expressionSlot' in plan, false)
})

test('extractPerformanceTags captures [recall:<id>] tags with original case preserved', () => {
  const result = extractPerformanceTags('Hey, [recall:memory-aB12cD] did you ever pick a gift?')
  assert.equal(result.content, 'Hey,  did you ever pick a gift?')
  assert.equal(result.recallCues.length, 1)
  assert.equal(result.recallCues[0].memoryId, 'memory-aB12cD')
  assert.equal(result.recallCues[0].stageDirection, '(recall:memory-aB12cD)')
})

test('extractPerformanceTags handles mixed expr+motion+recall in one reply', () => {
  const result = extractPerformanceTags(
    '[expr:happy] 嗨 [motion:wave]，[recall:memory-xyz123] 你昨天提到的事进展如何？',
  )
  assert.equal(result.exprCues.length, 1)
  assert.equal(result.motionCues.length, 1)
  assert.equal(result.recallCues.length, 1)
  assert.equal(result.recallCues[0].memoryId, 'memory-xyz123')
})

test('PerformanceTagStreamFilter holds back partial [recall: prefix across deltas', async () => {
  const { PerformanceTagStreamFilter } = await import('../src/features/pet/performance.ts')
  const filter = new PerformanceTagStreamFilter()
  const pieces = ['Hey ', '[', 're', 'call:', 'mem-x', ']', ' good day']
  let streamed = ''
  for (const piece of pieces) {
    streamed += filter.push(piece)
  }
  streamed += filter.flush()
  assert.equal(streamed, 'Hey  good day')
})

// ── [mood:...] — the LLM's read of the USER's emotion ───────────────────────

test('extractPerformanceTags parses mood reads with and without intensity', () => {
  const out = extractPerformanceTags('好呀，我陪你聊聊。[mood:sad-7]')
  assert.equal(out.content, '好呀，我陪你聊聊。')
  assert.deepEqual(out.moodCues, [{ mood: 'sad', intensity: 7, stageDirection: '(mood:sad-7)' }])

  const bare = extractPerformanceTags('hello [mood:happy] there')
  assert.deepEqual(bare.moodCues[0], { mood: 'happy', intensity: 5, stageDirection: '(mood:happy)' })
})

test('unknown mood words and out-of-range intensities are dropped (tag still stripped)', () => {
  const out = extractPerformanceTags('ok [mood:melancholy-3] [mood:sad-12]')
  assert.equal(out.moodCues.length, 0)
  assert.doesNotMatch(out.content, /mood/)
})

test('streaming filter never flashes a partial [mood: tag', () => {
  const filter = new PerformanceTagStreamFilter()
  let visible = ''
  for (const chunk of ['今天辛苦了。', '[mo', 'od:tir', 'ed-6]']) {
    visible += filter.push(chunk)
  }
  visible += filter.flush()
  assert.equal(visible, '今天辛苦了。')
})
